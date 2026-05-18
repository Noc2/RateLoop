import { RoundData } from "../../types/votingTypes";
import {
  DEFAULT_VOTING_CONFIG,
  buildStakeAmountWei,
  deriveRoundSnapshot,
  deriveVoteDeadlines,
  isOptimisticRoundDeltaReflected,
  isRoundAcceptingVotes,
  mergeRoundDataWithFallback,
  parseRound,
  resolveFrontendCode,
} from "./roundVotingEngine";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import assert from "node:assert/strict";
import test from "node:test";

function makeRound(overrides: Partial<RoundData> = {}): RoundData {
  return {
    startTime: 1_000n,
    state: ROUND_STATE.Open,
    voteCount: 0n,
    revealedCount: 0n,
    totalStake: 0n,
    upPool: 0n,
    downPool: 0n,
    upCount: 0n,
    downCount: 0n,
    upWins: false,
    settledAt: 0n,
    thresholdReachedAt: 0n,
    weightedUpPool: 0n,
    weightedDownPool: 0n,
    ...overrides,
  };
}

test("deriveRoundSnapshot tracks settlement readiness from revealed votes, not committed votes", () => {
  const snapshot = deriveRoundSnapshot({
    roundId: 1n,
    round: makeRound({
      voteCount: 3n,
      revealedCount: 1n,
      totalStake: 30_000_000n,
    }),
    config: DEFAULT_VOTING_CONFIG,
    now: 1_100,
  });

  assert.equal(snapshot.voteCount, 3);
  assert.equal(snapshot.revealedCount, 1);
  assert.equal(snapshot.votersNeeded, 2);
  assert.equal(snapshot.readyToSettle, false);
});

test("deriveRoundSnapshot marks rounds ready once the revealed threshold is met", () => {
  const snapshot = deriveRoundSnapshot({
    roundId: 1n,
    round: makeRound({
      voteCount: 5n,
      revealedCount: BigInt(DEFAULT_VOTING_CONFIG.minVoters),
      thresholdReachedAt: 1_250n,
    }),
    config: DEFAULT_VOTING_CONFIG,
    now: 1_300,
  });

  assert.equal(snapshot.votersNeeded, 0);
  assert.equal(snapshot.readyToSettle, true);
  assert.equal(snapshot.thresholdReachedAt, 1250);
});

test("isOptimisticRoundDeltaReflected detects when live round data includes an optimistic vote", () => {
  const optimisticDelta = {
    baseTotalStake: 10_000_000n,
    baseVoteCount: 1n,
    roundId: 7n,
    stake: 10_000_000n,
    voteCount: 1,
  };

  assert.equal(
    isOptimisticRoundDeltaReflected({
      optimisticDelta,
      round: makeRound({ totalStake: 10_000_000n, voteCount: 1n }),
      roundId: 7n,
    }),
    false,
  );
  assert.equal(
    isOptimisticRoundDeltaReflected({
      optimisticDelta,
      round: makeRound({ totalStake: 20_000_000n, voteCount: 2n }),
      roundId: 7n,
    }),
    true,
  );
});

test("parseRound prefers tuple values when named round fields are incomplete", () => {
  const rawRound = Object.assign(
    [1_000n, ROUND_STATE.Open, 1n, 0n, 50_000_000n, 50_000_000n, 0n, 1n, 0n, true, 0n, 0n, 50_000_000n, 0n],
    {
      startTime: 1_000n,
      state: ROUND_STATE.Open,
      totalStake: 50_000_000n,
      upPool: 50_000_000n,
    },
  );

  const parsedRound = parseRound(rawRound);

  assert.ok(parsedRound);
  assert.equal(parsedRound.voteCount, 1n);
  assert.equal(parsedRound.totalStake, 50_000_000n);
  assert.equal(parsedRound.upCount, 1n);
});

test("mergeRoundDataWithFallback keeps the higher feed vote totals for the same round", () => {
  const merged = mergeRoundDataWithFallback({
    roundId: 7n,
    round: makeRound({
      startTime: 1_000n,
      voteCount: 0n,
      totalStake: 0n,
    }),
    fallback: {
      roundId: 7n,
      voteCount: 1,
      revealedCount: 0,
      totalStake: 10_000_000n,
      upPool: 10_000_000n,
      downPool: 0n,
      upCount: 1,
      downCount: 0,
      startTime: 1_000n,
    },
  });

  assert.equal(merged.roundId, 7n);
  assert.ok(merged.round);
  assert.equal(merged.round.voteCount, 1n);
  assert.equal(merged.round.totalStake, 10_000_000n);
  assert.equal(merged.round.upPool, 10_000_000n);
  assert.equal(merged.round.upCount, 1n);
});

test("mergeRoundDataWithFallback keeps the fallback start time when the round snapshot is zeroed", () => {
  const merged = mergeRoundDataWithFallback({
    roundId: 7n,
    round: makeRound({
      startTime: 0n,
      voteCount: 1n,
      totalStake: 25_000_000n,
    }),
    fallback: {
      roundId: 7n,
      voteCount: 1,
      revealedCount: 0,
      totalStake: 25_000_000n,
      upPool: 25_000_000n,
      downPool: 0n,
      startTime: 1_000n,
    },
  });

  assert.equal(merged.roundId, 7n);
  assert.ok(merged.round);
  assert.equal(merged.round.startTime, 1_000n);
});

test("mergeRoundDataWithFallback ignores feed data from a different round", () => {
  const baseRound = makeRound({
    startTime: 1_000n,
    voteCount: 0n,
    totalStake: 0n,
  });
  const merged = mergeRoundDataWithFallback({
    roundId: 7n,
    round: baseRound,
    fallback: {
      roundId: 8n,
      voteCount: 1,
      revealedCount: 0,
      totalStake: 10_000_000n,
      upPool: 10_000_000n,
      downPool: 0n,
      startTime: 1_000n,
    },
  });

  assert.equal(merged.roundId, 7n);
  assert.equal(merged.round, baseRound);
});

test("deriveVoteDeadlines returns the round expiry and next action window", () => {
  const deadlines = deriveVoteDeadlines({
    startTime: 1_000,
    now: 1_500,
    epochDuration: 600,
    maxDuration: 3_600,
  });

  assert.equal(deadlines.epoch1EndTime, 1_600);
  assert.equal(deadlines.deadline, 4_600);
  assert.equal(deadlines.epoch1Remaining, 100);
  assert.equal(deadlines.nextActionRemaining, 100);
});

test("deriveVoteDeadlines falls back to round expiry after epoch 1", () => {
  const deadlines = deriveVoteDeadlines({
    startTime: 1_000,
    now: 1_800,
    epochDuration: 600,
    maxDuration: 3_600,
  });

  assert.equal(deadlines.epoch1Remaining, 0);
  assert.equal(deadlines.nextActionRemaining, deadlines.roundTimeRemaining);
});

test("isRoundAcceptingVotes allows active content to start a fresh round", () => {
  const snapshot = deriveRoundSnapshot({
    roundId: 0n,
    config: DEFAULT_VOTING_CONFIG,
    now: 1_500,
  });

  assert.equal(isRoundAcceptingVotes(snapshot), true);
});

test("isRoundAcceptingVotes rejects expired and threshold-reached open rounds", () => {
  const openSnapshot = deriveRoundSnapshot({
    roundId: 1n,
    round: makeRound(),
    config: DEFAULT_VOTING_CONFIG,
    now: 1_500,
  });
  const expiredSnapshot = deriveRoundSnapshot({
    roundId: 1n,
    round: makeRound(),
    config: DEFAULT_VOTING_CONFIG,
    now: 1_000 + DEFAULT_VOTING_CONFIG.maxDuration,
  });
  const thresholdReachedSnapshot = deriveRoundSnapshot({
    roundId: 1n,
    round: makeRound({ thresholdReachedAt: 1_300n }),
    config: DEFAULT_VOTING_CONFIG,
    now: 1_500,
  });

  assert.equal(isRoundAcceptingVotes(openSnapshot), true);
  assert.equal(isRoundAcceptingVotes(expiredSnapshot), false);
  assert.equal(isRoundAcceptingVotes(thresholdReachedSnapshot), false);
});

test("vote helpers normalize stake and frontend codes", () => {
  assert.equal(buildStakeAmountWei(2.5), 2_500_000n);
  assert.equal(buildStakeAmountWei(0), 0n);
  assert.equal(
    resolveFrontendCode(undefined, "0x1111111111111111111111111111111111111111"),
    "0x1111111111111111111111111111111111111111",
  );
  assert.equal(resolveFrontendCode(undefined, undefined), "0x0000000000000000000000000000000000000000");
});
