import { tokenlessCommitKey } from "./rater/settlementRecovery";
import {
  deriveRaterSettlementNotificationKinds,
  deriveRaterSettlementSnapshot,
  deriveReviewerEarningOutcome,
} from "./raterSettlementService";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getAddress } from "viem";

const PANEL = "0x2222222222222222222222222222222222222222";
const VOTE_KEY = "0x3333333333333333333333333333333333333333";
const DEPLOYMENT = "deployment:settlement";

function source(overrides: Record<string, unknown> = {}) {
  return {
    chain: { chainId: 84_532, panelAddress: getAddress(PANEL), deploymentKey: DEPLOYMENT },
    localCommit: {
      roundId: "42",
      voteKey: VOTE_KEY,
      state: "confirmed",
      deploymentKey: DEPLOYMENT,
      chainId: 84_532,
      panelAddress: PANEL,
    },
    deployment: { chainId: 84_532, panelAddress: PANEL, deploymentKey: DEPLOYMENT },
    round: {
      roundId: "42",
      state: 0,
      status: "revealable",
      commitDeadline: "100",
      revealDeadline: "200",
      beaconFailureDeadline: "300",
      claimDeadline: "0",
      minimumReveals: 2,
      revealCount: 2,
      compensationPerRecipient: "0",
      staleReturned: false,
    },
    commits: [
      {
        roundId: "42",
        voteKey: VOTE_KEY,
        commitKey: tokenlessCommitKey(42n, VOTE_KEY),
        revealed: false,
        claimed: false,
        scoringEligible: false,
        finalizedPayout: "0",
      },
    ],
    nowSeconds: 150n,
    ...overrides,
  };
}

test("derives the self-reveal window from an account-bound indexed commit", () => {
  const result = deriveRaterSettlementSnapshot(source());
  assert.equal(result.canReveal, true);
  assert.equal(result.canClaim, false);
  assert.equal(result.claimDeadline, null);
});

test("models the contract late-reveal eligibility before offering a transaction", () => {
  const base = source({ nowSeconds: 250n });
  assert.equal(deriveRaterSettlementSnapshot(base).canReveal, false);

  assert.equal(
    deriveRaterSettlementSnapshot({
      ...base,
      commits: [{ ...(base.commits as Array<Record<string, unknown>>)[0], scoringEligible: true }],
    }).canReveal,
    true,
  );

  assert.equal(
    deriveRaterSettlementSnapshot({
      ...base,
      round: { ...(base.round as Record<string, unknown>), revealCount: 1 },
    }).canReveal,
    true,
  );
});

test("derives reveal and claim-expiry notices only while the action remains possible", () => {
  const base = source();
  assert.deepEqual(
    deriveRaterSettlementNotificationKinds({
      commit: (base.commits as Array<Record<string, unknown>>)[0],
      round: base.round,
      nowSeconds: 150n,
    }),
    ["reveal_required"],
  );
  assert.deepEqual(
    deriveRaterSettlementNotificationKinds({
      commit: (base.commits as Array<Record<string, unknown>>)[0],
      round: base.round,
      nowSeconds: 250n,
    }),
    [],
  );

  const finalizedCommit = {
    ...(base.commits as Array<Record<string, unknown>>)[0],
    revealed: true,
    finalizedPayout: "1200000",
  };
  const finalizedRound = {
    ...(base.round as Record<string, unknown>),
    state: 5,
    status: "finalized",
    claimDeadline: String(1_000n + 23n * 60n * 60n),
  };
  assert.deepEqual(
    deriveRaterSettlementNotificationKinds({
      commit: finalizedCommit,
      round: finalizedRound,
      nowSeconds: 1_000n,
    }),
    ["claim_expiring"],
  );
  assert.deepEqual(
    deriveRaterSettlementNotificationKinds({
      commit: finalizedCommit,
      round: { ...finalizedRound, claimDeadline: String(1_000n + 25n * 60n * 60n) },
      nowSeconds: 1_000n,
    }),
    [],
  );
});

test("shows exact payout and deadline after finalization", () => {
  const base = source();
  const result = deriveRaterSettlementSnapshot({
    ...base,
    round: {
      ...(base.round as Record<string, unknown>),
      state: 5,
      status: "finalized",
      claimDeadline: "500",
    },
    commits: [
      {
        ...(base.commits as Array<Record<string, unknown>>)[0],
        revealed: true,
        scoringEligible: true,
        finalizedPayout: "1200000",
      },
    ],
  });
  assert.equal(result.canReveal, false);
  assert.equal(result.canClaim, true);
  assert.equal(result.claimKind, "payout");
  assert.equal(result.finalizedPayoutAtomic, "1200000");
  assert.equal(result.claimDeadline, "500");
});

test("fails closed across deployment identity and after the claim window", () => {
  assert.throws(
    () =>
      deriveRaterSettlementSnapshot(
        source({ deployment: { chainId: 84_532, panelAddress: PANEL, deploymentKey: "wrong" } }),
      ),
    /does not match/u,
  );
  const base = source();
  const expired = deriveRaterSettlementSnapshot({
    ...base,
    nowSeconds: 501n,
    round: {
      ...(base.round as Record<string, unknown>),
      state: 7,
      status: "under_quorum_compensated",
      claimDeadline: "500",
      compensationPerRecipient: "250000",
    },
    commits: [{ ...(base.commits as Array<Record<string, unknown>>)[0], revealed: true }],
  });
  assert.equal(expired.canClaim, false);
});

test("never credits round compensation to a commit that did not reveal", () => {
  const base = source();
  const baseCommit = (base.commits as Array<Record<string, unknown>>)[0];
  // A beacon-failure round is only reachable when nobody revealed, yet the contract still
  // publishes compensationPerRecipient, so Ponder indexes a non-zero round-level rate.
  const beaconFailureRound = {
    ...(base.round as Record<string, unknown>),
    state: 8,
    status: "beacon_failure_compensated",
    claimDeadline: "500",
    compensationPerRecipient: "250000",
    revealCount: 0,
  };

  const unrevealed = deriveReviewerEarningOutcome({
    localState: "confirmed",
    commit: { ...baseCommit, revealed: false },
    round: beaconFailureRound,
    nowSeconds: 400n,
  });
  assert.equal(unrevealed.earned, 0n);
  assert.equal(unrevealed.status, "no_payout");

  const snapshot = deriveRaterSettlementSnapshot({
    ...base,
    nowSeconds: 400n,
    round: beaconFailureRound,
    commits: [{ ...baseCommit, revealed: false }],
  });
  assert.equal(snapshot.claimKind, null);
  assert.equal(snapshot.canClaim, false);
  assert.equal(snapshot.compensationAtomic, "250000");

  // The revealed subset of an under-quorum round still earns the same published rate.
  const underQuorumRound = { ...beaconFailureRound, state: 7, status: "under_quorum_compensated", revealCount: 1 };
  const revealed = deriveReviewerEarningOutcome({
    localState: "confirmed",
    commit: { ...baseCommit, revealed: true },
    round: underQuorumRound,
    nowSeconds: 400n,
  });
  assert.equal(revealed.earned, 250_000n);
  assert.equal(revealed.status, "claimable");

  const unrevealedUnderQuorum = deriveReviewerEarningOutcome({
    localState: "confirmed",
    commit: { ...baseCommit, revealed: false },
    round: underQuorumRound,
    nowSeconds: 400n,
  });
  assert.equal(unrevealedUnderQuorum.earned, 0n);
  assert.equal(unrevealedUnderQuorum.status, "no_payout");

  const revealedSnapshot = deriveRaterSettlementSnapshot({
    ...base,
    nowSeconds: 400n,
    round: underQuorumRound,
    commits: [{ ...baseCommit, revealed: true }],
  });
  assert.equal(revealedSnapshot.claimKind, "compensation");
  assert.equal(revealedSnapshot.canClaim, true);
});

test("earnings stay principal-bound and reconcile the pinned settlement feed", () => {
  const sourceText = readFileSync(new URL("./raterSettlementService.ts", import.meta.url), "utf8");
  assert.match(sourceText, /WHERE p\.principal_id = \?/u);
  assert.match(sourceText, /ORDER BY c\.created_at DESC LIMIT 100/u);
  assert.match(sourceText, /settlementsUrl\.searchParams\.set\("commitKeys"/u);
  assert.match(sourceText, /indexed\.deploymentKey/u);
  assert.match(sourceText, /settlement_identity_mismatch/u);
  assert.match(sourceText, /totalClaimable/u);
});
