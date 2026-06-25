import {
  buildRoundClaimStateLookup,
  calculateLastClaimAwarePoolShare,
  claimItemMayWriteLrepCheckpoint,
  getClaimableRewardItemKey,
  getClaimableRoundKey,
  getQuestionRewardClaimArgs,
  hasIndexedRefundClaim,
  pollClaimableRewardsRefresh,
  sortClaimableRewardItems,
  sumClaimableRewardTotals,
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

test("hasIndexedRefundClaim treats any indexed timestamp as an already claimed refund", () => {
  assert.equal(hasIndexedRefundClaim({ refundClaimedAt: "1710000000" }), true);
  assert.equal(hasIndexedRefundClaim({ refundClaimedAt: 1710000000n }), true);
  assert.equal(hasIndexedRefundClaim({ refundClaimedAt: null }), false);
  assert.equal(hasIndexedRefundClaim({}), false);
});

test("sortClaimableRewardItems keeps frontend round credits ahead of the final frontend withdrawal", () => {
  const items = sortClaimableRewardItems([
    {
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 5n,
      claimType: "frontend_registry_fee",
    },
    {
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 7n,
      claimType: "frontend_registry_withdrawal",
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
    // The matured-withdrawal completion frees the single pending slot before the
    // new withdrawal request runs.
    {
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 7n,
      claimType: "frontend_registry_withdrawal",
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

  assert.deepEqual(
    getQuestionRewardClaimArgs({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "USDC",
      title: "Is this worth it?",
      payoutWeight,
      claimType: "question_reward",
    }),
    [9n, 1n],
  );

  assert.deepEqual(
    getQuestionRewardClaimArgs({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "USDC",
      title: "Is this worth it?",
      payoutProof,
      claimType: "question_reward",
    }),
    [9n, 1n],
  );
});

test("getClaimableRoundKey namespaces question and bundle rewards", () => {
  assert.equal(
    getClaimableRoundKey({
      contentId: 8n,
      roundId: 2n,
      reward: 3n,
      claimType: "reward",
    }),
    "8-2",
  );
  assert.equal(
    getClaimableRoundKey({
      contentId: 8n,
      roundId: 2n,
      reward: 3n,
      claimType: "refund",
    }),
    "8-2",
  );
  assert.equal(
    getClaimableRoundKey({
      contentId: 8n,
      roundId: 2n,
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 3n,
      claimType: "frontend_round_fee",
    }),
    "8-2",
  );
  assert.equal(
    getClaimableRoundKey({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "USDC",
      title: "Is this worth it?",
      claimType: "question_reward",
    }),
    "question-reward:9-1",
  );
  assert.equal(
    getClaimableRoundKey({
      bundleId: 11n,
      roundSetIndex: 3n,
      reward: 2n,
      asset: "LREP",
      title: "Bundle",
      claimType: "question_bundle_reward",
    }),
    "question-bundle-reward:11-3",
  );
  assert.equal(
    getClaimableRoundKey({
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 5n,
      claimType: "frontend_registry_fee",
    }),
    null,
  );
  assert.equal(
    getClaimableRoundKey({
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 7n,
      claimType: "frontend_registry_withdrawal",
    }),
    null,
  );
});

test("getClaimableRewardItemKey includes claim type for round rewards", () => {
  assert.equal(
    getClaimableRewardItemKey({
      contentId: 3n,
      roundId: 4n,
      reward: 1_000_000n,
      claimType: "reward",
    }),
    "reward:3-4",
  );
  assert.equal(
    getClaimableRewardItemKey({
      contentId: 3n,
      roundId: 4n,
      reward: 1_000_000n,
      claimType: "refund",
    }),
    "refund:3-4",
  );
});

test("sumClaimableRewardTotals splits LREP and USDC question rewards", () => {
  assert.deepEqual(
    sumClaimableRewardTotals([
      {
        contentId: 3n,
        roundId: 4n,
        reward: 1_000_000n,
        claimType: "reward",
      },
      {
        rewardPoolId: 9n,
        contentId: 5n,
        roundId: 1n,
        reward: 2_000_000n,
        asset: "USDC",
        title: "USDC bounty",
        claimType: "question_reward",
      },
    ]),
    {
      totalLrepClaimable: 1_000_000n,
      totalUsdcClaimable: 2_000_000n,
    },
  );
});

test("pollClaimableRewardsRefresh stops early when shouldStop returns true", async () => {
  let refetchCount = 0;
  await pollClaimableRewardsRefresh(
    async () => {
      refetchCount += 1;
    },
    { attempts: 8, intervalMs: 0, shouldStop: () => refetchCount >= 2 },
  );
  assert.equal(refetchCount, 2);
});

test("claimItemMayWriteLrepCheckpoint identifies LREP-paying claim paths", () => {
  assert.equal(
    claimItemMayWriteLrepCheckpoint({
      contentId: 8n,
      roundId: 2n,
      reward: 3n,
      claimType: "reward",
    }),
    true,
  );
  assert.equal(
    claimItemMayWriteLrepCheckpoint({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "LREP",
      title: "Is this worth it?",
      claimType: "question_reward",
    }),
    true,
  );
  assert.equal(
    claimItemMayWriteLrepCheckpoint({
      rewardPoolId: 9n,
      contentId: 5n,
      roundId: 1n,
      reward: 2n,
      asset: "USDC",
      title: "Is this worth it?",
      claimType: "question_reward",
    }),
    false,
  );
  assert.equal(
    claimItemMayWriteLrepCheckpoint({
      frontend: "0x3000000000000000000000000000000000000000",
      reward: 5n,
      claimType: "frontend_registry_fee",
    }),
    false,
  );
});
