import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, desc, eq, gte, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  category,
  content,
  feedbackBonusAward,
  feedbackBonusPool,
  frontend,
  globalStats,
  launchRaterRewardProgress,
  launchRewardPolicyState,
  questionBundleClaim,
  questionBundleQuestion,
  questionBundleRound,
  questionBundleRoundSet,
  questionBundleReward,
  questionRewardPool,
  questionRewardPoolClaim,
  questionRewardPoolRound,
  raterFollow,
  raterHumanCredential,
  raterProfile,
  raterTrustAttestation,
  raterTrustSeed,
  rewardClaim,
  round,
  tokenTransfer,
  vote,
  voterCategoryStats,
  dailyVoteActivity,
  voterId,
  voterStats,
  voterStreak,
} from "ponder:schema";
import type { ApiApp } from "../shared.js";
import {
  AVATAR_CATEGORY_WINDOW_SECONDS,
  jsonBig,
  parseAddressList,
  parseBigIntList,
} from "../shared.js";
import { getFollowStatsMap } from "../follow-utils.js";
import { isValidAddress, safeBigInt, safeLimit, safeOffset } from "../utils.js";
import { deriveEffectiveVoterStreak } from "../../streak-utils.js";

const VOTE_COOLDOWN_SECONDS = 24 * 60 * 60;
const BASE_RATER_MULTIPLIER_BPS = 10_000;

const STREAK_MILESTONES = [
  { days: 7, baseBonus: 10 },
  { days: 30, baseBonus: 50 },
  { days: 90, baseBonus: 200 },
];

const RATER_TYPES = ["Unknown", "Human", "AI", "Team", "Hybrid"] as const;

function voteMatchesVoter(address: `0x${string}`) {
  return or(eq(vote.voter, address), eq(vote.identityVoter, address));
}

function voteMatchesAnyVoter(addresses: `0x${string}`[]) {
  return or(inArray(vote.voter, addresses), inArray(vote.identityVoter, addresses));
}

function maxBigInt(values: Array<bigint | number | null | undefined>) {
  let max: bigint | null = null;
  for (const value of values) {
    if (value == null) continue;
    const next = typeof value === "bigint" ? value : BigInt(value);
    if (max === null || next > max) max = next;
  }
  return max;
}

function raterTypeName(raterType: number | null | undefined) {
  return RATER_TYPES[raterType ?? 0] ?? "Unknown";
}

function credentialStatus(
  credential:
    | {
        verified: boolean;
        revoked: boolean;
        expiresAt: bigint;
      }
    | undefined,
  nowSeconds: bigint,
) {
  if (!credential?.verified) return "missing";
  if (credential.revoked) return "revoked";
  if (credential.expiresAt !== 0n && credential.expiresAt <= nowSeconds)
    return "expired";
  return "verified";
}

export function registerDataRoutes(app: ApiApp) {
  app.get("/question-bundles/:id", async (c) => {
    const bundleId = safeBigInt(c.req.param("id"));
    if (bundleId === null) return c.json({ error: "Invalid bundle id" }, 400);

    const [bundle] = await db
      .select()
      .from(questionBundleReward)
      .where(eq(questionBundleReward.id, bundleId))
      .limit(1);

    if (!bundle) {
      return c.json({ error: "Bundle not found" }, 404);
    }

    const questions = await db
      .select({
        id: questionBundleQuestion.id,
        bundleId: questionBundleQuestion.bundleId,
        contentId: questionBundleQuestion.contentId,
        bundleIndex: questionBundleQuestion.bundleIndex,
        updatedAt: questionBundleQuestion.updatedAt,
        title: content.title,
        description: content.description,
        url: content.url,
        submitter: content.submitter,
        categoryId: content.categoryId,
        status: content.status,
        rating: content.rating,
        ratingBps: content.ratingBps,
        createdAt: content.createdAt,
      })
      .from(questionBundleQuestion)
      .leftJoin(content, eq(questionBundleQuestion.contentId, content.id))
      .where(eq(questionBundleQuestion.bundleId, bundleId))
      .orderBy(asc(questionBundleQuestion.bundleIndex));

    const rounds = await db
      .select()
      .from(questionBundleRound)
      .where(eq(questionBundleRound.bundleId, bundleId))
      .orderBy(
        asc(questionBundleRound.roundSetIndex),
        asc(questionBundleRound.bundleIndex),
      );

    const roundSets = await db
      .select()
      .from(questionBundleRoundSet)
      .where(eq(questionBundleRoundSet.bundleId, bundleId))
      .orderBy(asc(questionBundleRoundSet.roundSetIndex));

    return jsonBig(c, { bundle, questions, rounds, roundSets });
  });

  app.get("/question-bundle-claim-candidates", async (c) => {
    const voterRaw = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 100, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    if (!voterRaw) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    const voterAddrs = parseAddressList(voterRaw);
    if (voterAddrs.length === 0) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    const items = await db
      .select({
        bundleId: questionBundleReward.id,
        roundSetIndex: questionBundleRoundSet.roundSetIndex,
        asset: questionBundleReward.asset,
        fundedAmount: questionBundleReward.fundedAmount,
        claimedAmount: questionBundleReward.claimedAmount,
        allocation: questionBundleRoundSet.allocation,
        roundSetClaimedAmount: questionBundleRoundSet.claimedAmount,
        requiredCompleters: questionBundleReward.requiredCompleters,
        requiredSettledRounds: questionBundleReward.requiredSettledRounds,
        questionCount: questionBundleReward.questionCount,
        completedRoundSetCount: questionBundleReward.completedRoundSetCount,
        totalRecordedQuestionRounds:
          questionBundleReward.totalRecordedQuestionRounds,
        claimedCount: questionBundleReward.claimedCount,
        roundSetClaimedCount: questionBundleRoundSet.claimedCount,
        bountyClosesAt: questionBundleReward.bountyClosesAt,
        feedbackClosesAt: questionBundleReward.feedbackClosesAt,
        expiresAt: questionBundleReward.expiresAt,
        updatedAt: questionBundleRoundSet.updatedAt,
      })
      .from(questionBundleRoundSet)
      .innerJoin(
        questionBundleReward,
        eq(questionBundleRoundSet.bundleId, questionBundleReward.id),
      )
      .innerJoin(
        questionBundleRound,
        and(
          eq(questionBundleRound.bundleId, questionBundleRoundSet.bundleId),
          eq(
            questionBundleRound.roundSetIndex,
            questionBundleRoundSet.roundSetIndex,
          ),
        ),
      )
      .innerJoin(
        vote,
        and(
          eq(vote.contentId, questionBundleRound.contentId),
          eq(vote.roundId, questionBundleRound.roundId),
          voteMatchesAnyVoter(voterAddrs),
          eq(vote.revealed, true),
        ),
      )
      .where(
        and(
          eq(questionBundleReward.failed, false),
          eq(questionBundleReward.refunded, false),
          sql`${questionBundleRoundSet.claimedCount} < ${questionBundleReward.requiredCompleters}`,
        ),
      )
      .groupBy(
        questionBundleReward.id,
        questionBundleRoundSet.roundSetIndex,
        questionBundleReward.asset,
        questionBundleReward.fundedAmount,
        questionBundleReward.claimedAmount,
        questionBundleRoundSet.allocation,
        questionBundleRoundSet.claimedAmount,
        questionBundleReward.requiredCompleters,
        questionBundleReward.requiredSettledRounds,
        questionBundleReward.questionCount,
        questionBundleReward.completedRoundSetCount,
        questionBundleReward.totalRecordedQuestionRounds,
        questionBundleReward.claimedCount,
        questionBundleRoundSet.claimedCount,
        questionBundleReward.bountyClosesAt,
        questionBundleReward.feedbackClosesAt,
        questionBundleReward.expiresAt,
        questionBundleRoundSet.updatedAt,
      )
      .having(
        sql`count(distinct ${questionBundleRound.bundleIndex}) >= ${questionBundleReward.questionCount}`,
      )
      .orderBy(
        desc(questionBundleRoundSet.updatedAt),
        desc(questionBundleReward.id),
        desc(questionBundleRoundSet.roundSetIndex),
      )
      .limit(limit)
      .offset(offset);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        currency: item.asset === 0 ? "LREP" : "USDC",
        displayCurrency: item.asset === 0 ? "LREP" : "USD",
        decimals: 6,
      })),
      limit,
      offset,
    });
  });

  app.get("/follows/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const limit = safeLimit(c.req.query("limit"), 200, 500);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const [items, stats] = await Promise.all([
      db
        .select({
          walletAddress: raterFollow.target,
          createdAt: raterFollow.createdAt,
        })
        .from(raterFollow)
        .where(and(eq(raterFollow.follower, address), eq(raterFollow.active, true)))
        .orderBy(desc(raterFollow.createdAt), asc(raterFollow.target))
        .limit(limit)
        .offset(offset),
      getFollowStatsMap([address]),
    ]);

    const followStats = stats.get(address) ?? {
      followerCount: 0,
      followingCount: 0,
    };

    return jsonBig(c, {
      items,
      count: followStats.followingCount,
      followerCount: followStats.followerCount,
      followingCount: followStats.followingCount,
      limit,
      offset,
    });
  });

  app.get("/followers/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const limit = safeLimit(c.req.query("limit"), 200, 500);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const [items, stats] = await Promise.all([
      db
        .select({
          walletAddress: raterFollow.follower,
          createdAt: raterFollow.createdAt,
        })
        .from(raterFollow)
        .where(and(eq(raterFollow.target, address), eq(raterFollow.active, true)))
        .orderBy(desc(raterFollow.createdAt), asc(raterFollow.follower))
        .limit(limit)
        .offset(offset),
      getFollowStatsMap([address]),
    ]);

    const followStats = stats.get(address) ?? {
      followerCount: 0,
      followingCount: 0,
    };

    return jsonBig(c, {
      items,
      count: followStats.followerCount,
      followerCount: followStats.followerCount,
      followingCount: followStats.followingCount,
      limit,
      offset,
    });
  });

  app.get("/voter-accuracy/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [stats] = await db
      .select()
      .from(voterStats)
      .where(eq(voterStats.voter, address))
      .limit(1);

    const categoryRows = await db
      .select({
        id: voterCategoryStats.id,
        voter: voterCategoryStats.voter,
        categoryId: voterCategoryStats.categoryId,
        totalSettledVotes: voterCategoryStats.totalSettledVotes,
        totalWins: voterCategoryStats.totalWins,
        totalLosses: voterCategoryStats.totalLosses,
        totalStakeWon: voterCategoryStats.totalStakeWon,
        totalStakeLost: voterCategoryStats.totalStakeLost,
        categoryName: category.name,
      })
      .from(voterCategoryStats)
      .leftJoin(category, eq(voterCategoryStats.categoryId, category.id))
      .where(eq(voterCategoryStats.voter, address));

    const statsWithRate = stats
      ? {
          ...stats,
          winRate:
            stats.totalSettledVotes > 0
              ? stats.totalWins / stats.totalSettledVotes
              : 0,
        }
      : null;

    const categories = categoryRows.map((row) => ({
      ...row,
      winRate:
        row.totalSettledVotes > 0 ? row.totalWins / row.totalSettledVotes : 0,
    }));

    return jsonBig(c, { stats: statsWithRate, categories });
  });

  app.get("/rater-participation-status/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const [
      [profile],
      [humanCredential],
      [trustSeed],
      [launchProgress],
      [launchPolicy],
    ] = await Promise.all([
      db
        .select()
        .from(raterProfile)
        .where(eq(raterProfile.address, address))
        .limit(1),
      db
        .select()
        .from(raterHumanCredential)
        .where(eq(raterHumanCredential.rater, address))
        .limit(1),
      db
        .select()
        .from(raterTrustSeed)
        .where(eq(raterTrustSeed.rater, address))
        .limit(1),
      db
        .select()
        .from(launchRaterRewardProgress)
        .where(eq(launchRaterRewardProgress.rater, address))
        .limit(1),
      db
        .select()
        .from(launchRewardPolicyState)
        .where(eq(launchRewardPolicyState.id, "current"))
        .limit(1),
    ]);

    const wallSeconds = BigInt(Math.floor(Date.now() / 1000));
    const indexedChainTimestamp =
      maxBigInt([
        profile?.updatedAt,
        humanCredential?.updatedAt,
        trustSeed?.updatedAt,
        launchProgress?.updatedAt,
        launchPolicy?.updatedAt,
      ]) ?? null;
    const statusTimestamp =
      maxBigInt([indexedChainTimestamp, wallSeconds]) ?? wallSeconds;

    const [[activeTrustAttestationStats], inboundTrustAttestations] =
      await Promise.all([
        db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(raterTrustAttestation)
          .where(
            and(
              eq(raterTrustAttestation.subject, address),
              eq(raterTrustAttestation.revoked, false),
              sql`${raterTrustAttestation.expiresAt} > ${statusTimestamp}`,
            ),
          ),
        db
          .select()
          .from(raterTrustAttestation)
          .where(
            and(
              eq(raterTrustAttestation.subject, address),
              eq(raterTrustAttestation.revoked, false),
              sql`${raterTrustAttestation.expiresAt} > ${statusTimestamp}`,
            ),
          )
          .orderBy(
            desc(raterTrustAttestation.issuedAt),
            desc(raterTrustAttestation.id),
          )
          .limit(5),
      ]);

    const humanCredentialStatus = credentialStatus(
      humanCredential,
      statusTimestamp,
    );
    const participationLane =
      humanCredentialStatus === "verified" ? "verified_human" : "open";
    const currentLaunchPolicy = {
      minQualifyingScoreBps: launchPolicy?.minQualifyingScoreBps ?? 7_000,
      minVoters: launchPolicy?.minVoters ?? 3,
      minVerifiedHumans: launchPolicy?.minVerifiedHumans ?? 1,
      minDistinctVerifiedAnchors:
        launchPolicy?.minDistinctVerifiedAnchors ?? 2,
      minDistinctAnchorRounds: launchPolicy?.minDistinctAnchorRounds ?? 2,
      eligibilityRatingCount: launchPolicy?.eligibilityRatingCount ?? 5,
      rewardingRatingCount: launchPolicy?.rewardingRatingCount ?? 10,
      unverifiedEarnedRaterCapBps:
        launchPolicy?.unverifiedEarnedRaterCapBps ?? 10_000,
      requireNoPendingCleanup: launchPolicy?.requireNoPendingCleanup ?? true,
    };
    const launchPaid = launchProgress?.launchPaid ?? 0n;
    const launchCap = launchProgress?.launchCap ?? 0n;
    const fullLaunchCap =
      launchProgress && launchProgress.fullLaunchCap > 0n
        ? launchProgress.fullLaunchCap
        : launchCap;
    const capBps =
      launchProgress && launchProgress.capBps > 0
        ? launchProgress.capBps
        : fullLaunchCap > 0n
          ? Number((launchCap * 10_000n) / fullLaunchCap)
          : 0;
    const fullCapUnlocked = launchProgress?.fullCapUnlocked ?? false;
    const launchRewardedCount = launchProgress?.rewardedRatingCount ?? 0;
    const launchEligible = launchProgress?.payoutEligible ?? false;

    return jsonBig(c, {
      asOf: {
        chainTimestamp: indexedChainTimestamp ?? wallSeconds,
        wallTimestamp: wallSeconds,
        indexedBlockNumber: null,
      },
      rater: address,
      raterType: profile?.raterType ?? 0,
      raterTypeName: raterTypeName(profile?.raterType),
      participationLane,
      humanCredential: {
        verified: humanCredential?.verified ?? false,
        revoked: humanCredential?.revoked ?? false,
        status: humanCredentialStatus,
        verifiedAt: humanCredential?.verifiedAt ?? null,
        expiresAt: humanCredential?.expiresAt ?? null,
        evidenceHash: humanCredential?.evidenceHash ?? null,
      },
      trust: {
        activeSeed: trustSeed
          ? {
              active:
                trustSeed.active && trustSeed.sunsetAt > statusTimestamp,
              seededAt: trustSeed.seededAt,
              sunsetAt: trustSeed.sunsetAt,
              seedRoot: trustSeed.seedRoot,
            }
          : null,
        activeInboundAttestationCount: Number(
          activeTrustAttestationStats?.count ?? 0,
        ),
        latestInboundAttestations: inboundTrustAttestations.map((attestation) => ({
          issuer: attestation.issuer,
          categoryId: attestation.categoryId,
          maxBoostBps: attestation.maxBoostBps,
          expiresAt: attestation.expiresAt,
          metadataHash: attestation.metadataHash,
          issuedAt: attestation.issuedAt,
        })),
      },
      launchRewards: {
        eligible: launchEligible,
        qualifyingRatingCount: launchProgress?.qualifyingRatingCount ?? 0,
        rewardedRatingCount: launchRewardedCount,
        distinctVerifiedAnchorCount:
          launchProgress?.distinctVerifiedAnchorCount ?? 0,
        distinctAnchorRoundCount:
          launchProgress?.distinctAnchorRoundCount ?? 0,
        launchCap,
        fullLaunchCap,
        capBps,
        fullCapUnlocked,
        launchPaid,
        remainingLaunchCap: launchCap > launchPaid ? launchCap - launchPaid : 0n,
        unlockableLaunchCap:
          !fullCapUnlocked && fullLaunchCap > launchCap
            ? fullLaunchCap - launchCap
            : 0n,
        remainingRewardSlots: Math.max(
          currentLaunchPolicy.rewardingRatingCount - launchRewardedCount,
          0,
        ),
        cohortIndex: launchProgress?.cohortIndex ?? null,
        latestCreditedAt: launchProgress?.latestCreditedAt ?? null,
        latestPaidAt: launchProgress?.latestPaidAt ?? null,
        policy: currentLaunchPolicy,
      },
      participationPolicy: {
        baseRewardWeightBps: BASE_RATER_MULTIPLIER_BPS,
        humanVerificationAffectsRewardWeight: false,
        verifiedHumanCountsAsLaunchAnchor: true,
      },
    });
  });

  app.get("/avatar/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [stats, streak, streakActivity, voterIdRecord] = await Promise.all([
      db
        .select()
        .from(voterStats)
        .where(eq(voterStats.voter, address))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select()
        .from(voterStreak)
        .where(eq(voterStreak.voter, address))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          date: dailyVoteActivity.date,
        })
        .from(dailyVoteActivity)
        .where(eq(dailyVoteActivity.voter, address))
        .orderBy(asc(dailyVoteActivity.date)),
      db
        .select({
          tokenId: voterId.tokenId,
          mintedAt: voterId.mintedAt,
        })
        .from(voterId)
        .where(and(eq(voterId.holder, address), eq(voterId.revoked, false)))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const categoryCutoff = BigInt(
      Math.max(
        0,
        Math.floor(Date.now() / 1000) - AVATAR_CATEGORY_WINDOW_SECONDS,
      ),
    );
    const categoryRows = await db
      .select({
        categoryId: content.categoryId,
        categoryName: category.name,
        settledVotes90d: sql<number>`count(*)`,
        wins90d: sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 1 else 0 end else case when ${vote.isUp} = ${round.upWins} then 1 else 0 end end)`,
        losses90d: sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 0 else 1 end else case when ${vote.isUp} = ${round.upWins} then 0 else 1 end end)`,
        stakeWon90d: sql<bigint>`coalesce(sum(case when ${vote.rbtsStakeReturned} is not null then coalesce(${vote.rbtsStakeReturned}, 0) else case when ${vote.isUp} = ${round.upWins} then ${vote.stake} else 0 end end), 0)`,
        stakeLost90d: sql<bigint>`coalesce(sum(case when ${vote.rbtsForfeitedStake} is not null then coalesce(${vote.rbtsForfeitedStake}, ${vote.stake}) else case when ${vote.isUp} = ${round.upWins} then 0 else ${vote.stake} end end), 0)`,
        lastSettledAt: sql<bigint>`max(${round.settledAt})`,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .innerJoin(content, eq(vote.contentId, content.id))
      .leftJoin(category, eq(content.categoryId, category.id))
      .where(
        and(
          voteMatchesVoter(address),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          gte(round.settledAt, categoryCutoff),
        ),
      )
      .groupBy(content.categoryId, category.name);

    const statsWithRate = stats
      ? {
          ...stats,
          winRate:
            stats.totalSettledVotes > 0
              ? stats.totalWins / stats.totalSettledVotes
              : 0,
        }
      : null;

    const categories90d = categoryRows
      .map((row) => {
        const stakeWon =
          typeof row.stakeWon90d === "bigint"
            ? row.stakeWon90d
            : BigInt(row.stakeWon90d ?? 0);
        const stakeLost =
          typeof row.stakeLost90d === "bigint"
            ? row.stakeLost90d
            : BigInt(row.stakeLost90d ?? 0);
        const settledVotes = Number(row.settledVotes90d);
        const wins = Number(row.wins90d);
        const losses = Number(row.losses90d);
        return {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          settledVotes90d: settledVotes,
          wins90d: wins,
          losses90d: losses,
          stakeWon90d: stakeWon,
          stakeLost90d: stakeLost,
          totalStake90d: stakeWon + stakeLost,
          winRate90d: settledVotes > 0 ? wins / settledVotes : 0,
          lastSettledAt: row.lastSettledAt,
        };
      })
      .sort((a, b) => {
        if (b.settledVotes90d !== a.settledVotes90d)
          return b.settledVotes90d - a.settledVotes90d;
        if (a.categoryId < b.categoryId) return -1;
        if (a.categoryId > b.categoryId) return 1;
        return 0;
      });

    const effectiveStreak = deriveEffectiveVoterStreak(
      streakActivity.map((row) => row.date),
      streak,
    );

    return jsonBig(c, {
      address,
      voterId: voterIdRecord,
      stats: statsWithRate,
      streak: effectiveStreak,
      categories90d,
    });
  });

  app.get("/voter-stats-batch", async (c) => {
    const votersParam = c.req.query("voters");
    if (!votersParam) {
      return c.json({ error: "voters parameter required" }, 400);
    }

    const voters = votersParam
      .split(",")
      .slice(0, 50)
      .map((address) => address.trim().toLowerCase() as `0x${string}`)
      .filter((address) => isValidAddress(address));

    if (voters.length === 0) {
      return jsonBig(c, {});
    }

    const items = await db
      .select()
      .from(voterStats)
      .where(inArray(voterStats.voter, voters));

    const statsMap: Record<string, any> = {};
    for (const item of items) {
      statsMap[item.voter.toLowerCase()] = {
        ...item,
        winRate:
          item.totalSettledVotes > 0
            ? item.totalWins / item.totalSettledVotes
            : 0,
      };
    }

    return jsonBig(c, statsMap);
  });

  app.get("/votes", async (c) => {
    const voterRaw = c.req.query("voter");
    const contentId = c.req.query("contentId");
    const roundId = c.req.query("roundId");
    const stateFilter = c.req.query("state");
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const conditions = [];
    if (voterRaw) {
      if (!isValidAddress(voterRaw))
        return c.json({ error: "Invalid voter address" }, 400);
      conditions.push(voteMatchesVoter(voterRaw.toLowerCase() as `0x${string}`));
    }
    if (contentId) {
      const parsed = safeBigInt(contentId);
      if (parsed === null) return c.json({ error: "Invalid contentId" }, 400);
      conditions.push(eq(vote.contentId, parsed));
    }
    if (roundId) {
      const parsed = safeBigInt(roundId);
      if (parsed === null) return c.json({ error: "Invalid roundId" }, 400);
      conditions.push(eq(vote.roundId, parsed));
    }
    if (stateFilter !== undefined) {
      const parsed = parseInt(stateFilter);
      if (isNaN(parsed)) return c.json({ error: "Invalid state filter" }, 400);
      conditions.push(eq(round.state, parsed));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const items = await db
      .select({
        id: vote.id,
        contentId: vote.contentId,
        roundId: vote.roundId,
        voter: vote.voter,
        identityVoter: vote.identityVoter,
        voterId: vote.voterId,
        commitHash: vote.commitHash,
        targetRound: vote.targetRound,
        drandChainHash: vote.drandChainHash,
        isUp: vote.isUp,
        predictedUpBps: vote.predictedUpBps,
        rbtsWeight: vote.rbtsWeight,
        rbtsScoreBps: vote.rbtsScoreBps,
        rbtsRewardWeight: vote.rbtsRewardWeight,
        rbtsStakeReturned: vote.rbtsStakeReturned,
        rbtsForfeitedStake: vote.rbtsForfeitedStake,
        stake: vote.stake,
        epochIndex: vote.epochIndex,
        revealed: vote.revealed,
        committedAt: vote.committedAt,
        revealedAt: vote.revealedAt,
        roundStartTime: round.startTime,
        roundEpochDuration: round.epochDuration,
        roundMaxDuration: round.maxDuration,
        roundMinVoters: round.minVoters,
        roundMaxVoters: round.maxVoters,
        roundState: round.state,
        roundUpWins: round.upWins,
        roundRbtsRewardWeight: round.rbtsRewardWeight,
        roundRbtsRewardClaimants: round.rbtsRewardClaimants,
        roundRbtsForfeitedPool: round.rbtsForfeitedPool,
        roundRbtsForfeitClaimants: round.rbtsForfeitClaimants,
      })
      .from(vote)
      .leftJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .where(where)
      .orderBy(desc(vote.committedAt))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({
        settledTotal: sql<number>`sum(case when ${round.state} = ${ROUND_STATE.Settled} then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(vote)
      .leftJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .where(where);

    return jsonBig(c, {
      items,
      total: countResult?.total ?? 0,
      settledTotal: countResult?.settledTotal ?? 0,
      limit,
      offset,
    });
  });

  app.get("/vote-cooldowns", async (c) => {
    const voters = parseAddressList(c.req.query("voters"), 20);
    const contentIds = parseBigIntList(c.req.query("contentIds"), 200);

    if (voters.length === 0) {
      return c.json({ error: "voters parameter required" }, 400);
    }
    if (contentIds.length === 0) {
      return c.json({ error: "contentIds parameter required" }, 400);
    }

    const activeCooldownCutoff = BigInt(
      Math.max(0, Math.floor(Date.now() / 1000) - VOTE_COOLDOWN_SECONDS),
    );
    const items = await db
      .select({
        contentId: vote.contentId,
        latestCommittedAt: sql<bigint>`max(${vote.committedAt})`,
      })
      .from(vote)
      .where(
        and(
          voteMatchesAnyVoter(voters),
          inArray(vote.contentId, contentIds),
          gte(vote.committedAt, activeCooldownCutoff),
        ),
      )
      .groupBy(vote.contentId);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        cooldownEndsAt: item.latestCommittedAt + BigInt(VOTE_COOLDOWN_SECONDS),
      })),
    });
  });

  app.get("/question-reward-claim-candidates", async (c) => {
    const voterRaw = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 100, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    if (!voterRaw) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    const voterAddrs = parseAddressList(voterRaw);
    if (voterAddrs.length === 0) {
      return c.json({ error: "Invalid voter address" }, 400);
    }
    const items = await db
      .select({
        rewardPoolId: questionRewardPool.id,
        contentId: questionRewardPool.contentId,
        asset: questionRewardPool.asset,
        roundId: vote.roundId,
        title: content.title,
        allocation: questionRewardPoolRound.allocation,
        eligibleVoters: questionRewardPoolRound.eligibleVoters,
        rawEligibleVoters: questionRewardPoolRound.rawEligibleVoters,
        effectiveParticipantUnits:
          questionRewardPoolRound.effectiveParticipantUnits,
        totalClaimWeight: questionRewardPoolRound.totalClaimWeight,
        qualified: sql<boolean>`${questionRewardPoolRound.rewardPoolId} is not null`,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(vote.contentId, round.contentId),
          eq(vote.roundId, round.roundId),
        ),
      )
      .innerJoin(
        questionRewardPool,
        eq(vote.contentId, questionRewardPool.contentId),
      )
      .innerJoin(content, eq(vote.contentId, content.id))
      .leftJoin(
        questionRewardPoolRound,
        and(
          eq(questionRewardPoolRound.rewardPoolId, questionRewardPool.id),
          eq(questionRewardPoolRound.roundId, vote.roundId),
        ),
      )
      .where(
        and(
          voteMatchesAnyVoter(voterAddrs),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          sql`${vote.roundId} >= ${questionRewardPool.startRoundId}`,
          or(
            sql`${questionRewardPoolRound.rewardPoolId} is not null`,
            and(
              eq(questionRewardPool.refunded, false),
              sql`${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}`,
              sql`${round.revealedCount} >= ${questionRewardPool.requiredVoters}`,
              sql`(${questionRewardPool.bountyClosesAt} = 0 or ${round.settledAt} <= ${questionRewardPool.bountyClosesAt})`,
            ),
          ),
        ),
      )
      .orderBy(desc(round.settledAt), desc(questionRewardPool.createdAt))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, {
      items: items.map((item) => ({
        ...item,
        currency: item.asset === 0 ? "LREP" : "USDC",
        displayCurrency: item.asset === 0 ? "LREP" : "USD",
        decimals: 6,
      })),
      limit,
      offset,
    });
  });

  app.get("/rewards", async (c) => {
    const voter = c.req.query("voter");
    const limit = safeLimit(c.req.query("limit"), 50, 200);

    if (!voter) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    if (!isValidAddress(voter)) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    // Match on either `voter` (received the voter-pool reward) or `stakePayer`
    // (received the stake refund — different address when a delegate paid the stake).
    const address = voter.toLowerCase() as `0x${string}`;
    const items = await db
      .select()
      .from(rewardClaim)
      .where(
        or(eq(rewardClaim.voter, address), eq(rewardClaim.stakePayer, address)),
      )
      .orderBy(desc(rewardClaim.claimedAt))
      .limit(limit);

    return jsonBig(c, { items });
  });

  app.get("/balance-history", async (c) => {
    const address = c.req.query("address");
    if (!address) {
      return c.json({ error: "address parameter required" }, 400);
    }
    if (!isValidAddress(address)) {
      return c.json({ error: "Invalid address" }, 400);
    }

    const normalizedAddress = address.toLowerCase() as `0x${string}`;
    const limit = safeLimit(c.req.query("limit"), 500, 1000);

    const transfers = await db
      .select()
      .from(tokenTransfer)
      .where(
        or(
          eq(tokenTransfer.from, normalizedAddress),
          eq(tokenTransfer.to, normalizedAddress),
        ),
      )
      .orderBy(asc(tokenTransfer.blockNumber))
      .limit(limit);

    return jsonBig(c, { transfers, address: normalizedAddress });
  });

  app.get("/stats", async (c) => {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const [
      [stats],
      [rewardPoolStats],
      [bundleRewardStats],
      [feedbackBonusAwardStats],
      [feedbackBonusPoolStats],
      [verifiedHumanStats],
    ] = await Promise.all([
      db
        .select()
        .from(globalStats)
        .where(eq(globalStats.id, "global"))
        .limit(1),
      db
        .select({
          totalQuestionRewardsPaid: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.grossAmount}), 0)`,
          totalQuestionRewardsPaidToVoters: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.amount}), 0)`,
          totalQuestionRewardsPaidToFrontends: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.frontendFee}), 0)`,
        })
        .from(questionRewardPoolClaim),
      db
        .select({
          totalQuestionBundleRewardsPaid: sql<bigint>`coalesce(sum(${questionBundleClaim.grossAmount}), 0)`,
          totalQuestionBundleRewardsPaidToVoters: sql<bigint>`coalesce(sum(${questionBundleClaim.amount}), 0)`,
          totalQuestionBundleRewardsPaidToFrontends: sql<bigint>`coalesce(sum(${questionBundleClaim.frontendFee}), 0)`,
        })
        .from(questionBundleClaim),
      db
        .select({
          totalFeedbackBonusesPaid: sql<bigint>`coalesce(sum(${feedbackBonusAward.grossAmount}), 0)`,
          totalFeedbackBonusesPaidToVoters: sql<bigint>`coalesce(sum(${feedbackBonusAward.recipientAmount}), 0)`,
          totalFeedbackBonusesPaidToFrontends: sql<bigint>`coalesce(sum(${feedbackBonusAward.frontendFee}), 0)`,
        })
        .from(feedbackBonusAward),
      db
        .select({
          totalFeedbackBonusesFunded: sql<bigint>`coalesce(sum(${feedbackBonusPool.fundedAmount}), 0)`,
          totalFeedbackBonusesForfeited: sql<bigint>`coalesce(sum(${feedbackBonusPool.forfeitedAmount}), 0)`,
        })
        .from(feedbackBonusPool),
      db
        .select({
          totalVerifiedHumans: sql<number>`count(*)`,
        })
        .from(raterHumanCredential)
        .where(
          and(
            eq(raterHumanCredential.verified, true),
            eq(raterHumanCredential.revoked, false),
            sql`${raterHumanCredential.expiresAt} > ${nowSeconds}`,
          ),
        ),
    ]);

    const fallbackStats = {
      totalContent: 0,
      totalVotes: 0,
      totalRoundsSettled: 0,
      totalRewardsClaimed: "0",
      totalProfiles: 0,
      totalVoterIds: 0,
      totalVerifiedHumans: 0,
    };

    return jsonBig(c, {
      ...(stats ?? fallbackStats),
      totalVerifiedHumans: verifiedHumanStats?.totalVerifiedHumans ?? 0,
      totalQuestionRewardsPaid: rewardPoolStats?.totalQuestionRewardsPaid ?? 0n,
      totalQuestionRewardsPaidToVoters:
        rewardPoolStats?.totalQuestionRewardsPaidToVoters ?? 0n,
      totalQuestionRewardsPaidToFrontends:
        rewardPoolStats?.totalQuestionRewardsPaidToFrontends ?? 0n,
      totalQuestionBundleRewardsPaid:
        bundleRewardStats?.totalQuestionBundleRewardsPaid ?? 0n,
      totalQuestionBundleRewardsPaidToVoters:
        bundleRewardStats?.totalQuestionBundleRewardsPaidToVoters ?? 0n,
      totalQuestionBundleRewardsPaidToFrontends:
        bundleRewardStats?.totalQuestionBundleRewardsPaidToFrontends ?? 0n,
      totalFeedbackBonusesFunded:
        feedbackBonusPoolStats?.totalFeedbackBonusesFunded ?? 0n,
      totalFeedbackBonusesPaid:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaid ?? 0n,
      totalFeedbackBonusesPaidToVoters:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaidToVoters ?? 0n,
      totalFeedbackBonusesPaidToFrontends:
        feedbackBonusAwardStats?.totalFeedbackBonusesPaidToFrontends ?? 0n,
      totalFeedbackBonusesForfeited:
        feedbackBonusPoolStats?.totalFeedbackBonusesForfeited ?? 0n,
    });
  });

  app.get("/frontends", async (c) => {
    const statusFilter = c.req.query("status") ?? "all";

    let where;
    if (statusFilter === "active" || statusFilter === "eligible") {
      where = eq(frontend.eligible, true);
    } else if (statusFilter === "slashed") {
      where = eq(frontend.slashed, true);
    } else if (statusFilter === "exiting") {
      where = sql`${frontend.exitAvailableAt} is not null`;
    } else if (statusFilter === "inactive" || statusFilter === "pending") {
      where = and(
        eq(frontend.eligible, false),
        eq(frontend.slashed, false),
        sql`${frontend.exitAvailableAt} is null`,
      );
    }
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const items = await db
      .select()
      .from(frontend)
      .where(where)
      .limit(safeLimit(c.req.query("limit"), 100, 500))
      .offset(offset);

    return jsonBig(c, { items });
  });

  app.get("/frontend/:address", async (c) => {
    const address = c.req.param("address").toLowerCase() as `0x${string}`;
    if (!isValidAddress(address))
      return c.json({ error: "Invalid address" }, 400);

    const [item] = await db
      .select()
      .from(frontend)
      .where(eq(frontend.address, address))
      .limit(1);

    if (!item) {
      return c.json({ error: "Frontend not found" }, 404);
    }

    return jsonBig(c, { frontend: item });
  });

  app.get("/voter-ids", async (c) => {
    const holder = c.req.query("holder");
    const limit = safeLimit(c.req.query("limit"), 50, 200);

    let where;
    if (holder) {
      if (!isValidAddress(holder))
        return c.json({ error: "Invalid holder address" }, 400);
      where = eq(voterId.holder, holder.toLowerCase() as `0x${string}`);
    }

    const items = await db.select().from(voterId).where(where).limit(limit);

    return jsonBig(c, { items });
  });

  app.get("/voter-streak", async (c) => {
    const voter = c.req.query("voter");
    if (!voter) {
      return c.json({ error: "voter parameter required" }, 400);
    }
    if (!isValidAddress(voter)) {
      return c.json({ error: "Invalid voter address" }, 400);
    }

    const voterAddr = voter.toLowerCase() as `0x${string}`;

    const [streak, streakActivity] = await Promise.all([
      db
        .select()
        .from(voterStreak)
        .where(eq(voterStreak.voter, voterAddr))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({
          date: dailyVoteActivity.date,
        })
        .from(dailyVoteActivity)
        .where(eq(dailyVoteActivity.voter, voterAddr))
        .orderBy(asc(dailyVoteActivity.date)),
    ]);

    const effectiveStreak = deriveEffectiveVoterStreak(
      streakActivity.map((row) => row.date),
      streak,
    );
    const nextMilestone = STREAK_MILESTONES.find(
      (milestone) => milestone.days > effectiveStreak.currentDailyStreak,
    );

    return jsonBig(c, {
      currentDailyStreak: effectiveStreak.currentDailyStreak,
      bestDailyStreak: effectiveStreak.bestDailyStreak,
      totalActiveDays: effectiveStreak.totalActiveDays,
      lastActiveDate: effectiveStreak.lastActiveDate,
      lastMilestoneDay: effectiveStreak.lastMilestoneDay,
      milestones: STREAK_MILESTONES,
      nextMilestone: nextMilestone?.days ?? null,
      nextMilestoneBaseBonus: nextMilestone?.baseBonus ?? null,
    });
  });
}
