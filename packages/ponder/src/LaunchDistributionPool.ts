import { ponder } from "ponder:registry";
import { globalStats, profile, rewardClaim } from "ponder:schema";

async function creditLaunchReward(context: any, recipient: `0x${string}`, amount: bigint) {
  const existingProfile = await context.db.find(profile, { address: recipient });
  if (existingProfile) {
    await context.db
      .update(profile, { address: recipient })
      .set((row: any) => ({
        totalRewardsClaimed: row.totalRewardsClaimed + amount,
      }));
  }

  await context.db
    .insert(globalStats)
    .values({
      id: "global",
      totalContent: 0,
      totalVotes: 0,
      totalRoundsSettled: 0,
      totalRewardsClaimed: amount,
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row: any) => ({
      totalRewardsClaimed: row.totalRewardsClaimed + amount,
    }));
}

ponder.on("LaunchDistributionPool:EarnedRaterRewardPaid", async ({ event, context }) => {
  const { rater, amount } = event.args;

  await context.db
    .insert(rewardClaim)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      contentId: 0n,
      roundId: 0n,
      source: "launch",
      voter: rater,
      stakeReturned: 0n,
      hrepReward: amount,
      claimedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await creditLaunchReward(context, rater, amount);
});

ponder.on("LaunchDistributionPool:VerifiedBonusClaimed", async ({ event, context }) => {
  const { account, amount } = event.args;

  await context.db
    .insert(rewardClaim)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      contentId: 0n,
      roundId: 0n,
      source: "launch",
      voter: account,
      stakeReturned: 0n,
      hrepReward: amount,
      claimedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await creditLaunchReward(context, account, amount);
});

ponder.on("LaunchDistributionPool:ReferralBonusPaid", async ({ event, context }) => {
  const { referrer, amount } = event.args;

  await context.db
    .insert(rewardClaim)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      contentId: 0n,
      roundId: 0n,
      source: "launch",
      voter: referrer,
      stakeReturned: 0n,
      hrepReward: amount,
      claimedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await creditLaunchReward(context, referrer, amount);
});

ponder.on("LaunchDistributionPool:LegacyClaimed", async ({ event, context }) => {
  const { account, amount } = event.args;

  await context.db
    .insert(rewardClaim)
    .values({
      id: `${event.transaction.hash}-${event.log.logIndex}`,
      contentId: 0n,
      roundId: 0n,
      source: "launch",
      voter: account,
      stakeReturned: 0n,
      hrepReward: amount,
      claimedAt: event.block.timestamp,
    })
    .onConflictDoNothing();

  await creditLaunchReward(context, account, amount);
});
