import { and, desc, eq, gte, lt, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  feedbackBonusAward,
  profile,
  questionBundleClaim,
  questionBundleReward,
  questionRewardPool,
  questionRewardPoolClaim,
  rewardClaim,
} from "ponder:schema";

type EarningsAssetFilter = "all" | "lrep" | "usdc";
type EarningsSourceFilter = "all" | "bounty" | "feedback" | "round" | "launch";
type EarningsSource =
  | "question_reward"
  | "question_bundle_reward"
  | "feedback_bonus"
  | "round_reward"
  | "launch_reward";

/** rewardClaim.source values backing the "round" and "launch" earnings buckets. */
type RewardClaimSource = "round" | "launch";

interface WindowBounds {
  startsAt: bigint | null;
  endsAt: bigint | null;
}

interface EarningsAggregateRow {
  asset: number;
  totalAmount: bigint;
  eventCount: number;
  latestPaidAt: bigint | null;
}

interface EarningsContributionRow extends EarningsAggregateRow {
  address: `0x${string}`;
  profileName: string | null;
}

interface ProfileEarningsSummary {
  totalUsdcEarned: bigint;
  totalLrepEarned: bigint;
  bountyUsdcEarned: bigint;
  bountyLrepEarned: bigint;
  feedbackUsdcEarned: bigint;
  feedbackLrepEarned: bigint;
  roundLrepEarned: bigint;
  launchLrepEarned: bigint;
  paidEventCount: number;
  latestPaidAt: bigint | null;
}

interface ProfileEarningItem {
  id: string;
  source: EarningsSource;
  asset: number;
  currency: "LREP" | "USDC";
  amount: bigint;
  grossAmount: bigint;
  frontendFee: bigint;
  contentId: bigint | null;
  roundId: bigint | null;
  rewardPoolId: bigint | null;
  bundleId: bigint | null;
  roundSetIndex: number | null;
  feedbackHash: `0x${string}` | null;
  title: string | null;
  paidAt: bigint;
}

interface EarningsLeaderboardItem extends ProfileEarningsSummary {
  voter: `0x${string}`;
  profileName: string | null;
}

const REWARD_ASSET_LREP = 0;
const REWARD_ASSET_USDC = 1;

export function parseEarningsAssetFilter(value: string | undefined): EarningsAssetFilter | null {
  if (!value || value === "all") return "all";
  if (value === "lrep" || value === "usdc") return value;
  return null;
}

export function parseEarningsSourceFilter(value: string | undefined): EarningsSourceFilter | null {
  if (!value || value === "all") return "all";
  if (value === "bounty" || value === "feedback" || value === "round" || value === "launch") return value;
  return null;
}

export function emptyProfileEarningsSummary(): ProfileEarningsSummary {
  return {
    totalUsdcEarned: 0n,
    totalLrepEarned: 0n,
    bountyUsdcEarned: 0n,
    bountyLrepEarned: 0n,
    feedbackUsdcEarned: 0n,
    feedbackLrepEarned: 0n,
    roundLrepEarned: 0n,
    launchLrepEarned: 0n,
    paidEventCount: 0,
    latestPaidAt: null,
  };
}

function currencyForAsset(asset: number): "LREP" | "USDC" {
  return asset === REWARD_ASSET_LREP ? "LREP" : "USDC";
}

function assetCondition(assetExpr: any, asset: EarningsAssetFilter) {
  if (asset === "lrep") return eq(assetExpr, REWARD_ASSET_LREP);
  if (asset === "usdc") return eq(assetExpr, REWARD_ASSET_USDC);
  return null;
}

function timeConditions(timestampExpr: any, bounds: WindowBounds) {
  const conditions = [];
  if (bounds.startsAt !== null) conditions.push(gte(timestampExpr, bounds.startsAt));
  if (bounds.endsAt !== null) conditions.push(lt(timestampExpr, bounds.endsAt));
  return conditions;
}

function mergeLatestPaidAt(current: bigint | null, next: bigint | null) {
  if (next === null) return current;
  if (current === null || next > current) return next;
  return current;
}

function addAggregate(
  summary: ProfileEarningsSummary,
  source: EarningsSourceFilter,
  asset: number,
  amount: bigint,
  eventCount: number,
  latestPaidAt: bigint | null,
) {
  if (asset === REWARD_ASSET_LREP) {
    summary.totalLrepEarned += amount;
  } else {
    summary.totalUsdcEarned += amount;
  }

  if (source === "bounty") {
    if (asset === REWARD_ASSET_LREP) summary.bountyLrepEarned += amount;
    else summary.bountyUsdcEarned += amount;
  } else if (source === "feedback") {
    if (asset === REWARD_ASSET_LREP) summary.feedbackLrepEarned += amount;
    else summary.feedbackUsdcEarned += amount;
  } else if (source === "round") {
    summary.roundLrepEarned += amount;
  } else if (source === "launch") {
    summary.launchLrepEarned += amount;
  }

  summary.paidEventCount += Number(eventCount ?? 0);
  summary.latestPaidAt = mergeLatestPaidAt(summary.latestPaidAt, latestPaidAt);
}

function addRowAggregate(
  summary: ProfileEarningsSummary,
  source: EarningsSourceFilter,
  row: EarningsAggregateRow | EarningsContributionRow,
) {
  addAggregate(
    summary,
    source,
    Number(row.asset),
    BigInt(row.totalAmount ?? 0n),
    Number(row.eventCount ?? 0),
    row.latestPaidAt === null || row.latestPaidAt === undefined ? null : BigInt(row.latestPaidAt),
  );
}

async function getQuestionRewardAggregates(address: `0x${string}`, bounds: WindowBounds, asset: EarningsAssetFilter) {
  const conditions = [eq(questionRewardPoolClaim.claimant, address), ...timeConditions(questionRewardPoolClaim.claimedAt, bounds)];
  const assetFilter = assetCondition(questionRewardPool.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      asset: questionRewardPool.asset,
      totalAmount: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.amount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${questionRewardPoolClaim.claimedAt})`,
    })
    .from(questionRewardPoolClaim)
    .innerJoin(questionRewardPool, eq(questionRewardPoolClaim.rewardPoolId, questionRewardPool.id))
    .where(and(...conditions))
    .groupBy(questionRewardPool.asset);
}

async function getQuestionBundleAggregates(address: `0x${string}`, bounds: WindowBounds, asset: EarningsAssetFilter) {
  const conditions = [eq(questionBundleClaim.claimant, address), ...timeConditions(questionBundleClaim.claimedAt, bounds)];
  const assetFilter = assetCondition(questionBundleReward.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      asset: questionBundleReward.asset,
      totalAmount: sql<bigint>`coalesce(sum(${questionBundleClaim.amount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${questionBundleClaim.claimedAt})`,
    })
    .from(questionBundleClaim)
    .innerJoin(questionBundleReward, eq(questionBundleClaim.bundleId, questionBundleReward.id))
    .where(and(...conditions))
    .groupBy(questionBundleReward.asset);
}

async function getFeedbackBonusAggregates(address: `0x${string}`, bounds: WindowBounds, asset: EarningsAssetFilter) {
  const conditions = [eq(feedbackBonusAward.recipient, address), ...timeConditions(feedbackBonusAward.awardedAt, bounds)];
  const assetFilter = assetCondition(feedbackBonusAward.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      asset: feedbackBonusAward.asset,
      totalAmount: sql<bigint>`coalesce(sum(${feedbackBonusAward.recipientAmount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${feedbackBonusAward.awardedAt})`,
    })
    .from(feedbackBonusAward)
    .where(and(...conditions))
    .groupBy(feedbackBonusAward.asset);
}

async function getRewardClaimAggregates(
  address: `0x${string}`,
  bounds: WindowBounds,
  claimSource: RewardClaimSource,
) {
  // Filter by rewardClaim.source: rewardClaim also stores launch-pool bonus rows
  // (source "launch") and cancelled-round refunds (source "refund"), which must not leak
  // into the "round" earnings bucket.
  const conditions = [
    eq(rewardClaim.voter, address),
    eq(rewardClaim.source, claimSource),
    sql`${rewardClaim.lrepReward} > 0`,
    ...timeConditions(rewardClaim.claimedAt, bounds),
  ];

  return db
    .select({
      asset: sql<number>`${REWARD_ASSET_LREP}`,
      totalAmount: sql<bigint>`coalesce(sum(${rewardClaim.lrepReward}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${rewardClaim.claimedAt})`,
    })
    .from(rewardClaim)
    .where(and(...conditions));
}

export async function getProfileEarningsSummary(
  address: `0x${string}`,
  {
    asset = "all",
    bounds = { startsAt: null, endsAt: null },
    source = "all",
  }: {
    asset?: EarningsAssetFilter;
    bounds?: WindowBounds;
    source?: EarningsSourceFilter;
  } = {},
) {
  const summary = emptyProfileEarningsSummary();
  const includeBounty = source === "all" || source === "bounty";
  const includeFeedback = source === "all" || source === "feedback";
  const includeRound = (source === "all" || source === "round") && asset !== "usdc";
  const includeLaunch = (source === "all" || source === "launch") && asset !== "usdc";

  const [questionRewards, bundleRewards, feedbackRewards, roundRewards, launchRewards] = await Promise.all([
    includeBounty ? getQuestionRewardAggregates(address, bounds, asset) : [],
    includeBounty ? getQuestionBundleAggregates(address, bounds, asset) : [],
    includeFeedback ? getFeedbackBonusAggregates(address, bounds, asset) : [],
    includeRound ? getRewardClaimAggregates(address, bounds, "round") : [],
    includeLaunch ? getRewardClaimAggregates(address, bounds, "launch") : [],
  ]);

  for (const row of questionRewards) addRowAggregate(summary, "bounty", row);
  for (const row of bundleRewards) addRowAggregate(summary, "bounty", row);
  for (const row of feedbackRewards) addRowAggregate(summary, "feedback", row);
  for (const row of roundRewards) addRowAggregate(summary, "round", row);
  for (const row of launchRewards) addRowAggregate(summary, "launch", row);

  return summary;
}

export async function getRecentProfileEarnings(address: `0x${string}`, limit: number) {
  const sourceLimit = Math.min(Math.max(limit, 20), 100);
  const [questionRewards, bundleRewards, feedbackRewards, roundRewards] = await Promise.all([
    db
      .select({
        id: questionRewardPoolClaim.id,
        source: sql<EarningsSource>`'question_reward'`,
        asset: questionRewardPool.asset,
        amount: questionRewardPoolClaim.amount,
        grossAmount: questionRewardPoolClaim.grossAmount,
        frontendFee: questionRewardPoolClaim.frontendFee,
        contentId: questionRewardPoolClaim.contentId,
        roundId: questionRewardPoolClaim.roundId,
        rewardPoolId: questionRewardPoolClaim.rewardPoolId,
        bundleId: sql<bigint | null>`null`,
        roundSetIndex: sql<number | null>`null`,
        feedbackHash: sql<`0x${string}` | null>`null`,
        title: content.title,
        paidAt: questionRewardPoolClaim.claimedAt,
      })
      .from(questionRewardPoolClaim)
      .innerJoin(questionRewardPool, eq(questionRewardPoolClaim.rewardPoolId, questionRewardPool.id))
      .innerJoin(content, eq(questionRewardPoolClaim.contentId, content.id))
      .where(eq(questionRewardPoolClaim.claimant, address))
      .orderBy(desc(questionRewardPoolClaim.claimedAt))
      .limit(sourceLimit),
    db
      .select({
        id: questionBundleClaim.id,
        source: sql<EarningsSource>`'question_bundle_reward'`,
        asset: questionBundleReward.asset,
        amount: questionBundleClaim.amount,
        grossAmount: questionBundleClaim.grossAmount,
        frontendFee: questionBundleClaim.frontendFee,
        contentId: sql<bigint | null>`null`,
        roundId: sql<bigint | null>`null`,
        rewardPoolId: sql<bigint | null>`null`,
        bundleId: questionBundleClaim.bundleId,
        roundSetIndex: questionBundleClaim.roundSetIndex,
        feedbackHash: sql<`0x${string}` | null>`null`,
        title: sql<string | null>`null`,
        paidAt: questionBundleClaim.claimedAt,
      })
      .from(questionBundleClaim)
      .innerJoin(questionBundleReward, eq(questionBundleClaim.bundleId, questionBundleReward.id))
      .where(eq(questionBundleClaim.claimant, address))
      .orderBy(desc(questionBundleClaim.claimedAt))
      .limit(sourceLimit),
    db
      .select({
        id: feedbackBonusAward.id,
        source: sql<EarningsSource>`'feedback_bonus'`,
        asset: feedbackBonusAward.asset,
        amount: feedbackBonusAward.recipientAmount,
        grossAmount: feedbackBonusAward.grossAmount,
        frontendFee: feedbackBonusAward.frontendFee,
        contentId: feedbackBonusAward.contentId,
        roundId: feedbackBonusAward.roundId,
        rewardPoolId: feedbackBonusAward.poolId,
        bundleId: sql<bigint | null>`null`,
        roundSetIndex: sql<number | null>`null`,
        feedbackHash: feedbackBonusAward.feedbackHash,
        title: content.title,
        paidAt: feedbackBonusAward.awardedAt,
      })
      .from(feedbackBonusAward)
      .innerJoin(content, eq(feedbackBonusAward.contentId, content.id))
      .where(eq(feedbackBonusAward.recipient, address))
      .orderBy(desc(feedbackBonusAward.awardedAt))
      .limit(sourceLimit),
    // Round rewards and launch-pool bonuses both live in rewardClaim. Launch rows often carry
    // contentId 0 (no content row), so left-join content instead of inner-joining: otherwise
    // they would be counted in the summary while silently vanishing from this itemized list.
    db
      .select({
        id: rewardClaim.id,
        source: sql<EarningsSource>`case when ${rewardClaim.source} = 'launch' then 'launch_reward' else 'round_reward' end`,
        asset: sql<number>`${REWARD_ASSET_LREP}`,
        amount: rewardClaim.lrepReward,
        grossAmount: rewardClaim.lrepReward,
        frontendFee: sql<bigint>`0`,
        contentId: sql<bigint | null>`case when ${rewardClaim.source} = 'launch' and ${rewardClaim.contentId} = 0 then null else ${rewardClaim.contentId} end`,
        roundId: sql<bigint | null>`case when ${rewardClaim.source} = 'launch' and ${rewardClaim.contentId} = 0 then null else ${rewardClaim.roundId} end`,
        rewardPoolId: sql<bigint | null>`null`,
        bundleId: sql<bigint | null>`null`,
        roundSetIndex: sql<number | null>`null`,
        feedbackHash: sql<`0x${string}` | null>`null`,
        title: content.title,
        paidAt: rewardClaim.claimedAt,
      })
      .from(rewardClaim)
      .leftJoin(content, eq(rewardClaim.contentId, content.id))
      .where(
        and(
          eq(rewardClaim.voter, address),
          sql`${rewardClaim.source} in ('round', 'launch')`,
          sql`${rewardClaim.lrepReward} > 0`,
        ),
      )
      .orderBy(desc(rewardClaim.claimedAt))
      .limit(sourceLimit),
  ]);

  return [...questionRewards, ...bundleRewards, ...feedbackRewards, ...roundRewards]
    .map((item) => ({
      ...item,
      currency: currencyForAsset(Number(item.asset)),
    }))
    .sort((a, b) => {
      const left = BigInt(a.paidAt ?? 0n);
      const right = BigInt(b.paidAt ?? 0n);
      if (left !== right) return left > right ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    })
    .slice(0, limit) as ProfileEarningItem[];
}

function mergeContribution(
  items: Map<string, EarningsLeaderboardItem>,
  row: EarningsContributionRow,
  source: EarningsSourceFilter,
) {
  const address = row.address.toLowerCase() as `0x${string}`;
  const item =
    items.get(address) ??
    ({
      voter: address,
      profileName: row.profileName ?? null,
      ...emptyProfileEarningsSummary(),
    } satisfies EarningsLeaderboardItem);
  item.profileName = item.profileName ?? row.profileName ?? null;
  addRowAggregate(item, source, row);
  items.set(address, item);
}

async function getQuestionRewardContributions(bounds: WindowBounds, asset: EarningsAssetFilter, limit: number) {
  const conditions = timeConditions(questionRewardPoolClaim.claimedAt, bounds);
  const assetFilter = assetCondition(questionRewardPool.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      address: questionRewardPoolClaim.claimant,
      profileName: profile.name,
      asset: questionRewardPool.asset,
      totalAmount: sql<bigint>`coalesce(sum(${questionRewardPoolClaim.amount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${questionRewardPoolClaim.claimedAt})`,
    })
    .from(questionRewardPoolClaim)
    .innerJoin(questionRewardPool, eq(questionRewardPoolClaim.rewardPoolId, questionRewardPool.id))
    .leftJoin(profile, eq(questionRewardPoolClaim.claimant, profile.address))
    .where(conditions.length > 0 ? and(...conditions) : sql`true`)
    .groupBy(questionRewardPoolClaim.claimant, profile.name, questionRewardPool.asset)
    .orderBy(desc(sql`sum(${questionRewardPoolClaim.amount})`))
    .limit(limit);
}

async function getQuestionBundleContributions(bounds: WindowBounds, asset: EarningsAssetFilter, limit: number) {
  const conditions = timeConditions(questionBundleClaim.claimedAt, bounds);
  const assetFilter = assetCondition(questionBundleReward.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      address: questionBundleClaim.claimant,
      profileName: profile.name,
      asset: questionBundleReward.asset,
      totalAmount: sql<bigint>`coalesce(sum(${questionBundleClaim.amount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${questionBundleClaim.claimedAt})`,
    })
    .from(questionBundleClaim)
    .innerJoin(questionBundleReward, eq(questionBundleClaim.bundleId, questionBundleReward.id))
    .leftJoin(profile, eq(questionBundleClaim.claimant, profile.address))
    .where(conditions.length > 0 ? and(...conditions) : sql`true`)
    .groupBy(questionBundleClaim.claimant, profile.name, questionBundleReward.asset)
    .orderBy(desc(sql`sum(${questionBundleClaim.amount})`))
    .limit(limit);
}

async function getFeedbackBonusContributions(bounds: WindowBounds, asset: EarningsAssetFilter, limit: number) {
  const conditions = timeConditions(feedbackBonusAward.awardedAt, bounds);
  const assetFilter = assetCondition(feedbackBonusAward.asset, asset);
  if (assetFilter) conditions.push(assetFilter);

  return db
    .select({
      address: feedbackBonusAward.recipient,
      profileName: profile.name,
      asset: feedbackBonusAward.asset,
      totalAmount: sql<bigint>`coalesce(sum(${feedbackBonusAward.recipientAmount}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${feedbackBonusAward.awardedAt})`,
    })
    .from(feedbackBonusAward)
    .leftJoin(profile, eq(feedbackBonusAward.recipient, profile.address))
    .where(conditions.length > 0 ? and(...conditions) : sql`true`)
    .groupBy(feedbackBonusAward.recipient, profile.name, feedbackBonusAward.asset)
    .orderBy(desc(sql`sum(${feedbackBonusAward.recipientAmount})`))
    .limit(limit);
}

async function getRewardClaimContributions(
  bounds: WindowBounds,
  limit: number,
  claimSource: RewardClaimSource,
) {
  // See getRewardClaimAggregates: keep launch-pool bonuses and refunds out of the "round"
  // bucket by filtering on rewardClaim.source.
  const conditions = [
    eq(rewardClaim.source, claimSource),
    sql`${rewardClaim.lrepReward} > 0`,
    ...timeConditions(rewardClaim.claimedAt, bounds),
  ];

  return db
    .select({
      address: rewardClaim.voter,
      profileName: profile.name,
      asset: sql<number>`${REWARD_ASSET_LREP}`,
      totalAmount: sql<bigint>`coalesce(sum(${rewardClaim.lrepReward}), 0)`,
      eventCount: sql<number>`count(*)`,
      latestPaidAt: sql<bigint | null>`max(${rewardClaim.claimedAt})`,
    })
    .from(rewardClaim)
    .leftJoin(profile, eq(rewardClaim.voter, profile.address))
    .where(and(...conditions))
    .groupBy(rewardClaim.voter, profile.name)
    .orderBy(desc(sql`sum(${rewardClaim.lrepReward})`))
    .limit(limit);
}

export async function getEarningsLeaderboard({
  asset,
  bounds,
  limit,
  offset,
  source,
}: {
  asset: EarningsAssetFilter;
  bounds: WindowBounds;
  limit: number;
  offset: number;
  source: EarningsSourceFilter;
}) {
  const sourceLimit = Math.min(Math.max(limit + offset, 50) * 4, 1000);
  const includeBounty = source === "all" || source === "bounty";
  const includeFeedback = source === "all" || source === "feedback";
  const includeRound = (source === "all" || source === "round") && asset !== "usdc";
  const includeLaunch = (source === "all" || source === "launch") && asset !== "usdc";

  const [questionRewards, bundleRewards, feedbackRewards, roundRewards, launchRewards] = await Promise.all([
    includeBounty ? getQuestionRewardContributions(bounds, asset, sourceLimit) : [],
    includeBounty ? getQuestionBundleContributions(bounds, asset, sourceLimit) : [],
    includeFeedback ? getFeedbackBonusContributions(bounds, asset, sourceLimit) : [],
    includeRound ? getRewardClaimContributions(bounds, sourceLimit, "round") : [],
    includeLaunch ? getRewardClaimContributions(bounds, sourceLimit, "launch") : [],
  ]);

  const items = new Map<string, EarningsLeaderboardItem>();
  for (const row of questionRewards) mergeContribution(items, row, "bounty");
  for (const row of bundleRewards) mergeContribution(items, row, "bounty");
  for (const row of feedbackRewards) mergeContribution(items, row, "feedback");
  for (const row of roundRewards) mergeContribution(items, row, "round");
  for (const row of launchRewards) mergeContribution(items, row, "launch");

  return [...items.values()]
    .sort((left, right) => {
      const leftPrimary =
        asset === "lrep" ? left.totalLrepEarned : asset === "usdc" ? left.totalUsdcEarned : left.totalUsdcEarned;
      const rightPrimary =
        asset === "lrep" ? right.totalLrepEarned : asset === "usdc" ? right.totalUsdcEarned : right.totalUsdcEarned;
      if (leftPrimary !== rightPrimary) return leftPrimary > rightPrimary ? -1 : 1;

      if (asset === "all" && left.totalLrepEarned !== right.totalLrepEarned) {
        return left.totalLrepEarned > right.totalLrepEarned ? -1 : 1;
      }
      if (left.paidEventCount !== right.paidEventCount) return right.paidEventCount - left.paidEventCount;
      return left.voter.localeCompare(right.voter);
    })
    .slice(offset, offset + limit);
}
