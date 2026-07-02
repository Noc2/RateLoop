import assert from "node:assert/strict";
import test from "node:test";
import {
  describeOpenRoundActivity,
  estimateVoteReturn,
  formatLrepAmount,
  getRoundProgressMessaging,
} from "~~/lib/vote/voteIncentives";

test("formatLrepAmount preserves half-LREP stake precision", () => {
  assert.equal(formatLrepAmount(5_500_000n), "5.5");
  assert.equal(formatLrepAmount(6_000_000n), "6");
});

test("formatLrepAmount keeps precision past Number.MAX_SAFE_INTEGER", () => {
  // 9_007_199_254_740_993 micro-LREP would lose 1 micro through Number conversion.
  assert.equal(formatLrepAmount(9_007_199_254_740_993n), "9,007,199,254.7");
});

test("formatLrepAmount(_, 0) rounds half up to the nearest whole unit", () => {
  assert.equal(formatLrepAmount(500_000n, 0), "1");
  assert.equal(formatLrepAmount(499_999n, 0), "0");
  assert.equal(formatLrepAmount(10_500_000n, 0), "11");
});

test("getRoundProgressMessaging shows blind urgency", () => {
  const message = getRoundProgressMessaging({
    phase: "voting",
    isEpoch1: true,
    epoch1Remaining: 11 * 60,
    readyToSettle: false,
    thresholdReachedAt: 0,
    voteCount: 1,
    revealedCount: 0,
    minVoters: 3,
    upPool: 0n,
    downPool: 0n,
    weightedUpPool: 0n,
    weightedDownPool: 0n,
  });

  assert.deepEqual(message, {
    badgeLabel: "Blind",
    badgeTone: "primary",
    detailLabel: "11:00 left",
    detailTone: "warning",
    tooltip:
      "Blind signals stay hidden and earn full reward weight. Open-phase signals use 25% informed weight, so early raters keep the 4x advantage.",
  });
});

test("getRoundProgressMessaging reframes open rounds around settlement momentum", () => {
  const message = getRoundProgressMessaging({
    phase: "voting",
    isEpoch1: false,
    epoch1Remaining: 0,
    readyToSettle: false,
    thresholdReachedAt: 0,
    voteCount: 2,
    revealedCount: 1,
    minVoters: 3,
    upPool: 10n,
    downPool: 8n,
    weightedUpPool: 10n,
    weightedDownPool: 8n,
  });

  assert.equal(message?.badgeLabel, "Open");
  assert.equal(message?.detailLabel, "2 more revealed signals to settle");
});

test("describeOpenRoundActivity uses revealed predictions for settlement progress", () => {
  assert.equal(
    describeOpenRoundActivity({
      totalStake: 30_000_000n,
      voteCount: 2,
      revealedCount: 0,
      minVoters: 3,
    }),
    "30 LREP active · 3 more revealed signals to settle.",
  );
});

test("describeOpenRoundActivity keeps using reveal progress after commit quorum is reached", () => {
  assert.equal(
    describeOpenRoundActivity({
      totalStake: 30_000_000n,
      voteCount: 3,
      revealedCount: 1,
      minVoters: 3,
    }),
    "30 LREP active · 2 more revealed signals to settle.",
  );
});

test("estimateVoteReturn uses informed weight without projecting majority-pool rewards", () => {
  const estimate = estimateVoteReturn(
    {
      isEpoch1: false,
    },
    true,
    10,
  );

  assert.equal(estimate.effectiveStakeMicro, 2_500_000n);
  assert.equal(estimate.projectedVoterPoolMicro, 0n);
  assert.equal(estimate.projectedPoolShareMicro, 0n);
  assert.equal(estimate.estimatedGrossReturnMicro, 10_000_000n);
  assert.equal(estimate.belowMeanFloorMicro, 0n);
});

test("estimateVoteReturn keeps full weight during blind phase", () => {
  const estimate = estimateVoteReturn(
    {
      isEpoch1: true,
    },
    true,
    10,
  );

  assert.equal(estimate.effectiveStakeMicro, 10_000_000n);
  assert.equal(estimate.projectedPoolShareMicro, 0n);
  assert.equal(estimate.estimatedGrossReturnMicro, 10_000_000n);
});
