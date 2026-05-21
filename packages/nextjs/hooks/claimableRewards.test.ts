import {
  buildRoundClaimStateLookup,
  calculateLastClaimAwarePoolShare,
  getQuestionRewardClaimArgs,
  sortClaimableRewardItems,
} from "./claimableRewards";
import assert from "node:assert/strict";
import test from "node:test";

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

test("buildRoundClaimStateLookup prefers commit-key reward claims for delegated votes", () => {
  const lookup = buildRoundClaimStateLookup({
    contentId: 4n,
    roundId: 2n,
    connectedAddress: "0x2000000000000000000000000000000000000000",
    voter: "0x1000000000000000000000000000000000000000",
    commitKey: `0x${"a".repeat(64)}`,
    settled: true,
  });

  assert.deepEqual(lookup, {
    contract: "distributor",
    functionName: "rewardCommitClaimed",
    args: [4n, 2n, `0x${"a".repeat(64)}`],
  });
});

test("buildRoundClaimStateLookup falls back to raw voter address when no commit key is indexed", () => {
  const lookup = buildRoundClaimStateLookup({
    contentId: 4n,
    roundId: 2n,
    connectedAddress: "0x2000000000000000000000000000000000000000",
    voter: "0x1000000000000000000000000000000000000000",
    commitKey: null,
    settled: true,
  });

  assert.deepEqual(lookup, {
    contract: "distributor",
    functionName: "rewardClaimed",
    args: [4n, 2n, "0x1000000000000000000000000000000000000000"],
  });
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
  ]);

  assert.deepEqual(items, [
    {
      contentId: 2n,
      roundId: 1n,
      reward: 4n,
      claimType: "reward",
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
