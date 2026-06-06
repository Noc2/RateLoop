import { DEFAULT_REVEAL_GRACE_PERIOD_SECONDS, DEFAULT_ROUND_CONFIG, ROUND_STATE } from "@rateloop/contracts/protocol";
import type { Context, Hono } from "hono";
import { and, desc, eq, inArray, replaceBigInts, sql } from "ponder";
import { db } from "ponder:api";
import { feedbackBonusPool, questionRewardPool, round } from "ponder:schema";
import { isValidAddress, safeBigInt } from "./utils.js";

export type ApiApp = Hono;

export const DISCOVER_MODULE_LIMIT = 6;
export const SETTLING_SOON_WINDOW_SECONDS = 24 * 60 * 60;
export const NOTIFICATION_EMAIL_LOOKBACK_SECONDS = 48 * 60 * 60;
export const AVATAR_CATEGORY_WINDOW_SECONDS = 90 * 24 * 60 * 60;

export function jsonBig(c: Context, data: unknown, status?: number) {
  const payload = replaceBigInts(data, (value: bigint) => String(value));
  return status === undefined ? c.json(payload) : c.json(payload, status as any);
}

export function parseBigIntList(value: string | undefined, max = 50) {
  if (!value) return [];

  const unique = new Set<string>();
  const items: bigint[] = [];

  for (const raw of value.split(",").slice(0, max)) {
    const parsed = safeBigInt(raw.trim());
    if (parsed === null) continue;

    const key = parsed.toString();
    if (unique.has(key)) continue;
    unique.add(key);
    items.push(parsed);
  }

  return items;
}

export function parseAddressList(value: string | undefined, max = 200) {
  if (!value) return [];

  const unique = new Set<string>();
  const items: `0x${string}`[] = [];

  for (const raw of value.split(",").slice(0, max)) {
    const address = raw.trim().toLowerCase() as `0x${string}`;
    if (!isValidAddress(address)) continue;
    if (unique.has(address)) continue;
    unique.add(address);
    items.push(address);
  }

  return items;
}

export function getEstimatedSettlementTime(
  startTime: bigint | null | undefined,
  epochDurationSeconds = DEFAULT_ROUND_CONFIG.epochDurationSeconds,
) {
  if (startTime === null || startTime === undefined) return null;

  return (
    startTime
    + BigInt(epochDurationSeconds)
    + BigInt(DEFAULT_REVEAL_GRACE_PERIOD_SECONDS)
  );
}

export function getDiscoverResolutionOutcome(state: number | null, isUp: boolean | null, upWins: boolean | null) {
  if (state === ROUND_STATE.Cancelled) return "cancelled" as const;
  if (state === ROUND_STATE.Tied) return "tied" as const;
  if (state === ROUND_STATE.RevealFailed) return "reveal_failed" as const;
  if (state === ROUND_STATE.Settled && isUp !== null && upWins !== null) {
    return isUp === upWins ? "won" as const : "lost" as const;
  }

  return "resolved" as const;
}

export async function attachOpenRoundSummary<T extends { id: bigint }>(items: T[]) {
  if (items.length === 0) {
    return items.map(item => ({
      ...item,
      contentId: item.id,
      question: "title" in item ? item.title : undefined,
      link: "url" in item ? item.url || null : undefined,
      rewardPoolSummary: emptyRewardPoolSummary(),
      feedbackBonusSummary: emptyFeedbackBonusSummary(),
      openRound: null,
      latestRound: null,
    }));
  }

  const contentIds = items.map(item => item.id);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  // I-5: match the contract's strict boundary (WindowLib.rewardPoolExpired treats a pool as expired
  // only when block.timestamp > closesAt/startBy). So active iff now <= boundary (>=), expired iff
  // now > boundary (<). Previously the indexer flipped at now == boundary, one second early.
  const pendingOrActiveRewardPool = sql<boolean>`${questionRewardPool.refunded} = false
    and ${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}
    and (
      ${questionRewardPool.bountyWindowSeconds} = 0
      or (${questionRewardPool.bountyClosesAt} != 0 and ${questionRewardPool.bountyClosesAt} >= ${nowSeconds})
      or (${questionRewardPool.bountyClosesAt} = 0 and ${questionRewardPool.bountyStartBy} >= ${nowSeconds})
    )`;
  const expiredRewardPool = sql<boolean>`${questionRewardPool.refunded} = false
    and ${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}
    and ${questionRewardPool.bountyWindowSeconds} != 0
    and (
      (${questionRewardPool.bountyClosesAt} != 0 and ${questionRewardPool.bountyClosesAt} < ${nowSeconds})
      or (${questionRewardPool.bountyClosesAt} = 0 and ${questionRewardPool.bountyStartBy} < ${nowSeconds})
    )`;
  const currentRewardPoolAsset = sql<number | null>`case
    when ${questionRewardPool.allocatedAmount} > ${questionRewardPool.claimedAmount}
      or ${pendingOrActiveRewardPool}
    then ${questionRewardPool.asset}
    else null
  end`;
  const rewardPoolRows = await db
    .select({
      contentId: questionRewardPool.contentId,
      asset: sql<number | null>`case when min(${currentRewardPoolAsset}) = max(${currentRewardPoolAsset}) then min(${currentRewardPoolAsset}) else null end`,
      bountyEligibility: sql<number | null>`case when min(${questionRewardPool.bountyEligibility}) = max(${questionRewardPool.bountyEligibility}) then min(${questionRewardPool.bountyEligibility}) else null end`,
      bountyEligibilityDataHash: sql<string | null>`case when min(${questionRewardPool.bountyEligibilityDataHash}) = max(${questionRewardPool.bountyEligibilityDataHash}) then min(${questionRewardPool.bountyEligibilityDataHash}) else null end`,
      rewardPoolCount: sql<number>`count(*)`,
      activeRewardPoolCount: sql<number>`sum(case when ${pendingOrActiveRewardPool} then 1 else 0 end)`,
      expiredRewardPoolCount: sql<number>`sum(case when ${expiredRewardPool} then 1 else 0 end)`,
      openEndedRewardPoolCount: sql<number>`sum(case when ${questionRewardPool.refunded} = false and ${questionRewardPool.bountyWindowSeconds} = 0 then 1 else 0 end)`,
      fundedAsset: sql<number | null>`case when min(${questionRewardPool.asset}) = max(${questionRewardPool.asset}) then min(${questionRewardPool.asset}) else null end`,
      totalFundedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.fundedAmount}), 0)`,
      totalUnallocatedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.unallocatedAmount}), 0)`,
      activeUnallocatedAmount: sql<bigint>`coalesce(sum(case when ${pendingOrActiveRewardPool} then ${questionRewardPool.unallocatedAmount} else 0 end), 0)`,
      expiredUnallocatedAmount: sql<bigint>`coalesce(sum(case when ${expiredRewardPool} then ${questionRewardPool.unallocatedAmount} else 0 end), 0)`,
      totalAllocatedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.allocatedAmount}), 0)`,
      totalClaimedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.claimedAmount}), 0)`,
      claimableAllocatedAmount: sql<bigint>`coalesce(sum(case when ${questionRewardPool.allocatedAmount} > ${questionRewardPool.claimedAmount} then ${questionRewardPool.allocatedAmount} - ${questionRewardPool.claimedAmount} else 0 end), 0)`,
      totalVoterClaimedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.voterClaimedAmount}), 0)`,
      totalFrontendClaimedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.frontendClaimedAmount}), 0)`,
      totalRefundedAmount: sql<bigint>`coalesce(sum(${questionRewardPool.refundedAmount}), 0)`,
      qualifiedRoundCount: sql<number>`coalesce(sum(${questionRewardPool.qualifiedRounds}), 0)`,
      nextBountyStartBy: sql<bigint | null>`min(case when ${pendingOrActiveRewardPool} and ${questionRewardPool.bountyClosesAt} = 0 and ${questionRewardPool.bountyWindowSeconds} != 0 then ${questionRewardPool.bountyStartBy} else null end)`,
      nextBountyClosesAt: sql<bigint | null>`min(case when ${pendingOrActiveRewardPool} and ${questionRewardPool.bountyClosesAt} != 0 then ${questionRewardPool.bountyClosesAt} else null end)`,
      lastBountyStartBy: sql<bigint | null>`max(case when ${questionRewardPool.bountyStartBy} != 0 then ${questionRewardPool.bountyStartBy} else null end)`,
      lastBountyClosesAt: sql<bigint | null>`max(case when ${questionRewardPool.bountyClosesAt} != 0 then ${questionRewardPool.bountyClosesAt} else null end)`,
      nextFeedbackClosesAt: sql<bigint | null>`min(case when ${questionRewardPool.feedbackClosesAt} != 0 and ${questionRewardPool.feedbackClosesAt} > ${nowSeconds} then ${questionRewardPool.feedbackClosesAt} else null end)`,
    })
    .from(questionRewardPool)
    .where(inArray(questionRewardPool.contentId, contentIds))
    .groupBy(questionRewardPool.contentId);

  const rewardPoolSummaryByContentId = new Map<bigint, ReturnType<typeof formatRewardPoolSummary>>();
  for (const row of rewardPoolRows) {
    rewardPoolSummaryByContentId.set(row.contentId, formatRewardPoolSummary(row));
  }

  const feedbackBonusRows = await db
    .select({
      contentId: feedbackBonusPool.contentId,
      asset: feedbackBonusPool.asset,
      poolCount: sql<number>`count(*)`,
      activePoolCount: sql<number>`sum(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.remainingAmount} > 0 and ${feedbackBonusPool.awardDeadline} >= ${nowSeconds} then 1 else 0 end)`,
      expiredPoolCount: sql<number>`sum(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.remainingAmount} > 0 and ${feedbackBonusPool.awardDeadline} < ${nowSeconds} then 1 else 0 end)`,
      totalFundedAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.fundedAmount}), 0)`,
      totalRemainingAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.remainingAmount}), 0)`,
      activeRemainingAmount: sql<bigint>`coalesce(sum(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.awardDeadline} >= ${nowSeconds} then ${feedbackBonusPool.remainingAmount} else 0 end), 0)`,
      expiredRemainingAmount: sql<bigint>`coalesce(sum(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.remainingAmount} > 0 and ${feedbackBonusPool.awardDeadline} < ${nowSeconds} then ${feedbackBonusPool.remainingAmount} else 0 end), 0)`,
      totalAwardedAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.awardedAmount}), 0)`,
      totalVoterAwardedAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.voterAwardedAmount}), 0)`,
      totalFrontendAwardedAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.frontendAwardedAmount}), 0)`,
      totalForfeitedAmount: sql<bigint>`coalesce(sum(${feedbackBonusPool.forfeitedAmount}), 0)`,
      awardCount: sql<number>`coalesce(sum(${feedbackBonusPool.awardCount}), 0)`,
      nextFeedbackAwardDeadline: sql<bigint | null>`min(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.remainingAmount} > 0 and ${feedbackBonusPool.awardDeadline} >= ${nowSeconds} then ${feedbackBonusPool.awardDeadline} else null end)`,
      nextFeedbackClosesAt: sql<bigint | null>`min(case when ${feedbackBonusPool.forfeited} = false and ${feedbackBonusPool.remainingAmount} > 0 and ${feedbackBonusPool.awardDeadline} >= ${nowSeconds} then ${feedbackBonusPool.awardDeadline} else null end)`,
    })
    .from(feedbackBonusPool)
    .where(inArray(feedbackBonusPool.contentId, contentIds))
    .groupBy(feedbackBonusPool.contentId, feedbackBonusPool.asset);

  const feedbackBonusRowsByContentId = new Map<bigint, FeedbackBonusSummaryRow[]>();
  for (const row of feedbackBonusRows) {
    feedbackBonusRowsByContentId.set(row.contentId, [...(feedbackBonusRowsByContentId.get(row.contentId) ?? []), row]);
  }

  const feedbackBonusSummaryByContentId = new Map<bigint, ReturnType<typeof formatFeedbackBonusSummaryRows>>();
  for (const [contentId, rows] of feedbackBonusRowsByContentId) {
    feedbackBonusSummaryByContentId.set(contentId, formatFeedbackBonusSummaryRows(rows));
  }

  const roundSummarySelection = {
    contentId: round.contentId,
    roundId: round.roundId,
    state: round.state,
    voteCount: round.voteCount,
    revealedCount: round.revealedCount,
    totalStake: round.totalStake,
    upPool: round.upPool,
    downPool: round.downPool,
    upCount: round.upCount,
    downCount: round.downCount,
    referenceRatingBps: round.referenceRatingBps,
    ratingBps: round.ratingBps,
    conservativeRatingBps: round.conservativeRatingBps,
    confidenceMass: round.confidenceMass,
    effectiveEvidence: round.effectiveEvidence,
    upEvidence: round.upEvidence,
    downEvidence: round.downEvidence,
    settledRounds: round.settledRounds,
    lowSince: round.lowSince,
    startTime: round.startTime,
    epochDuration: round.epochDuration,
    maxDuration: round.maxDuration,
    minVoters: round.minVoters,
    maxVoters: round.maxVoters,
    hasHumanVerifiedCommit: round.hasHumanVerifiedCommit,
    lastCommitRevealableAfter: round.lastCommitRevealableAfter,
    revealGracePeriod: round.revealGracePeriod,
  };

  const openRounds = await db
    .select(roundSummarySelection)
    .from(round)
    .where(and(inArray(round.contentId, contentIds), eq(round.state, ROUND_STATE.Open)))
    .orderBy(desc(round.roundId));

  const latestRounds = await db
    .select(roundSummarySelection)
    .from(round)
    .where(inArray(round.contentId, contentIds))
    .orderBy(desc(round.roundId));

  const latestOpenRoundByContentId = new Map<bigint, (typeof openRounds)[number]>();
  for (const row of openRounds) {
    if (!latestOpenRoundByContentId.has(row.contentId)) {
      latestOpenRoundByContentId.set(row.contentId, row);
    }
  }

  const latestRoundByContentId = new Map<bigint, (typeof latestRounds)[number]>();
  for (const row of latestRounds) {
    if (!latestRoundByContentId.has(row.contentId)) {
      latestRoundByContentId.set(row.contentId, row);
    }
  }

  return items.map(item => {
    const openRound = latestOpenRoundByContentId.get(item.id);
    const latestRound = latestRoundByContentId.get(item.id);
    const rewardPoolSummary = rewardPoolSummaryByContentId.get(item.id) ?? emptyRewardPoolSummary();
    const feedbackBonusSummary = feedbackBonusSummaryByContentId.get(item.id) ?? emptyFeedbackBonusSummary();

    return {
      ...item,
      contentId: item.id,
      question: "title" in item ? item.title : undefined,
      link: "url" in item ? item.url || null : undefined,
      rewardPoolSummary,
      feedbackBonusSummary,
      openRound: openRound ? formatRoundSummary(openRound) : null,
      latestRound: latestRound ? formatRoundSummary(latestRound) : null,
    };
  });
}

function formatRoundSummary(row: {
  roundId: bigint;
  state: number;
  voteCount: number;
  revealedCount: number;
  totalStake: bigint;
  upPool: bigint;
  downPool: bigint;
  upCount: number;
  downCount: number;
  referenceRatingBps: number;
  ratingBps: number;
  conservativeRatingBps: number;
  confidenceMass: bigint;
  effectiveEvidence: bigint;
  upEvidence: bigint;
  downEvidence: bigint;
  settledRounds: number;
  lowSince: bigint;
  startTime: bigint | null;
  epochDuration: number;
  maxDuration: number;
  minVoters: number;
  maxVoters: number;
  hasHumanVerifiedCommit: boolean;
  lastCommitRevealableAfter: bigint | null;
  revealGracePeriod: bigint | null;
}) {
  return {
    roundId: row.roundId,
    state: row.state,
    voteCount: row.voteCount,
    revealedCount: row.revealedCount,
    totalStake: row.totalStake,
    upPool: row.upPool,
    downPool: row.downPool,
    upCount: row.upCount,
    downCount: row.downCount,
    referenceRatingBps: row.referenceRatingBps,
    ratingBps: row.ratingBps,
    conservativeRatingBps: row.conservativeRatingBps,
    confidenceMass: row.confidenceMass,
    effectiveEvidence: row.effectiveEvidence,
    upEvidence: row.upEvidence,
    downEvidence: row.downEvidence,
    settledRounds: row.settledRounds,
    lowSince: row.lowSince,
    startTime: row.startTime,
    epochDuration: row.epochDuration,
    maxDuration: row.maxDuration,
    minVoters: row.minVoters,
    maxVoters: row.maxVoters,
    hasHumanVerifiedCommit: row.hasHumanVerifiedCommit,
    lastCommitRevealableAfter: row.lastCommitRevealableAfter,
    revealGracePeriod: row.revealGracePeriod,
    estimatedSettlementTime:
      row.state === ROUND_STATE.Open ? getEstimatedSettlementTime(row.startTime, row.epochDuration) : null,
  };
}

function emptyRewardPoolSummary() {
  return {
    asset: null as number | null,
    currency: "USDC",
    displayCurrency: "USD",
    decimals: 6,
    rewardPoolCount: 0,
    bountyEligibility: 0 as number | null,
    bountyEligibilityDataHash: null as string | null,
    activeRewardPoolCount: 0,
    expiredRewardPoolCount: 0,
    openEndedRewardPoolCount: 0,
    fundedAsset: null as number | null,
    fundedCurrency: "USDC",
    fundedDisplayCurrency: "USD",
    totalFundedAmount: 0n,
    totalUnallocatedAmount: 0n,
    activeUnallocatedAmount: 0n,
    expiredUnallocatedAmount: 0n,
    totalAllocatedAmount: 0n,
    totalClaimedAmount: 0n,
    claimableAllocatedAmount: 0n,
    totalVoterClaimedAmount: 0n,
    totalFrontendClaimedAmount: 0n,
    totalRefundedAmount: 0n,
    qualifiedRoundCount: 0,
    currentRewardPoolAmount: 0n,
    hasActiveBounty: false,
    nextBountyStartBy: null as bigint | null,
    nextBountyClosesAt: null as bigint | null,
    lastBountyStartBy: null as bigint | null,
    lastBountyClosesAt: null as bigint | null,
    nextFeedbackClosesAt: null as bigint | null,
  };
}

function emptyFeedbackBonusSummary() {
  return {
    asset: null as number | null,
    currency: "USDC",
    displayCurrency: "USD",
    decimals: 6,
    poolCount: 0,
    activePoolCount: 0,
    expiredPoolCount: 0,
    totalFundedAmount: 0n,
    totalRemainingAmount: 0n,
    activeRemainingAmount: 0n,
    expiredRemainingAmount: 0n,
    totalAwardedAmount: 0n,
    totalVoterAwardedAmount: 0n,
    totalFrontendAwardedAmount: 0n,
    totalForfeitedAmount: 0n,
    awardCount: 0,
    hasActiveFeedbackBonus: false,
    nextFeedbackAwardDeadline: null as bigint | null,
    nextFeedbackClosesAt: null as bigint | null,
  };
}

function toBigIntValue(value: bigint | string | number | null | undefined) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) return BigInt(value);
  return 0n;
}

type FeedbackBonusSummaryRow = {
  asset: number | string | bigint | null;
  poolCount: number | string | bigint | null;
  activePoolCount: number | string | bigint | null;
  expiredPoolCount: number | string | bigint | null;
  totalFundedAmount: bigint | string | number | null;
  totalRemainingAmount: bigint | string | number | null;
  activeRemainingAmount: bigint | string | number | null;
  expiredRemainingAmount: bigint | string | number | null;
  totalAwardedAmount: bigint | string | number | null;
  totalVoterAwardedAmount: bigint | string | number | null;
  totalFrontendAwardedAmount: bigint | string | number | null;
  totalForfeitedAmount: bigint | string | number | null;
  awardCount: number | string | bigint | null;
  nextFeedbackAwardDeadline?: bigint | string | number | null;
  nextFeedbackClosesAt: bigint | string | number | null;
};

function feedbackCurrencyForAsset(asset: number | string | bigint | null | undefined) {
  return asset === 0 || asset === "0" || asset === 0n ? "LREP" : "USDC";
}

type FeedbackBonusCurrency = "LREP" | "USDC" | "MIXED";

function feedbackDisplayCurrency(currency: FeedbackBonusCurrency) {
  if (currency === "USDC") return "USD";
  return currency;
}

function minNullableTimestamp(left: bigint | null, right: bigint | string | number | null) {
  if (right === null) return left;
  const parsed = toBigIntValue(right);
  if (parsed <= 0n) return left;
  return left === null || parsed < left ? parsed : left;
}

function formatFeedbackBonusSummaryRows(rows: FeedbackBonusSummaryRow[]) {
  const assets = new Set(rows.map(row => toNumberValue(row.asset)));
  const currencies = new Set(rows.map(row => feedbackCurrencyForAsset(row.asset)));
  const currency: FeedbackBonusCurrency = currencies.size > 1 ? "MIXED" : (currencies.values().next().value ?? "USDC");
  const activePoolCount = rows.reduce((sum, row) => sum + toNumberValue(row.activePoolCount), 0);
  return {
    asset: assets.size === 1 ? (assets.values().next().value ?? null) : null,
    currency,
    displayCurrency: feedbackDisplayCurrency(currency),
    decimals: 6,
    poolCount: rows.reduce((sum, row) => sum + toNumberValue(row.poolCount), 0),
    activePoolCount,
    expiredPoolCount: rows.reduce((sum, row) => sum + toNumberValue(row.expiredPoolCount), 0),
    totalFundedAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalFundedAmount), 0n),
    totalRemainingAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalRemainingAmount), 0n),
    activeRemainingAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.activeRemainingAmount), 0n),
    expiredRemainingAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.expiredRemainingAmount), 0n),
    totalAwardedAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalAwardedAmount), 0n),
    totalVoterAwardedAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalVoterAwardedAmount), 0n),
    totalFrontendAwardedAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalFrontendAwardedAmount), 0n),
    totalForfeitedAmount: rows.reduce((sum, row) => sum + toBigIntValue(row.totalForfeitedAmount), 0n),
    awardCount: rows.reduce((sum, row) => sum + toNumberValue(row.awardCount), 0),
    hasActiveFeedbackBonus: activePoolCount > 0,
    nextFeedbackAwardDeadline: rows.reduce(
      (next, row) => minNullableTimestamp(next, row.nextFeedbackAwardDeadline ?? row.nextFeedbackClosesAt),
      null as bigint | null,
    ),
    nextFeedbackClosesAt: rows.reduce(
      (next, row) => minNullableTimestamp(next, row.nextFeedbackAwardDeadline ?? row.nextFeedbackClosesAt),
      null as bigint | null,
    ),
  };
}

function toNumberValue(value: number | string | bigint | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.length > 0) return Number(value);
  return 0;
}

function formatQuestionRewardAsset(value: number | string | bigint | null | undefined) {
  const asset = value === null || value === undefined ? null : toNumberValue(value);
  if (asset === 0) {
    return {
      asset,
      currency: "LREP",
      displayCurrency: "LREP",
    };
  }
  if (asset === 1) {
    return {
      asset,
      currency: "USDC",
      displayCurrency: "USD",
    };
  }

  return {
    asset: null as number | null,
    currency: "MIXED",
    displayCurrency: "MIXED",
  };
}

const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80;
const BOUNTY_ELIGIBILITY_CREDENTIALS = [
  { bit: 0x02, kind: 1, name: "selfie" },
  { bit: 0x04, kind: 2, name: "passport" },
  { bit: 0x08, kind: 3, name: "proof_of_human" },
] as const;
const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = BOUNTY_ELIGIBILITY_CREDENTIALS.reduce(
  (mask, credential) => mask | credential.bit,
  0,
);

function bountyEligibilityCredentialNames(mask: number) {
  return BOUNTY_ELIGIBILITY_CREDENTIALS.filter((credential) => (mask & credential.bit) !== 0).map(
    (credential) => credential.name,
  );
}

function bountyEligibilityLegacyKind(mask: number) {
  if (mask === 0) return 0;
  const credential = BOUNTY_ELIGIBILITY_CREDENTIALS.find((item) => item.bit === mask);
  return credential?.kind ?? null;
}

function bountyEligibilityKindName(mask: number) {
  if (mask === 0) return "everyone";
  const names = bountyEligibilityCredentialNames(mask);
  if (names.length === 0) return "unknown";
  return names.join("_or_");
}

function formatBountyEligibilityPolicy(
  eligibilityValue: number | string | bigint | null,
) {
  if (eligibilityValue === null) return null;
  const value = toNumberValue(eligibilityValue);
  const credentialMask = value & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
  return {
    value,
    kind: bountyEligibilityLegacyKind(credentialMask),
    kindName: bountyEligibilityKindName(credentialMask),
    credentialMask,
    credentialNames: bountyEligibilityCredentialNames(credentialMask),
    requiresRecentRecheck:
      (value & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) !== 0,
  };
}

function formatRewardPoolSummary(row: {
  asset: number | string | bigint | null;
  bountyEligibility: number | string | bigint | null;
  bountyEligibilityDataHash: string | null;
  rewardPoolCount: number | string | bigint | null;
  activeRewardPoolCount: number | string | bigint | null;
  expiredRewardPoolCount: number | string | bigint | null;
  openEndedRewardPoolCount: number | string | bigint | null;
  fundedAsset: number | string | bigint | null;
  totalFundedAmount: bigint | string | number | null;
  totalUnallocatedAmount: bigint | string | number | null;
  activeUnallocatedAmount: bigint | string | number | null;
  expiredUnallocatedAmount: bigint | string | number | null;
  totalAllocatedAmount: bigint | string | number | null;
  totalClaimedAmount: bigint | string | number | null;
  claimableAllocatedAmount: bigint | string | number | null;
  totalVoterClaimedAmount: bigint | string | number | null;
  totalFrontendClaimedAmount: bigint | string | number | null;
  totalRefundedAmount: bigint | string | number | null;
  qualifiedRoundCount: number | string | bigint | null;
  nextBountyStartBy: bigint | string | number | null;
  nextBountyClosesAt: bigint | string | number | null;
  lastBountyStartBy: bigint | string | number | null;
  lastBountyClosesAt: bigint | string | number | null;
  nextFeedbackClosesAt: bigint | string | number | null;
}) {
  const totalUnallocatedAmount = toBigIntValue(row.totalUnallocatedAmount);
  const totalAllocatedAmount = toBigIntValue(row.totalAllocatedAmount);
  const totalClaimedAmount = toBigIntValue(row.totalClaimedAmount);
  const activeRewardPoolCount = toNumberValue(row.activeRewardPoolCount);
  const activeUnallocatedAmount = toBigIntValue(row.activeUnallocatedAmount);
  const claimableAllocatedAmount = toBigIntValue(row.claimableAllocatedAmount);
  const rewardAsset = formatQuestionRewardAsset(row.asset);
  const fundedRewardAsset = formatQuestionRewardAsset(row.fundedAsset);

  return {
    ...rewardAsset,
    decimals: 6,
    rewardPoolCount: toNumberValue(row.rewardPoolCount),
    bountyEligibility: row.bountyEligibility === null ? null : toNumberValue(row.bountyEligibility),
    bountyEligibilityPolicy: formatBountyEligibilityPolicy(row.bountyEligibility),
    bountyEligibilityDataHash: row.bountyEligibilityDataHash,
    activeRewardPoolCount,
    expiredRewardPoolCount: toNumberValue(row.expiredRewardPoolCount),
    openEndedRewardPoolCount: toNumberValue(row.openEndedRewardPoolCount),
    fundedAsset: fundedRewardAsset.asset,
    fundedCurrency: fundedRewardAsset.currency,
    fundedDisplayCurrency: fundedRewardAsset.displayCurrency,
    totalFundedAmount: toBigIntValue(row.totalFundedAmount),
    totalUnallocatedAmount,
    activeUnallocatedAmount,
    expiredUnallocatedAmount: toBigIntValue(row.expiredUnallocatedAmount),
    totalAllocatedAmount,
    totalClaimedAmount,
    claimableAllocatedAmount,
    totalVoterClaimedAmount: toBigIntValue(row.totalVoterClaimedAmount),
    totalFrontendClaimedAmount: toBigIntValue(row.totalFrontendClaimedAmount),
    totalRefundedAmount: toBigIntValue(row.totalRefundedAmount),
    qualifiedRoundCount: toNumberValue(row.qualifiedRoundCount),
    currentRewardPoolAmount: activeUnallocatedAmount + claimableAllocatedAmount,
    hasActiveBounty: activeRewardPoolCount > 0,
    nextBountyStartBy: row.nextBountyStartBy === null ? null : toBigIntValue(row.nextBountyStartBy),
    nextBountyClosesAt: row.nextBountyClosesAt === null ? null : toBigIntValue(row.nextBountyClosesAt),
    lastBountyStartBy: row.lastBountyStartBy === null ? null : toBigIntValue(row.lastBountyStartBy),
    lastBountyClosesAt: row.lastBountyClosesAt === null ? null : toBigIntValue(row.lastBountyClosesAt),
    nextFeedbackClosesAt: row.nextFeedbackClosesAt === null ? null : toBigIntValue(row.nextFeedbackClosesAt),
  };
}
