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

test("getRoundProgressMessaging makes blind rounds sell bonus and urgency", () => {
  const message = getRoundProgressMessaging(
    {
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
    },
    90,
  );

  assert.deepEqual(message, {
    badgeLabel: "Blind",
    badgeTone: "primary",
    detailLabel: "+90% bonus · 11:00 left",
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

test("estimateVoteReturn uses informed weight during open phase", () => {
  const estimate = estimateVoteReturn(
    {
      isEpoch1: false,
      upPool: 20_000_000n,
      downPool: 40_000_000n,
      weightedUpPool: 20_000_000n,
      weightedDownPool: 40_000_000n,
    },
    true,
    10,
  );

  assert.equal(estimate.effectiveStakeMicro, 2_500_000n);
  assert.equal(estimate.projectedVoterPoolMicro, 38_400_000n);
  assert.equal(estimate.projectedPoolShareMicro, 4_266_666n);
  assert.equal(estimate.estimatedGrossReturnMicro, 14_266_666n);
  assert.equal(estimate.belowMeanFloorMicro, 0n);
});

test("estimateVoteReturn keeps full weight during blind phase", () => {
  const estimate = estimateVoteReturn(
    {
      isEpoch1: true,
      upPool: 20_000_000n,
      downPool: 40_000_000n,
      weightedUpPool: 20_000_000n,
      weightedDownPool: 40_000_000n,
    },
    true,
    10,
  );

  assert.equal(estimate.effectiveStakeMicro, 10_000_000n);
  assert.equal(estimate.projectedPoolShareMicro, 12_800_000n);
  assert.equal(estimate.estimatedGrossReturnMicro, 22_800_000n);
});
