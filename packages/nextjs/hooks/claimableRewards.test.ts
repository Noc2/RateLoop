import {
  buildVoterParticipationClaimableRewards,
  calculateLastClaimAwarePoolShare,
  getQuestionRewardClaimArgs,
  sortClaimableRewardItems,
} from "./claimableRewards";
import assert from "node:assert/strict";
import test from "node:test";

test("buildVoterParticipationClaimableRewards surfaces partially reserved winning-voter rewards", () => {
  const items = buildVoterParticipationClaimableRewards([
    {
      contentId: 4n,
      roundId: 2n,
      stake: 10_000_000n,
      rateBps: 9000n,
      totalReward: 18_000_000n,
      reservedReward: 9_000_000n,
      alreadyPaid: 2_000_000n,
      rewardPool: "0x4000000000000000000000000000000000000000",
      alreadyClaimed: false,
    },
  ]);

  assert.deepEqual(items, [
    {
      contentId: 4n,
      roundId: 2n,
      reward: 2_500_000n,
      claimType: "participation_reward",
    },
  ]);
});

test("buildVoterParticipationClaimableRewards skips already claimed or unbacked rewards", () => {
  const items = buildVoterParticipationClaimableRewards([
    {
      contentId: 4n,
      roundId: 2n,
      stake: 10_000_000n,
      rateBps: 9000n,
      totalReward: 18_000_000n,
      reservedReward: 18_000_000n,
      alreadyPaid: 0n,
      rewardPool: "0x4000000000000000000000000000000000000000",
      alreadyClaimed: true,
    },
    {
      contentId: 5n,
      roundId: 2n,
      stake: 10_000_000n,
      rateBps: 9000n,
      totalReward: 18_000_000n,
      reservedReward: 0n,
      alreadyPaid: 0n,
      rewardPool: "0x4000000000000000000000000000000000000000",
      alreadyClaimed: false,
    },
  ]);

  assert.deepEqual(items, []);
});

test("calculateLastClaimAwarePoolShare returns final claimant dust remainder", () => {
  assert.equal(
    calculateLastClaimAwarePoolShare({
      claimantWeight: 1n,
      totalWeight: 3n,
      pool: 10n,
      totalClaimants: 3n,
      claimedCount: 2n,
      claimedAmount: 6n,
    }),
    4n,
  );

  assert.equal(
    calculateLastClaimAwarePoolShare({
      claimantWeight: 1n,
      totalWeight: 3n,
      pool: 10n,
      totalClaimants: 3n,
      claimedCount: 1n,
      claimedAmount: 3n,
    }),
    3n,
  );
});

test("sortClaimableRewardItems keeps frontend round credits ahead of the final frontend withdrawal", () => {
  const items = sortClaimableRewardItems([
    {
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 5n,
      claimType: "frontend_registry_fee",
    },
    {
      contentId: 8n,
      roundId: 2n,
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 3n,
      claimType: "frontend_round_fee",
    },
    {
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "LREP",
      title: "Is this worth it?",
      claimType: "question_reward",
    },
    {
      contentId: 2n,
      roundId: 1n,
      reward: 4n,
      claimType: "reward",
    },
    {
      contentId: 2n,
      roundId: 1n,
      reward: 1n,
      claimType: "participation_reward",
    },
  ]);

  assert.deepEqual(items, [
    {
      contentId: 2n,
      roundId: 1n,
      reward: 4n,
      claimType: "reward",
    },
    {
      contentId: 2n,
      roundId: 1n,
      reward: 1n,
      claimType: "participation_reward",
    },
    {
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "LREP",
      title: "Is this worth it?",
      claimType: "question_reward",
    },
    {
      contentId: 8n,
      roundId: 2n,
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 3n,
      claimType: "frontend_round_fee",
    },
    {
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 5n,
      claimType: "frontend_registry_fee",
    },
  ]);
});

test("getQuestionRewardClaimArgs includes payout proof data when present", () => {
  const payoutWeight = {
    domain: 1,
    rewardPoolId: 9n,
    contentId: 5n,
    roundId: 1n,
    commitKey: `0x${"a".repeat(64)}` as const,
    identityKey: `0x${"b".repeat(64)}` as const,
    account: "0x3000000000000000000000000000000000000000" as const,
    baseWeight: 10_000n,
    independenceBps: 8_000,
    effectiveWeight: 8_000n,
    reasonHash: `0x${"c".repeat(64)}` as const,
  };
  const payoutProof = [`0x${"d".repeat(64)}` as const];

  assert.deepEqual(
    getQuestionRewardClaimArgs({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "USDC",
      title: "Is this worth it?",
      payoutWeight,
      payoutProof,
      claimType: "question_reward",
    }),
    [9n, 1n, payoutWeight, payoutProof],
  );

  assert.deepEqual(
    getQuestionRewardClaimArgs({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "LREP",
      title: "Is this worth it?",
      claimType: "question_reward",
    }),
    [9n, 1n],
  );
});
