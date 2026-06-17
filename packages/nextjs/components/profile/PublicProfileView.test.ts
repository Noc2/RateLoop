import assert from "node:assert/strict";
import test from "node:test";
import { formatLaunchRewardDetail } from "~~/components/profile/PublicProfileView";

const baseLaunchRewards: Parameters<typeof formatLaunchRewardDetail>[0] = {
  capBps: 0,
  cohortIndex: null,
  distinctAnchorRoundCount: 0,
  distinctVerifiedAnchorCount: 0,
  eligible: false,
  fullCapUnlocked: false,
  fullLaunchCap: "0",
  latestCreditedAt: null,
  latestPaidAt: null,
  launchCap: "0",
  launchPaid: "0",
  policy: {},
  qualifyingRatingCount: 0,
  remainingLaunchCap: "0",
  remainingRewardSlots: 0,
  rewardedRatingCount: 0,
  unlockableLaunchCap: "0",
};

test("launch reward detail is hidden when no credits or unlockable cap exist", () => {
  assert.equal(formatLaunchRewardDetail(baseLaunchRewards), null);
});

test("launch reward detail preserves useful progress and unlock prompts", () => {
  assert.equal(
    formatLaunchRewardDetail({
      ...baseLaunchRewards,
      qualifyingRatingCount: 3,
    }),
    "3 qualifying ratings recorded",
  );
  assert.equal(
    formatLaunchRewardDetail({
      ...baseLaunchRewards,
      fullLaunchCap: "10000000",
      unlockableLaunchCap: "10000000",
    }),
    "Verify to unlock 10 LREP",
  );
});
