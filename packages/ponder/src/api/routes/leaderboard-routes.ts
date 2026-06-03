import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  profile,
  raterHumanCredential,
  raterProfile,
  round,
  tokenHolder,
  vote,
  voterCategoryStats,
  voterStats,
} from "ponder:schema";
import { getFollowStatsMap } from "../follow-utils.js";
import {
  SIGNAL_SCORE_PRIOR_BPS,
  SIGNAL_SCORE_PRIOR_WEIGHT,
  resolveAccuracyLeaderboardWindow,
  type AccuracyLeaderboardSortBy,
} from "../leaderboard-utils.js";
import {
  profileTotalContentExpr,
  profileTotalRewardsClaimedExpr,
  profileTotalVotesExpr,
} from "../profile-aggregate-expressions.js";
import {
  getEarningsLeaderboard,
  parseEarningsAssetFilter,
  parseEarningsSourceFilter,
} from "../earnings.js";
import { credentialStatus, raterTypeName } from "../reputation-utils.js";
import type { ApiApp } from "../shared.js";
import { jsonBig } from "../shared.js";
import { safeBigInt, safeLimit, safeOffset } from "../utils.js";

type OrderableExpression = Parameters<typeof desc>[0];
type AccuracyLeaderboardRaterTypeFilter = 1 | 2 | 3 | 4;

const RATER_TYPE_FILTERS = new Map<string, AccuracyLeaderboardRaterTypeFilter>([
  ["1", 1],
  ["human", 1],
  ["2", 2],
  ["ai", 2],
  ["3", 3],
  ["team", 3],
  ["4", 4],
  ["hybrid", 4],
]);

function parseRaterTypeFilter(value: string | undefined): AccuracyLeaderboardRaterTypeFilter | null | "invalid" {
  if (value === undefined || value.trim() === "" || value.toLowerCase() === "all") {
    return null;
  }
  return RATER_TYPE_FILTERS.get(value.trim().toLowerCase()) ?? "invalid";
}

function activeHumanCredentialSql(nowSeconds: bigint) {
  return sql<boolean>`coalesce(${raterHumanCredential.verified}, false) = true and coalesce(${raterHumanCredential.revoked}, false) = false and (${raterHumanCredential.expiresAt} = 0 or ${raterHumanCredential.expiresAt} > ${nowSeconds})`;
}

function effectiveRaterTypeSql(nowSeconds: bigint) {
  return sql<number>`case when ${activeHumanCredentialSql(nowSeconds)} then 1 else coalesce(${raterProfile.raterType}, ${profile.selfReportedRaterType}, 0) end`;
}

function raterTypeFilterSql(filter: AccuracyLeaderboardRaterTypeFilter | null, nowSeconds: bigint) {
  return filter === null ? null : sql`${effectiveRaterTypeSql(nowSeconds)} = ${filter}`;
}

async function attachAccuracyLeaderboardReputation<
  T extends { voter: `0x${string}` },
>(items: T[]) {
  if (items.length === 0) return items;

  const addresses = [
    ...new Set(items.map((item) => item.voter.toLowerCase() as `0x${string}`)),
  ];
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));

  const [raterProfiles, humanCredentials, profileRows, followStats] =
    await Promise.all([
    db
      .select()
      .from(raterProfile)
      .where(inArray(raterProfile.address, addresses)),
    db
      .select()
      .from(raterHumanCredential)
      .where(inArray(raterHumanCredential.rater, addresses)),
    db
      .select({
        address: profile.address,
        selfReportedRaterType: profile.selfReportedRaterType,
      })
      .from(profile)
      .where(inArray(profile.address, addresses)),
    getFollowStatsMap(addresses),
  ]);

  const raterProfileMap = new Map(
    raterProfiles.map((row) => [row.address, row]),
  );
  const humanCredentialMap = new Map(
    humanCredentials.map((row) => [row.rater, row]),
  );
  const selfReportedRaterTypeMap = new Map(
    profileRows.map((row) => [row.address, row.selfReportedRaterType]),
  );

  return items.map((item) => {
    const credential = humanCredentialMap.get(item.voter);
    const follow = followStats.get(item.voter) ?? {
      followerCount: 0,
      followingCount: 0,
    };
    const humanCredentialStatus = credentialStatus(credential, nowSeconds);
    const raterType =
      humanCredentialStatus === "verified"
        ? 1
        : (raterProfileMap.get(item.voter)?.raterType ??
          selfReportedRaterTypeMap.get(item.voter) ??
          0);
    const participationLane =
      humanCredentialStatus === "verified" ? "verified_human" : "open";

    return {
      ...item,
      reputation: {
        raterType,
        raterTypeName: raterTypeName(raterType),
        humanCredentialStatus,
        participationLane,
        followerCount: follow.followerCount,
        followingCount: follow.followingCount,
      },
    };
  });
}

function getAccuracyLeaderboardOrderByExpressions(
  sortBy: AccuracyLeaderboardSortBy,
  metrics: {
    totalSettledVotes: OrderableExpression;
    totalWins: OrderableExpression;
    totalStakeWon: OrderableExpression;
    scoredVotes?: OrderableExpression;
    signalScoreBps?: OrderableExpression;
    winRate: OrderableExpression;
    voter: OrderableExpression;
  },
) {
  const orderByExpressions = [];

  switch (sortBy) {
    case "signalScore":
      if (metrics.signalScoreBps) {
        orderByExpressions.push(desc(metrics.signalScoreBps));
      }
      if (metrics.scoredVotes) {
        orderByExpressions.push(desc(metrics.scoredVotes));
      }
      orderByExpressions.push(desc(metrics.totalSettledVotes));
      orderByExpressions.push(asc(metrics.voter));
      return orderByExpressions;
    case "settledVotes":
      orderByExpressions.push(desc(metrics.totalSettledVotes));
      break;
    case "wins":
      orderByExpressions.push(desc(metrics.totalWins));
      break;
    case "stakeWon":
      orderByExpressions.push(desc(metrics.totalStakeWon));
      break;
    case "winRate":
    default:
      break;
  }

  orderByExpressions.push(desc(metrics.winRate));

  if (sortBy !== "wins") {
    orderByExpressions.push(desc(metrics.totalWins));
  }
  if (sortBy !== "settledVotes") {
    orderByExpressions.push(desc(metrics.totalSettledVotes));
  }
  if (sortBy !== "stakeWon") {
    orderByExpressions.push(desc(metrics.totalStakeWon));
  }

  orderByExpressions.push(asc(metrics.voter));
  return orderByExpressions;
}

export function registerLeaderboardRoutes(app: ApiApp) {
  app.get("/leaderboard", async (c) => {
    const type = c.req.query("type") ?? "voters";
    const limit = safeLimit(c.req.query("limit"), 20, 100);

    let orderBy;
    const totalVotes = profileTotalVotesExpr(profile.address);
    const totalContent = profileTotalContentExpr(profile.address);
    const totalRewardsClaimed = profileTotalRewardsClaimedExpr(profile.address);
    switch (type) {
      case "creators":
        orderBy = desc(totalContent);
        break;
      case "earners":
        orderBy = desc(totalRewardsClaimed);
        break;
      case "voters":
      default:
        orderBy = desc(totalVotes);
        break;
    }

    const profileItems = await db
      .select({
        address: profile.address,
        name: profile.name,
        selfReport: profile.selfReport,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        totalVotes,
        totalContent,
        totalRewardsClaimed,
      })
      .from(profile)
      .orderBy(orderBy)
      .limit(limit);

    const remaining = limit - profileItems.length;
    const profileAddresses = profileItems.map((item) => item.address);
    let holderOnly: typeof profileItems = [];

    if (remaining > 0) {
      const holders =
        profileAddresses.length > 0
          ? await db
              .select()
              .from(tokenHolder)
              .where(notInArray(tokenHolder.address, profileAddresses))
              .limit(remaining)
          : await db.select().from(tokenHolder).limit(remaining);

      holderOnly = holders.map((holder) => ({
        address: holder.address,
        name: "",
        selfReport: "",
        createdAt: holder.firstSeenAt,
        updatedAt: holder.firstSeenAt,
        totalVotes: 0,
        totalContent: 0,
        totalRewardsClaimed: 0n,
      }));
    }

    const items = [...profileItems, ...holderOnly];
    return jsonBig(c, { items, type });
  });

  app.get("/token-holders", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 200, 500);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const items = await db
      .select()
      .from(tokenHolder)
      .orderBy(asc(tokenHolder.firstSeenAt), asc(tokenHolder.address))
      .limit(limit)
      .offset(offset);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tokenHolder);

    return jsonBig(c, {
      items,
      total: countResult?.count ?? 0,
      limit,
      offset,
    });
  });

  app.get("/accuracy-leaderboard", async (c) => {
    const categoryIdParam = c.req.query("categoryId");
    const includeReputation = ["1", "true"].includes(
      (c.req.query("includeReputation") ?? "").toLowerCase(),
    );
    const raterTypeFilter = parseRaterTypeFilter(c.req.query("raterType"));
    if (raterTypeFilter === "invalid") {
      return c.json({ error: "Invalid raterType" }, 400);
    }
    const sortByRaw = c.req.query("sortBy") ?? "signalScore";
    const sortBy =
      sortByRaw === "signalScore" ||
      sortByRaw === "winRate" ||
      sortByRaw === "wins" ||
      sortByRaw === "stakeWon" ||
      sortByRaw === "settledVotes"
        ? sortByRaw
        : null;
    if (sortBy === null) return c.json({ error: "Invalid sortBy" }, 400);

    const windowBounds = resolveAccuracyLeaderboardWindow(
      c.req.query("window"),
    );
    if (windowBounds === null) return c.json({ error: "Invalid window" }, 400);

    const minVotesParam =
      c.req.query("minVotes") ?? (sortBy === "signalScore" ? "5" : "3");
    const minSignalVotesParam =
      c.req.query("minSignalVotes") ??
      (sortBy === "signalScore" ? minVotesParam : "0");
    const limit = safeLimit(c.req.query("limit"), 20, 100);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const minVotes = parseInt(minVotesParam);
    if (isNaN(minVotes) || minVotes < 1)
      return c.json({ error: "Invalid minVotes" }, 400);
    const minSignalVotes = parseInt(minSignalVotesParam);
    if (isNaN(minSignalVotes) || minSignalVotes < 0)
      return c.json({ error: "Invalid minSignalVotes" }, 400);

    const categoryId = categoryIdParam ? safeBigInt(categoryIdParam) : null;
    if (categoryIdParam && categoryId === null)
      return c.json({ error: "Invalid categoryId" }, 400);

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const raterTypeCondition = raterTypeFilterSql(raterTypeFilter, nowSeconds);

    if (sortBy === "signalScore") {
      const aggregateTotalSettledVotes = sql<number>`count(*)`;
      const aggregateTotalWins = sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 1 else 0 end else case when ${vote.isUp} = ${round.upWins} then 1 else 0 end end)`;
      const aggregateTotalLosses = sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 0 else 1 end else case when ${vote.isUp} = ${round.upWins} then 0 else 1 end end)`;
      const aggregateTotalStakeWon = sql<bigint>`coalesce(sum(case when ${vote.rbtsStakeReturned} is not null then coalesce(${vote.rbtsStakeReturned}, 0) else case when ${vote.isUp} = ${round.upWins} then ${vote.stake} else 0 end end), 0)`;
      const aggregateTotalStakeLost = sql<bigint>`coalesce(sum(case when ${vote.rbtsForfeitedStake} is not null then coalesce(${vote.rbtsForfeitedStake}, ${vote.stake}) else case when ${vote.isUp} = ${round.upWins} then 0 else ${vote.stake} end end), 0)`;
      const aggregateScoredVotes = sql<number>`sum(case when ${vote.rbtsScoreBps} is not null then 1 else 0 end)`;
      const aggregateSignalScoreBps = sql<number>`CAST((coalesce(sum(${vote.rbtsScoreBps}), 0) + ${SIGNAL_SCORE_PRIOR_BPS * SIGNAL_SCORE_PRIOR_WEIGHT}) AS FLOAT) / (${aggregateScoredVotes} + ${SIGNAL_SCORE_PRIOR_WEIGHT})`;
      const aggregateWinRate = sql<number>`CAST(${aggregateTotalWins} AS FLOAT) / ${aggregateTotalSettledVotes}`;
      const aggregateSelection = {
        voter: vote.voter,
        totalSettledVotes: aggregateTotalSettledVotes,
        totalWins: aggregateTotalWins,
        totalLosses: aggregateTotalLosses,
        totalStakeWon: aggregateTotalStakeWon,
        totalStakeLost: aggregateTotalStakeLost,
        scoredVotes: aggregateScoredVotes,
        signalScoreBps: aggregateSignalScoreBps,
        winRate: aggregateWinRate,
        currentStreak: voterStats.currentStreak,
        bestWinStreak: voterStats.bestWinStreak,
        profileName: profile.name,
      };
      const signalOrderByExprs = getAccuracyLeaderboardOrderByExpressions(
        sortBy,
        {
          totalSettledVotes: aggregateTotalSettledVotes,
          totalWins: aggregateTotalWins,
          totalStakeWon: aggregateTotalStakeWon,
          scoredVotes: aggregateScoredVotes,
          signalScoreBps: aggregateSignalScoreBps,
          winRate: aggregateWinRate,
          voter: vote.voter,
        },
      );
      const baseConditions = [
        eq(vote.revealed, true),
        eq(round.state, ROUND_STATE.Settled),
      ];
      if (raterTypeCondition) baseConditions.push(raterTypeCondition);
      if (
        windowBounds.window !== "all" &&
        windowBounds.startsAt !== null &&
        windowBounds.endsAt !== null
      ) {
        baseConditions.push(
          gte(round.settledAt, windowBounds.startsAt),
          lt(round.settledAt, windowBounds.endsAt),
        );
      }

      const rows =
        categoryId !== null
          ? await db
              .select(aggregateSelection)
              .from(vote)
              .innerJoin(
                round,
                and(
                  eq(vote.contentId, round.contentId),
                  eq(vote.roundId, round.roundId),
                ),
              )
              .innerJoin(content, eq(vote.contentId, content.id))
              .leftJoin(profile, eq(vote.voter, profile.address))
              .leftJoin(raterProfile, eq(vote.voter, raterProfile.address))
              .leftJoin(
                raterHumanCredential,
                eq(vote.voter, raterHumanCredential.rater),
              )
              .leftJoin(voterStats, eq(vote.voter, voterStats.voter))
              .where(and(...baseConditions, eq(content.categoryId, categoryId)))
              .groupBy(
                vote.voter,
                profile.name,
                voterStats.currentStreak,
                voterStats.bestWinStreak,
              )
              .having(
                sql`count(*) >= ${minVotes} and ${aggregateScoredVotes} >= ${minSignalVotes}`,
              )
              .orderBy(...signalOrderByExprs)
              .limit(limit)
              .offset(offset)
          : await db
              .select(aggregateSelection)
              .from(vote)
              .innerJoin(
                round,
                and(
                  eq(vote.contentId, round.contentId),
                  eq(vote.roundId, round.roundId),
                ),
              )
              .leftJoin(profile, eq(vote.voter, profile.address))
              .leftJoin(raterProfile, eq(vote.voter, raterProfile.address))
              .leftJoin(
                raterHumanCredential,
                eq(vote.voter, raterHumanCredential.rater),
              )
              .leftJoin(voterStats, eq(vote.voter, voterStats.voter))
              .where(and(...baseConditions))
              .groupBy(
                vote.voter,
                profile.name,
                voterStats.currentStreak,
                voterStats.bestWinStreak,
              )
              .having(
                sql`count(*) >= ${minVotes} and ${aggregateScoredVotes} >= ${minSignalVotes}`,
              )
              .orderBy(...signalOrderByExprs)
              .limit(limit)
              .offset(offset);

      const items = rows.map((row) => {
        const signalScoreBps = Number(row.signalScoreBps);
        return {
          voter: row.voter,
          totalSettledVotes: Number(row.totalSettledVotes),
          totalWins: Number(row.totalWins),
          totalLosses: Number(row.totalLosses),
          totalStakeWon:
            typeof row.totalStakeWon === "bigint"
              ? row.totalStakeWon
              : BigInt(row.totalStakeWon ?? 0),
          totalStakeLost:
            typeof row.totalStakeLost === "bigint"
              ? row.totalStakeLost
              : BigInt(row.totalStakeLost ?? 0),
          scoredVotes: Number(row.scoredVotes ?? 0),
          signalScoreBps,
          signalScore: signalScoreBps / 10_000,
          currentStreak: row.currentStreak,
          bestWinStreak: row.bestWinStreak,
          profileName: row.profileName,
          winRate: Number(row.winRate),
        };
      });

      return jsonBig(c, {
        items: includeReputation
          ? await attachAccuracyLeaderboardReputation(items)
          : items,
        categoryId: categoryIdParam,
        window: windowBounds.window,
        startsAt: windowBounds.startsAt,
        endsAt: windowBounds.endsAt,
      });
    }

    const categoryWinRateExpr = sql<number>`CAST(${voterCategoryStats.totalWins} AS FLOAT) / ${voterCategoryStats.totalSettledVotes}`;
    const categoryOrderByExprs = getAccuracyLeaderboardOrderByExpressions(
      sortBy,
      {
        totalSettledVotes: voterCategoryStats.totalSettledVotes,
        totalWins: voterCategoryStats.totalWins,
        totalStakeWon: voterCategoryStats.totalStakeWon,
        winRate: categoryWinRateExpr,
        voter: voterCategoryStats.voter,
      },
    );
    const overallWinRateExpr = sql<number>`CAST(${voterStats.totalWins} AS FLOAT) / ${voterStats.totalSettledVotes}`;
    const overallOrderByExprs = getAccuracyLeaderboardOrderByExpressions(
      sortBy,
      {
        totalSettledVotes: voterStats.totalSettledVotes,
        totalWins: voterStats.totalWins,
        totalStakeWon: voterStats.totalStakeWon,
        winRate: overallWinRateExpr,
        voter: voterStats.voter,
      },
    );

    if (
      windowBounds.window !== "all" &&
      windowBounds.startsAt !== null &&
      windowBounds.endsAt !== null
    ) {
      const aggregateTotalSettledVotes = sql<number>`count(*)`;
      const aggregateTotalWins = sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 1 else 0 end else case when ${vote.isUp} = ${round.upWins} then 1 else 0 end end)`;
      const aggregateTotalLosses = sql<number>`sum(case when ${vote.rbtsRewardWeight} is not null then case when coalesce(${vote.rbtsRewardWeight}, 0) > 0 then 0 else 1 end else case when ${vote.isUp} = ${round.upWins} then 0 else 1 end end)`;
      const aggregateTotalStakeWon = sql<bigint>`coalesce(sum(case when ${vote.rbtsStakeReturned} is not null then coalesce(${vote.rbtsStakeReturned}, 0) else case when ${vote.isUp} = ${round.upWins} then ${vote.stake} else 0 end end), 0)`;
      const aggregateTotalStakeLost = sql<bigint>`coalesce(sum(case when ${vote.rbtsForfeitedStake} is not null then coalesce(${vote.rbtsForfeitedStake}, ${vote.stake}) else case when ${vote.isUp} = ${round.upWins} then 0 else ${vote.stake} end end), 0)`;
      const aggregateWinRate = sql<number>`CAST(${aggregateTotalWins} AS FLOAT) / ${aggregateTotalSettledVotes}`;
      const aggregateSelection = {
        voter: vote.voter,
        totalSettledVotes: aggregateTotalSettledVotes,
        totalWins: aggregateTotalWins,
        totalLosses: aggregateTotalLosses,
        totalStakeWon: aggregateTotalStakeWon,
        totalStakeLost: aggregateTotalStakeLost,
        winRate: aggregateWinRate,
        profileName: profile.name,
      };
      const windowedOrderByExprs = getAccuracyLeaderboardOrderByExpressions(
        sortBy,
        {
          totalSettledVotes: aggregateTotalSettledVotes,
          totalWins: aggregateTotalWins,
          totalStakeWon: aggregateTotalStakeWon,
          winRate: aggregateWinRate,
          voter: vote.voter,
        },
      );

      const baseConditions = [
        eq(vote.revealed, true),
        eq(round.state, ROUND_STATE.Settled),
        gte(round.settledAt, windowBounds.startsAt),
        lt(round.settledAt, windowBounds.endsAt),
      ];
      if (raterTypeCondition) baseConditions.push(raterTypeCondition);

      const rows =
        categoryId !== null
          ? await db
              .select(aggregateSelection)
              .from(vote)
              .innerJoin(
                round,
                and(
                  eq(vote.contentId, round.contentId),
                  eq(vote.roundId, round.roundId),
                ),
              )
              .innerJoin(content, eq(vote.contentId, content.id))
              .leftJoin(profile, eq(vote.voter, profile.address))
              .leftJoin(raterProfile, eq(vote.voter, raterProfile.address))
              .leftJoin(
                raterHumanCredential,
                eq(vote.voter, raterHumanCredential.rater),
              )
              .where(and(...baseConditions, eq(content.categoryId, categoryId)))
              .groupBy(vote.voter, profile.name)
              .having(sql`count(*) >= ${minVotes}`)
              .orderBy(...windowedOrderByExprs)
              .limit(limit)
              .offset(offset)
          : await db
              .select(aggregateSelection)
              .from(vote)
              .innerJoin(
                round,
                and(
                  eq(vote.contentId, round.contentId),
                  eq(vote.roundId, round.roundId),
                ),
              )
              .leftJoin(profile, eq(vote.voter, profile.address))
              .leftJoin(raterProfile, eq(vote.voter, raterProfile.address))
              .leftJoin(
                raterHumanCredential,
                eq(vote.voter, raterHumanCredential.rater),
              )
              .where(and(...baseConditions))
              .groupBy(vote.voter, profile.name)
              .having(sql`count(*) >= ${minVotes}`)
              .orderBy(...windowedOrderByExprs)
              .limit(limit)
              .offset(offset);

      const items = rows.map((row) => ({
        voter: row.voter,
        totalSettledVotes: Number(row.totalSettledVotes),
        totalWins: Number(row.totalWins),
        totalLosses: Number(row.totalLosses),
        totalStakeWon:
          typeof row.totalStakeWon === "bigint"
            ? row.totalStakeWon
            : BigInt(row.totalStakeWon ?? 0),
        totalStakeLost:
          typeof row.totalStakeLost === "bigint"
            ? row.totalStakeLost
            : BigInt(row.totalStakeLost ?? 0),
        profileName: row.profileName,
        winRate: Number(row.winRate),
      }));

      return jsonBig(c, {
        items: includeReputation
          ? await attachAccuracyLeaderboardReputation(items)
          : items,
        categoryId: categoryIdParam,
        window: windowBounds.window,
        startsAt: windowBounds.startsAt,
        endsAt: windowBounds.endsAt,
      });
    }

    if (categoryId !== null) {
      const items = await db
        .select({
          voter: voterCategoryStats.voter,
          totalSettledVotes: voterCategoryStats.totalSettledVotes,
          totalWins: voterCategoryStats.totalWins,
          totalLosses: voterCategoryStats.totalLosses,
          totalStakeWon: voterCategoryStats.totalStakeWon,
          totalStakeLost: voterCategoryStats.totalStakeLost,
          profileName: profile.name,
        })
        .from(voterCategoryStats)
        .leftJoin(profile, eq(voterCategoryStats.voter, profile.address))
        .leftJoin(
          raterProfile,
          eq(voterCategoryStats.voter, raterProfile.address),
        )
        .leftJoin(
          raterHumanCredential,
          eq(voterCategoryStats.voter, raterHumanCredential.rater),
        )
        .where(
          and(
            eq(voterCategoryStats.categoryId, categoryId),
            gte(voterCategoryStats.totalSettledVotes, minVotes),
            ...(raterTypeCondition ? [raterTypeCondition] : []),
          ),
        )
        .orderBy(...categoryOrderByExprs)
        .limit(limit)
        .offset(offset);

      const result = items.map((item) => ({
        ...item,
        winRate:
          item.totalSettledVotes > 0
            ? item.totalWins / item.totalSettledVotes
            : 0,
      }));

      return jsonBig(c, {
        items: includeReputation
          ? await attachAccuracyLeaderboardReputation(result)
          : result,
        categoryId: categoryIdParam,
        window: windowBounds.window,
        startsAt: null,
        endsAt: null,
      });
    }

    const items = await db
      .select({
        voter: voterStats.voter,
        totalSettledVotes: voterStats.totalSettledVotes,
        totalWins: voterStats.totalWins,
        totalLosses: voterStats.totalLosses,
        totalStakeWon: voterStats.totalStakeWon,
        totalStakeLost: voterStats.totalStakeLost,
        currentStreak: voterStats.currentStreak,
        bestWinStreak: voterStats.bestWinStreak,
        profileName: profile.name,
      })
      .from(voterStats)
      .leftJoin(profile, eq(voterStats.voter, profile.address))
      .leftJoin(raterProfile, eq(voterStats.voter, raterProfile.address))
      .leftJoin(
        raterHumanCredential,
        eq(voterStats.voter, raterHumanCredential.rater),
      )
      .where(
        and(
          gte(voterStats.totalSettledVotes, minVotes),
          ...(raterTypeCondition ? [raterTypeCondition] : []),
        ),
      )
      .orderBy(...overallOrderByExprs)
      .limit(limit)
      .offset(offset);

    const result = items.map((item) => ({
      ...item,
      winRate:
        item.totalSettledVotes > 0
          ? item.totalWins / item.totalSettledVotes
          : 0,
    }));

    return jsonBig(c, {
      items: includeReputation
        ? await attachAccuracyLeaderboardReputation(result)
        : result,
      window: windowBounds.window,
      startsAt: null,
      endsAt: null,
    });
  });

  app.get("/earnings-leaderboard", async (c) => {
    const windowBounds = resolveAccuracyLeaderboardWindow(c.req.query("window"));
    if (windowBounds === null) return c.json({ error: "Invalid window" }, 400);

    const asset = parseEarningsAssetFilter(c.req.query("asset"));
    if (asset === null) return c.json({ error: "Invalid asset" }, 400);

    const source = parseEarningsSourceFilter(c.req.query("source"));
    if (source === null) return c.json({ error: "Invalid source" }, 400);

    const limit = safeLimit(c.req.query("limit"), 20, 100);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const items = await getEarningsLeaderboard({
      asset,
      bounds: windowBounds,
      limit,
      offset,
      source,
    });

    return jsonBig(c, {
      items,
      asset,
      source,
      window: windowBounds.window,
      startsAt: windowBounds.startsAt,
      endsAt: windowBounds.endsAt,
      limit,
      offset,
    });
  });
}
