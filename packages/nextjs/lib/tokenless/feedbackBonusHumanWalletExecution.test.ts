import { TokenlessFeedbackBonusAbi } from "@rateloop/contracts/tokenless";
import assert from "node:assert/strict";
import test from "node:test";
import { type Hash, type Hex, encodeAbiParameters, encodeEventTopics, getAddress, parseAbiParameters } from "viem";
import type { PreparedFeedbackBonusAward } from "~~/lib/tokenless/feedbackBonusAwards";
import {
  buildFeedbackBonusHumanWalletAuthorization,
  verifyFeedbackBonusHumanWalletEvidence,
} from "~~/lib/tokenless/feedbackBonusHumanWalletExecution";

const CONTRACT = getAddress("0x1111111111111111111111111111111111111111");
const AWARDER = getAddress("0x2222222222222222222222222222222222222222");
const OUTSIDER = getAddress("0x3333333333333333333333333333333333333333");
const VOTE_KEY = getAddress("0x4444444444444444444444444444444444444444");
const RESPONSE_HASH = `0x${"55".repeat(32)}` as Hex;
const PAYOUT_COMMITMENT = `0x${"66".repeat(32)}` as Hex;
const FEEDBACK_KEY = `0x${"77".repeat(32)}` as Hex;
const TX_HASH = `0x${"88".repeat(32)}` as Hash;
const NOW = new Date("2026-07-16T18:00:00.000Z");

function prepared(): PreparedFeedbackBonusAward {
  return {
    intentId: "fbai_human_wallet_boundary",
    workspaceId: "workspace-a",
    opportunityId: "opportunity-a",
    feedbackId: "feedback-a",
    responseHash: RESPONSE_HASH,
    voteKey: VOTE_KEY,
    payoutCommitment: PAYOUT_COMMITMENT,
    awarderWallet: AWARDER,
    amountAtomic: "7000000",
    pool: { chainId: "84532", contractAddress: CONTRACT, poolId: "42" },
    confirmedReceipt: null,
  };
}

function authorization() {
  return buildFeedbackBonusHumanWalletAuthorization({
    prepared: prepared(),
    chainId: 84_532,
    configuredContractAddress: CONTRACT,
    now: NOW,
    pool: {
      awarder: AWARDER,
      depositedAmount: 30_000_000n,
      awardedAmount: 5_000_000n,
      feedbackDeadline: BigInt(Math.floor(NOW.getTime() / 1_000) - 1),
      awardDeadline: BigInt(Math.floor(NOW.getTime() / 1_000) + 3_600),
      refunded: false,
    },
    feedback: {
      voteKey: VOTE_KEY,
      responseHash: RESPONSE_HASH,
      payoutCommitment: PAYOUT_COMMITMENT,
      awardAmount: 0n,
      awarded: false,
      claimed: false,
    },
  });
}

function awardLog() {
  return {
    address: CONTRACT,
    topics: encodeEventTopics({
      abi: TokenlessFeedbackBonusAbi,
      eventName: "FeedbackAwarded",
      args: { poolId: 42n, feedbackKey: FEEDBACK_KEY, responseHash: RESPONSE_HASH },
    }) as Hex[],
    data: encodeAbiParameters(parseAbiParameters("address,bytes32,uint256"), [VOTE_KEY, PAYOUT_COMMITMENT, 7_000_000n]),
  };
}

test("human-wallet authorization contains only exact award calldata and never a payout preimage", () => {
  const result = authorization();
  assert.equal(result.awarderAddress, AWARDER);
  assert.equal(result.contractAddress, CONTRACT);
  assert.equal(result.chainId, 84_532);
  assert.match(result.transactionData, /^0x[0-9a-f]+$/u);
  assert.equal(result.transactionData.includes(PAYOUT_COMMITMENT.slice(2)), false);
});

test("award preparation fails closed on a closed pool or changed feedback registration", () => {
  const base = prepared();
  const pool = {
    awarder: AWARDER,
    depositedAmount: 30_000_000n,
    awardedAmount: 0n,
    feedbackDeadline: BigInt(Math.floor(NOW.getTime() / 1_000) - 1),
    awardDeadline: BigInt(Math.floor(NOW.getTime() / 1_000) + 3_600),
    refunded: false,
  };
  const feedback = {
    voteKey: VOTE_KEY,
    responseHash: RESPONSE_HASH,
    payoutCommitment: PAYOUT_COMMITMENT,
    awardAmount: 0n,
    awarded: false,
    claimed: false,
  };
  assert.throws(
    () =>
      buildFeedbackBonusHumanWalletAuthorization({
        prepared: base,
        chainId: 84_532,
        configuredContractAddress: CONTRACT,
        now: NOW,
        pool: { ...pool, refunded: true },
        feedback,
      }),
    /not open/u,
  );
  assert.throws(
    () =>
      buildFeedbackBonusHumanWalletAuthorization({
        prepared: base,
        chainId: 84_532,
        configuredContractAddress: CONTRACT,
        now: NOW,
        pool: { ...pool, awarder: OUTSIDER },
        feedback,
      }),
    /frozen human wallet/u,
  );
  assert.throws(
    () =>
      buildFeedbackBonusHumanWalletAuthorization({
        prepared: base,
        chainId: 84_532,
        configuredContractAddress: CONTRACT,
        now: NOW,
        pool,
        feedback: { ...feedback, payoutCommitment: `0x${"99".repeat(32)}` },
      }),
    /immutable on-chain registration/u,
  );
});

test("receipt verification accepts only the exact human sender, calldata, and award event", () => {
  const exact = authorization();
  const receipt = verifyFeedbackBonusHumanWalletEvidence({
    prepared: prepared(),
    authorization: exact,
    evidence: {
      transactionHash: TX_HASH,
      transactionFrom: AWARDER,
      transactionTo: CONTRACT,
      transactionData: exact.transactionData,
      receiptStatus: "success",
      confirmedAt: NOW,
      logs: [awardLog()],
    },
  });
  assert.deepEqual(receipt, { transactionHash: TX_HASH, confirmedAt: NOW });

  for (const evidence of [
    { transactionFrom: OUTSIDER },
    { transactionTo: OUTSIDER },
    { transactionData: "0x1234" as Hex },
    { receiptStatus: "reverted" as const },
  ]) {
    assert.throws(
      () =>
        verifyFeedbackBonusHumanWalletEvidence({
          prepared: prepared(),
          authorization: exact,
          evidence: {
            transactionHash: TX_HASH,
            transactionFrom: AWARDER,
            transactionTo: CONTRACT,
            transactionData: exact.transactionData,
            receiptStatus: "success",
            confirmedAt: NOW,
            logs: [awardLog()],
            ...evidence,
          },
        }),
      /exact award authorized/u,
    );
  }
});
