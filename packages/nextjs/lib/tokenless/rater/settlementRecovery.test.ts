import {
  type RaterSettlementSnapshot,
  buildRaterClaimAuthorization,
  buildRaterRevealAuthorization,
  tokenlessCommitKey,
  verifyRaterSettlementEvidence,
} from "./settlementRecovery";
import type { TokenlessRaterRoundSecrets } from "./types";
import { TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import assert from "node:assert/strict";
import test from "node:test";
import { type Hex, encodeEventTopics, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PANEL = "0x2222222222222222222222222222222222222222" as const;
const RELAYER = "0x3333333333333333333333333333333333333333" as const;
const secrets: TokenlessRaterRoundSecrets = {
  schemaVersion: "rateloop.tokenless.rater-secrets.v1",
  votePrivateKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  payoutPrivateKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  reveal: {
    roundId: 42n,
    voteKey: privateKeyToAccount("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").address,
    vote: 1,
    predictedUpBps: 7_200,
    responseHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    payoutAddress: privateKeyToAccount("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb").address,
    salt: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  },
};

function snapshot(overrides: Partial<RaterSettlementSnapshot> = {}): RaterSettlementSnapshot {
  return {
    schemaVersion: "rateloop.rater-settlement.v1",
    chainId: 84_532,
    panelAddress: PANEL,
    roundId: "42",
    voteKey: secrets.reveal.voteKey,
    commitKey: tokenlessCommitKey(42n, secrets.reveal.voteKey),
    roundStatus: "revealable",
    commitState: "confirmed",
    revealed: false,
    claimed: false,
    scoringEligible: false,
    finalizedPayoutAtomic: "0",
    compensationAtomic: "0",
    claimKind: null,
    canReveal: true,
    canClaim: false,
    commitDeadline: "1",
    revealDeadline: "2",
    beaconFailureDeadline: "3",
    claimDeadline: null,
    ...overrides,
  };
}

test("builds an exact permissionless self-reveal from browser recovery material", () => {
  const authorization = buildRaterRevealAuthorization({ snapshot: snapshot(), secrets, relayerAddress: RELAYER });
  assert.equal(authorization.action, "reveal");
  assert.equal(
    authorization.transactionData,
    encodeFunctionData({
      abi: TokenlessPanelAbi,
      functionName: "reveal",
      args: [
        42n,
        secrets.reveal.voteKey,
        1,
        7_200,
        secrets.reveal.responseHash,
        secrets.reveal.payoutAddress,
        secrets.reveal.salt,
      ],
    }),
  );
});

test("builds payout and compensation claims but rejects a mismatched recovery", () => {
  const payout = buildRaterClaimAuthorization({
    snapshot: snapshot({
      roundStatus: "finalized",
      revealed: true,
      finalizedPayoutAtomic: "950000",
      claimKind: "payout",
      canReveal: false,
      canClaim: true,
      claimDeadline: "100",
    }),
    secrets,
    relayerAddress: RELAYER,
  });
  assert.equal(payout.expectedAmountAtomic, 950_000n);
  assert.equal(
    payout.transactionData,
    encodeFunctionData({
      abi: TokenlessPanelAbi,
      functionName: "claim",
      args: [payout.commitKey, secrets.reveal.payoutAddress, secrets.reveal.salt],
    }),
  );
  const compensation = buildRaterClaimAuthorization({
    snapshot: snapshot({
      roundStatus: "under_quorum_compensated",
      revealed: true,
      compensationAtomic: "250000",
      claimKind: "compensation",
      canReveal: false,
      canClaim: true,
      claimDeadline: "100",
    }),
    secrets,
    relayerAddress: RELAYER,
  });
  assert.match(compensation.transactionData, /^0x/u);
  assert.throws(
    () =>
      buildRaterRevealAuthorization({
        snapshot: snapshot({ voteKey: RELAYER }),
        secrets,
        relayerAddress: RELAYER,
      }),
    /does not control/u,
  );
});

test("requires the exact settlement event and transaction envelope", () => {
  const authorization = buildRaterClaimAuthorization({
    snapshot: snapshot({
      roundStatus: "finalized",
      revealed: true,
      finalizedPayoutAtomic: "950000",
      claimKind: "payout",
      canReveal: false,
      canClaim: true,
      claimDeadline: "100",
    }),
    secrets,
    relayerAddress: RELAYER,
  });
  const topics = encodeEventTopics({
    abi: TokenlessPanelAbi,
    eventName: "Claimed",
    args: {
      roundId: 42n,
      commitKey: authorization.commitKey,
      payoutAddress: authorization.payoutAddress,
    },
  });
  const data = `0x${authorization.expectedAmountAtomic!.toString(16).padStart(64, "0")}` as const;
  const evidence = {
    transactionHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const,
    transactionFrom: RELAYER,
    transactionTo: PANEL,
    transactionData: authorization.transactionData,
    receiptStatus: "success" as const,
    logs: [{ address: PANEL, topics: topics as readonly Hex[], data }],
  };
  assert.equal(verifyRaterSettlementEvidence({ authorization, evidence }).action, "claim");
  assert.throws(
    () =>
      verifyRaterSettlementEvidence({
        authorization,
        evidence: { ...evidence, transactionTo: RELAYER },
      }),
    /exact authorized/u,
  );
});
