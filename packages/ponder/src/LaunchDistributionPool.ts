import { ponder } from "ponder:registry";
import {
  globalStats,
  launchEarnedRaterCredit,
  launchRaterRewardProgress,
  launchRewardPolicyState,
  profile,
  rewardClaim,
} from "ponder:schema";

const CURRENT_LAUNCH_REWARD_POLICY_ID = "current";

function launchCreditId(
  contentId: bigint,
  roundId: bigint,
  commitKey: `0x${string}`,
) {
  return `${contentId.toString()}-${roundId.toString()}-${commitKey.toLowerCase()}`;
}

function buildLaunchProgressDefaults(rater: `0x${string}`, timestamp: bigint) {
  return {
    rater,
    qualifyingRatingCount: 0,
    qualifyingCreditBps: 0n,
    rewardedRatingCount: 0,
    distinctVerifiedAnchorCount: 0,
    distinctAnchorRoundCount: 0,
    payoutEligible: false,
    launchCap: 0n,
    fullLaunchCap: 0n,
    capBps: 0,
    fullCapUnlocked: false,
    capUnlockNullifierHash: null,
    launchPaid: 0n,
    cohortIndex: null,
    lastQualifiedContentId: null,
    lastQualifiedRoundId: null,
    lastCommitKey: null,
    lastScoreBps: null,
    eligibleAt: null,
    latestCreditedAt: null,
    latestPaidAt: null,
    updatedAt: timestamp,
  };
}

async function creditLaunchReward(
  context: any,
  recipient: `0x${string}`,
  amount: bigint,
) {
  const existingProfile = await context.db.find(profile, {
    address: recipient,
  });
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
      totalFrontendFeesClaimed: 0n,
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row: any) => ({
      totalRewardsClaimed: row.totalRewardsClaimed + amount,
    }));
}

ponder.on(
  "LaunchDistributionPool:EarnedRaterRewardPaid",
  async ({ event, context }) => {
    const { rater, contentId, roundId, amount } = event.args;

    await context.db
      .insert(rewardClaim)
      .values({
        id: `${event.transaction.hash}-${event.log.logIndex}`,
        contentId,
        roundId,
        source: "launch",
        voter: rater,
        stakeReturned: 0n,
        lrepReward: amount,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    await creditLaunchReward(context, rater, amount);

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        qualifyingRatingCount: Number(event.args.qualifyingRatingCount),
        qualifyingCreditBps: event.args.qualifyingCreditBps,
        rewardedRatingCount: Number(event.args.rewardedRatingCount),
        distinctVerifiedAnchorCount: Number(
          event.args.distinctVerifiedAnchorCount,
        ),
        distinctAnchorRoundCount: Number(event.args.distinctAnchorRoundCount),
        payoutEligible: true,
        launchPaid: amount,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: event.args.commitKey,
        lastScoreBps: Number(event.args.scoreBps),
        eligibleAt: event.block.timestamp,
        latestCreditedAt: event.block.timestamp,
        latestPaidAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row: any) => ({
        qualifyingRatingCount: Number(event.args.qualifyingRatingCount),
        qualifyingCreditBps: event.args.qualifyingCreditBps,
        rewardedRatingCount: Number(event.args.rewardedRatingCount),
        distinctVerifiedAnchorCount: Number(
          event.args.distinctVerifiedAnchorCount,
        ),
        distinctAnchorRoundCount: Number(event.args.distinctAnchorRoundCount),
        payoutEligible: true,
        launchPaid: row.launchPaid + amount,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: event.args.commitKey,
        lastScoreBps: Number(event.args.scoreBps),
        eligibleAt: event.block.timestamp,
        latestCreditedAt: event.block.timestamp,
        latestPaidAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on(
  "LaunchDistributionPool:LaunchRewardPolicyUpdated",
  async ({ event, context }) => {
    const { policy } = event.args;

    await context.db
      .insert(launchRewardPolicyState)
      .values({
        id: CURRENT_LAUNCH_REWARD_POLICY_ID,
        minQualifyingScoreBps: Number(policy.minQualifyingScoreBps),
        minVoters: Number(policy.minVoters),
        minVerifiedHumans: Number(policy.minVerifiedHumans),
        minDistinctVerifiedAnchors: Number(policy.minDistinctVerifiedAnchors),
        minDistinctAnchorRounds: Number(policy.minDistinctAnchorRounds),
        eligibilityRatingCount: Number(policy.eligibilityRatingCount),
        rewardingRatingCount: Number(policy.rewardingRatingCount),
        unverifiedEarnedRaterCapBps: Number(policy.unverifiedEarnedRaterCapBps),
        minAnchorCredentialAgeSeconds: Number(
          policy.minAnchorCredentialAgeSeconds,
        ),
        requireNoPendingCleanup: policy.requireNoPendingCleanup,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        minQualifyingScoreBps: Number(policy.minQualifyingScoreBps),
        minVoters: Number(policy.minVoters),
        minVerifiedHumans: Number(policy.minVerifiedHumans),
        minDistinctVerifiedAnchors: Number(policy.minDistinctVerifiedAnchors),
        minDistinctAnchorRounds: Number(policy.minDistinctAnchorRounds),
        eligibilityRatingCount: Number(policy.eligibilityRatingCount),
        rewardingRatingCount: Number(policy.rewardingRatingCount),
        unverifiedEarnedRaterCapBps: Number(policy.unverifiedEarnedRaterCapBps),
        minAnchorCredentialAgeSeconds: Number(
          policy.minAnchorCredentialAgeSeconds,
        ),
        requireNoPendingCleanup: policy.requireNoPendingCleanup,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:RaterLaunchCapAssigned",
  async ({ event, context }) => {
    const { rater, cap, cohortIndex } = event.args;

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        launchCap: cap,
        cohortIndex,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        launchCap: cap,
        cohortIndex,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:RaterLaunchCapStatusUpdated",
  async ({ event, context }) => {
    const { rater, activeCap, fullCap, activeCapBps, fullCapUnlocked } =
      event.args;

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        launchCap: activeCap,
        fullLaunchCap: fullCap,
        capBps: Number(activeCapBps),
        fullCapUnlocked,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        launchCap: activeCap,
        fullLaunchCap: fullCap,
        capBps: Number(activeCapBps),
        fullCapUnlocked,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:RaterLaunchCapUnlocked",
  async ({ event, context }) => {
    const { rater, nullifierHash, fullCap, catchUpPaid } = event.args;

    if (catchUpPaid > 0n) {
      await context.db
        .insert(rewardClaim)
        .values({
          id: `${event.transaction.hash}-${event.log.logIndex}`,
          contentId: 0n,
          roundId: 0n,
          source: "launch",
          voter: rater,
          stakeReturned: 0n,
          lrepReward: catchUpPaid,
          claimedAt: event.block.timestamp,
        })
        .onConflictDoNothing();

      await creditLaunchReward(context, rater, catchUpPaid);
    }

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        launchCap: fullCap,
        fullLaunchCap: fullCap,
        capBps: 10_000,
        fullCapUnlocked: true,
        capUnlockNullifierHash: nullifierHash,
        launchPaid: catchUpPaid,
        latestPaidAt: catchUpPaid > 0n ? event.block.timestamp : null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row: any) => ({
        launchCap: fullCap,
        fullLaunchCap: fullCap,
        capBps: 10_000,
        fullCapUnlocked: true,
        capUnlockNullifierHash: nullifierHash,
        launchPaid: row.launchPaid + catchUpPaid,
        latestPaidAt:
          catchUpPaid > 0n ? event.block.timestamp : row.latestPaidAt,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on(
  "LaunchDistributionPool:EarnedRaterRewardCreditRecorded",
  async ({ event, context }) => {
    const {
      rater,
      contentId,
      roundId,
      commitKey,
      scoreBps,
      qualifyingRatingCount,
      distinctVerifiedAnchorCount,
      distinctAnchorRoundCount,
      qualifyingCreditBps,
      payoutEligible,
    } = event.args;

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        qualifyingRatingCount: Number(qualifyingRatingCount),
        qualifyingCreditBps,
        distinctVerifiedAnchorCount: Number(distinctVerifiedAnchorCount),
        distinctAnchorRoundCount: Number(distinctAnchorRoundCount),
        payoutEligible,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        lastScoreBps: Number(scoreBps),
        eligibleAt: payoutEligible ? event.block.timestamp : null,
        latestCreditedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row: any) => ({
        qualifyingRatingCount: Number(qualifyingRatingCount),
        qualifyingCreditBps,
        distinctVerifiedAnchorCount: Number(distinctVerifiedAnchorCount),
        distinctAnchorRoundCount: Number(distinctAnchorRoundCount),
        payoutEligible,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        lastScoreBps: Number(scoreBps),
        eligibleAt: payoutEligible ? event.block.timestamp : row.eligibleAt,
        latestCreditedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on(
  "LaunchDistributionPool:EarnedRaterRewardCreditPending",
  async ({ event, context }) => {
    const { rater, contentId, roundId, commitKey, scoreBps } = event.args;

    await context.db
      .insert(launchEarnedRaterCredit)
      .values({
        id: launchCreditId(contentId, roundId, commitKey),
        rater,
        contentId,
        roundId,
        commitKey,
        scoreBps: Number(scoreBps),
        pending: true,
        finalized: false,
        cancelled: false,
        effectiveCreditBps: null,
        qualifyingCreditBps: null,
        recordedAt: event.block.timestamp,
        finalizedAt: null,
        cancelledAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        rater,
        contentId,
        roundId,
        commitKey,
        scoreBps: Number(scoreBps),
        pending: true,
        finalized: false,
        cancelled: false,
        effectiveCreditBps: null,
        qualifyingCreditBps: null,
        recordedAt: event.block.timestamp,
        finalizedAt: null,
        cancelledAt: null,
        updatedAt: event.block.timestamp,
      });

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        lastScoreBps: Number(scoreBps),
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        lastScoreBps: Number(scoreBps),
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:EarnedRaterRewardCreditFinalized",
  async ({ event, context }) => {
    const {
      rater,
      contentId,
      roundId,
      commitKey,
      effectiveCreditBps,
      qualifyingCreditBps,
    } = event.args;

    await context.db
      .insert(launchEarnedRaterCredit)
      .values({
        id: launchCreditId(contentId, roundId, commitKey),
        rater,
        contentId,
        roundId,
        commitKey,
        scoreBps: 0,
        pending: false,
        finalized: true,
        cancelled: false,
        effectiveCreditBps,
        qualifyingCreditBps,
        recordedAt: event.block.timestamp,
        finalizedAt: event.block.timestamp,
        cancelledAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        rater,
        contentId,
        roundId,
        commitKey,
        pending: false,
        finalized: true,
        cancelled: false,
        effectiveCreditBps,
        qualifyingCreditBps,
        finalizedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      });

    await context.db
      .insert(launchRaterRewardProgress)
      .values({
        ...buildLaunchProgressDefaults(rater, event.block.timestamp),
        qualifyingCreditBps,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        latestCreditedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row: any) => ({
        qualifyingCreditBps,
        lastQualifiedContentId: contentId,
        lastQualifiedRoundId: roundId,
        lastCommitKey: commitKey,
        latestCreditedAt:
          effectiveCreditBps > 0n
            ? event.block.timestamp
            : row.latestCreditedAt,
        updatedAt: event.block.timestamp,
      }));
  },
);

ponder.on(
  "LaunchDistributionPool:StalePendingEarnedRaterCreditCancelled",
  async ({ event, context }) => {
    const { rater, contentId, roundId, commitKey } = event.args;

    await context.db
      .insert(launchEarnedRaterCredit)
      .values({
        id: launchCreditId(contentId, roundId, commitKey),
        rater,
        contentId,
        roundId,
        commitKey,
        scoreBps: 0,
        pending: false,
        finalized: false,
        cancelled: true,
        effectiveCreditBps: null,
        qualifyingCreditBps: null,
        recordedAt: event.block.timestamp,
        finalizedAt: null,
        cancelledAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        rater,
        contentId,
        roundId,
        commitKey,
        pending: false,
        cancelled: true,
        cancelledAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:StalePendingEarnedRaterCreditRescued",
  async ({ event, context }) => {
    const { rater, contentId, roundId, commitKey } = event.args;

    await context.db
      .insert(launchEarnedRaterCredit)
      .values({
        id: launchCreditId(contentId, roundId, commitKey),
        rater,
        contentId,
        roundId,
        commitKey,
        scoreBps: 0,
        pending: true,
        finalized: false,
        cancelled: false,
        effectiveCreditBps: null,
        qualifyingCreditBps: null,
        recordedAt: event.block.timestamp,
        finalizedAt: null,
        cancelledAt: null,
        updatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate({
        rater,
        contentId,
        roundId,
        commitKey,
        pending: true,
        finalized: false,
        cancelled: false,
        cancelledAt: null,
        updatedAt: event.block.timestamp,
      });
  },
);

ponder.on(
  "LaunchDistributionPool:VerifiedBonusClaimed",
  async ({ event, context }) => {
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
        lrepReward: amount,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    await creditLaunchReward(context, account, amount);
  },
);

ponder.on(
  "LaunchDistributionPool:ReferralBonusPaid",
  async ({ event, context }) => {
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
        lrepReward: amount,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();

    await creditLaunchReward(context, referrer, amount);
  },
);
