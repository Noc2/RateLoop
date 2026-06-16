"use client";

import type { ProfileSelfReportAudienceContext } from "@rateloop/node-utils/profileSelfReport";
import { parseTags } from "~~/constants/categories";
import { type ContentMediaItem, buildFallbackMediaItems } from "~~/lib/contentMedia";
import type { ContentMetadataResult } from "~~/lib/contentMetadata/types";
import { DEFAULT_VOTING_CONFIG, type VotingConfig } from "~~/lib/contracts/roundVotingEngine";
import { isContentItemBlocked } from "~~/utils/contentFilter";

export const MIN_CONTENT_SEARCH_QUERY_LENGTH = 3;
export const CONTENT_STATUS = {
  Active: 0,
  Dormant: 1,
  Cancelled: 2,
} as const;
export const RATING_REVIEW_STATUS_PENDING = 1;

export type ContentStatus = (typeof CONTENT_STATUS)[keyof typeof CONTENT_STATUS];

const LIKELY_URL_SEARCH_PATTERN = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:].*)?$/i;

export interface ContentOpenRoundSummary {
  roundId: bigint;
  state?: number;
  voteCount: number;
  revealedCount: number;
  totalStake: bigint;
  upPool: bigint;
  downPool: bigint;
  upCount?: number;
  downCount?: number;
  referenceRatingBps?: bigint;
  ratingBps?: bigint;
  conservativeRatingBps?: bigint;
  confidenceMass?: bigint;
  effectiveEvidence?: bigint;
  upEvidence?: bigint;
  downEvidence?: bigint;
  settledRounds?: number;
  lowSince?: bigint;
  startTime: bigint | null;
  epochDuration?: number;
  maxDuration?: number;
  minVoters?: number;
  maxVoters?: number;
  hasHumanVerifiedCommit?: boolean;
  humanVerifiedCommitCount?: number;
  humanVerifiedCommitQuorumMet?: boolean;
  lastCommitRevealableAfter?: bigint | null;
  revealGracePeriod?: bigint | null;
  estimatedSettlementTime: bigint | null;
}

export type RewardPoolCurrency = "LREP" | "USDC" | "MIXED";
export type RewardPoolDisplayCurrency = "LREP" | "USD" | "MIXED";

export interface ContentItem {
  id: bigint;
  url: string;
  media: ContentMediaItem[];
  contextAccess?: "public" | "gated" | string;
  contextVisibility?: "public" | "gated" | string;
  confidentiality?: {
    bondAmount?: string;
    bondAsset?: "LREP" | "USDC" | string;
    disclosurePolicy?: "after_settlement" | "private_forever" | string;
    publishedAt?: string | null;
    visibility?: "public" | "gated" | string;
    [key: string]: unknown;
  } | null;
  question?: string;
  title: string;
  description: string;
  tags: string[];
  submitter: string;
  contentHash: string;
  questionMetadataHash?: string | null;
  resultSpecHash?: string | null;
  audienceContext?: ProfileSelfReportAudienceContext | null;
  detailsUrl?: string | null;
  detailsHash?: string | null;
  status: ContentStatus;
  isOwnContent: boolean;
  categoryId: bigint;
  rating: number;
  ratingBps?: bigint;
  conservativeRatingBps?: bigint;
  ratingUpEvidence?: bigint;
  ratingDownEvidence?: bigint;
  ratingSettledRounds?: number;
  ratingReviewStatus?: number;
  ratingReviewRoundId?: bigint | null;
  ratingReviewUpdatedAt?: bigint | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  totalVotes: number;
  totalRounds: number;
  bundleId?: bigint | null;
  bundleIndex?: number | null;
  bundle?: {
    id: bigint;
    asset?: number | null;
    questionCount: number;
    requiredCompleters: number;
    requiredSettledRounds: number;
    completedRoundSetCount: number;
    totalRecordedQuestionRounds: number;
    claimedCount: number;
    fundedAmount: bigint;
    unallocatedAmount: bigint;
    allocatedAmount: bigint;
    claimedAmount: bigint;
    refundedAmount: bigint;
    bountyEligibility?: number | null;
    bountyEligibilityDataHash?: string | null;
    bountyStartBy?: bigint;
    bountyOpensAt?: bigint;
    bountyClosesAt?: bigint;
    feedbackClosesAt?: bigint;
    bountyWindowSeconds?: number;
    feedbackWindowSeconds?: number;
    expiresAt?: bigint;
    failed: boolean;
    refunded: boolean;
  } | null;
  roundConfig?: VotingConfig | null;
  openRound: ContentOpenRoundSummary | null;
  latestRound: ContentOpenRoundSummary | null;
  isValidUrl: boolean | null;
  thumbnailUrl: string | null;
  contentMetadata?: ContentMetadataResult;
  rewardPoolSummary?: {
    asset?: number | null;
    currency?: RewardPoolCurrency;
    displayCurrency?: RewardPoolDisplayCurrency;
    decimals?: number;
    totalFunded: bigint;
    totalAvailable: bigint;
    activeUnallocated?: bigint;
    claimableAllocated?: bigint;
    totalClaimed?: bigint;
    totalVoterClaimed?: bigint;
    totalFrontendClaimed?: bigint;
    activeRewardPoolCount: number;
    expiredRewardPoolCount?: number;
    openEndedRewardPoolCount?: number;
    fundedAsset?: number | null;
    fundedCurrency?: RewardPoolCurrency;
    fundedDisplayCurrency?: RewardPoolDisplayCurrency;
    bountyEligibility?: number | null;
    bountyEligibilityDataHash?: string | null;
    hasActiveBounty?: boolean;
    nextBountyStartBy?: bigint | null;
    nextBountyClosesAt?: bigint | null;
    lastBountyStartBy?: bigint | null;
    lastBountyClosesAt?: bigint | null;
    nextFeedbackClosesAt?: bigint | null;
  } | null;
  feedbackBonusSummary?: {
    asset?: number | null;
    currency?: RewardPoolCurrency;
    displayCurrency?: RewardPoolDisplayCurrency;
    decimals?: number;
    totalFunded: bigint;
    totalRemaining: bigint;
    totalAwarded: bigint;
    totalVoterAwarded?: bigint;
    totalFrontendAwarded?: bigint;
    totalForfeited?: bigint;
    activePoolCount: number;
    expiredPoolCount?: number;
    awardCount: number;
    hasActiveFeedbackBonus?: boolean;
    nextFeedbackAwardDeadline?: bigint | null;
    nextFeedbackClosesAt?: bigint | null;
  } | null;
}

export type FeedSort =
  | "newest"
  | "oldest"
  | "bounty_first"
  | "highest_rewards"
  | "highest_rated"
  | "lowest_rated"
  | "most_votes"
  | "relevance";

export interface UseContentFeedOptions {
  categoryId?: bigint;
  contentIds?: bigint[];
  enabled?: boolean;
  keepPrevious?: boolean;
  limit?: number;
  offset?: number;
  ownSubmitterAddresses?: string[];
  searchQuery?: string;
  sortBy?: FeedSort;
  submitter?: string;
  submitters?: string[];
  status?: "all" | ContentStatus;
  voteable?: boolean;
}

function buildNormalizedAddressSet(addresses: readonly string[] | undefined, fallbackAddress?: string): Set<string> {
  const values = new Set<string>();

  const addAddress = (address?: string) => {
    const trimmed = address?.trim();
    if (!trimmed) return;
    values.add(trimmed.toLowerCase());
  };

  addAddress(fallbackAddress);
  addresses?.forEach(addAddress);

  return values;
}

function numberOrDefault(value: string | number | null | undefined, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeContentStatus(value: string | number | null | undefined): ContentStatus {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : CONTENT_STATUS.Active;

  switch (parsed) {
    case CONTENT_STATUS.Dormant:
      return CONTENT_STATUS.Dormant;
    case CONTENT_STATUS.Cancelled:
      return CONTENT_STATUS.Cancelled;
    case CONTENT_STATUS.Active:
    default:
      return CONTENT_STATUS.Active;
  }
}

function normalizeRewardPoolCurrency(
  currency: string | null | undefined,
  asset: number | string | bigint | null | undefined,
): RewardPoolCurrency {
  const normalizedCurrency = currency?.toUpperCase();
  if (normalizedCurrency === "LREP" || normalizedCurrency === "USDC" || normalizedCurrency === "MIXED") {
    return normalizedCurrency;
  }
  if (normalizedCurrency === "LREP") return "LREP";

  if (asset === 0 || asset === "0" || asset === 0n) return "LREP";
  if (asset === 1 || asset === "1" || asset === 1n) return "USDC";

  return "USDC";
}

function normalizeRewardPoolDisplayCurrency(
  displayCurrency: string | null | undefined,
  currency: RewardPoolCurrency,
): RewardPoolDisplayCurrency {
  const normalizedDisplayCurrency = displayCurrency?.toUpperCase();
  if (
    normalizedDisplayCurrency === "LREP" ||
    normalizedDisplayCurrency === "USD" ||
    normalizedDisplayCurrency === "MIXED"
  ) {
    return normalizedDisplayCurrency;
  }
  if (normalizedDisplayCurrency === "LREP") return "LREP";

  if (currency === "LREP") return "LREP";
  if (currency === "MIXED") return "MIXED";
  return "USD";
}

function mapRoundSummary(
  round:
    | {
        roundId: string;
        state?: number;
        voteCount: number;
        revealedCount: number;
        totalStake: string;
        upPool: string;
        downPool: string;
        upCount?: number;
        downCount?: number;
        referenceRatingBps?: number;
        ratingBps?: number;
        conservativeRatingBps?: number;
        confidenceMass?: string;
        effectiveEvidence?: string;
        upEvidence?: string;
        downEvidence?: string;
        settledRounds?: number;
        lowSince?: string;
        startTime: string | null;
        epochDuration?: number;
        maxDuration?: number;
        minVoters?: number;
        maxVoters?: number;
        hasHumanVerifiedCommit?: boolean;
        humanVerifiedCommitCount?: number;
        humanVerifiedCommitQuorumMet?: boolean;
        lastCommitRevealableAfter?: string | null;
        revealGracePeriod?: string | null;
        estimatedSettlementTime: string | null;
      }
    | null
    | undefined,
  roundConfig: VotingConfig,
): ContentOpenRoundSummary | null {
  if (!round) return null;

  return {
    roundId: BigInt(round.roundId),
    state: round.state,
    voteCount: round.voteCount,
    revealedCount: round.revealedCount,
    totalStake: BigInt(round.totalStake),
    upPool: BigInt(round.upPool),
    downPool: BigInt(round.downPool),
    upCount: round.upCount,
    downCount: round.downCount,
    referenceRatingBps: round.referenceRatingBps !== undefined ? BigInt(round.referenceRatingBps) : undefined,
    ratingBps: round.ratingBps !== undefined ? BigInt(round.ratingBps) : undefined,
    conservativeRatingBps: round.conservativeRatingBps !== undefined ? BigInt(round.conservativeRatingBps) : undefined,
    confidenceMass: round.confidenceMass !== undefined ? BigInt(round.confidenceMass) : undefined,
    effectiveEvidence: round.effectiveEvidence !== undefined ? BigInt(round.effectiveEvidence) : undefined,
    upEvidence: round.upEvidence !== undefined ? BigInt(round.upEvidence) : undefined,
    downEvidence: round.downEvidence !== undefined ? BigInt(round.downEvidence) : undefined,
    settledRounds: round.settledRounds,
    lowSince: round.lowSince !== undefined ? BigInt(round.lowSince) : undefined,
    startTime: round.startTime ? BigInt(round.startTime) : null,
    epochDuration: numberOrDefault(round.epochDuration, roundConfig.epochDuration),
    maxDuration: numberOrDefault(round.maxDuration, roundConfig.maxDuration),
    minVoters: numberOrDefault(round.minVoters, roundConfig.minVoters),
    maxVoters: numberOrDefault(round.maxVoters, roundConfig.maxVoters),
    hasHumanVerifiedCommit: round.hasHumanVerifiedCommit,
    humanVerifiedCommitCount: round.humanVerifiedCommitCount,
    humanVerifiedCommitQuorumMet: round.humanVerifiedCommitQuorumMet,
    lastCommitRevealableAfter: round.lastCommitRevealableAfter ? BigInt(round.lastCommitRevealableAfter) : null,
    revealGracePeriod: round.revealGracePeriod ? BigInt(round.revealGracePeriod) : null,
    estimatedSettlementTime: round.estimatedSettlementTime ? BigInt(round.estimatedSettlementTime) : null,
  };
}

export function isContentItemActive(item: Pick<ContentItem, "status">): boolean {
  return item.status === CONTENT_STATUS.Active;
}

export function getInactiveContentVotingMessage(status?: ContentStatus): string {
  if (status === CONTENT_STATUS.Cancelled) {
    return "This content was cancelled and is no longer active for voting.";
  }
  if (status === CONTENT_STATUS.Dormant) {
    return "This content is dormant and is no longer active for voting.";
  }
  return "This content is no longer active for voting.";
}

export function mapContentItem(
  item: {
    id: string;
    url?: string | null;
    media?: Array<{
      index?: number;
      mediaIndex?: number;
      mediaType?: "image" | "video";
      url?: string | null;
      canonicalUrl?: string | null;
      urlHost?: string | null;
    }> | null;
    contextAccess?: "public" | "gated" | string;
    contextVisibility?: "public" | "gated" | string;
    confidentiality?: ContentItem["confidentiality"];
    question?: string | null;
    title: string;
    description: string;
    tags: string;
    submitter: string;
    contentHash: string;
    questionMetadataHash?: string | null;
    resultSpecHash?: string | null;
    detailsUrl?: string | null;
    detailsHash?: string | null;
    status?: string | number | null;
    categoryId: string;
    rating: number;
    ratingBps?: number;
    conservativeRatingBps?: number;
    ratingSettledRounds?: number;
    ratingReviewStatus?: string | number | null;
    ratingReviewRoundId?: string | number | bigint | null;
    ratingReviewUpdatedAt?: string | number | bigint | null;
    ratingUpEvidence?: string | number | bigint | null;
    ratingDownEvidence?: string | number | bigint | null;
    createdAt?: string | null;
    lastActivityAt?: string | null;
    totalVotes?: number;
    totalRounds?: number;
    bundleId?: string | number | null;
    bundleIndex?: number | null;
    bundle?: {
      id?: string | number | null;
      asset?: string | number | bigint | null;
      questionCount?: number | null;
      requiredCompleters?: number | null;
      requiredSettledRounds?: number | null;
      completedRoundSetCount?: number | null;
      totalRecordedQuestionRounds?: number | null;
      claimedCount?: number | null;
      fundedAmount?: string | number | bigint | null;
      unallocatedAmount?: string | number | bigint | null;
      allocatedAmount?: string | number | bigint | null;
      claimedAmount?: string | number | bigint | null;
      refundedAmount?: string | number | bigint | null;
      bountyEligibility?: string | number | bigint | null;
      bountyEligibilityDataHash?: string | null;
      bountyStartBy?: string | number | bigint | null;
      bountyOpensAt?: string | number | bigint | null;
      bountyClosesAt?: string | number | bigint | null;
      feedbackClosesAt?: string | number | bigint | null;
      bountyWindowSeconds?: string | number | null;
      feedbackWindowSeconds?: string | number | null;
      expiresAt?: string | number | bigint | null;
      failed?: boolean | null;
      refunded?: boolean | null;
    } | null;
    roundEpochDuration?: string | number | null;
    roundMaxDuration?: string | number | null;
    roundMinVoters?: string | number | null;
    roundMaxVoters?: string | number | null;
    openRound?: {
      roundId: string;
      state?: number;
      voteCount: number;
      revealedCount: number;
      totalStake: string;
      upPool: string;
      downPool: string;
      upCount?: number;
      downCount?: number;
      referenceRatingBps?: number;
      ratingBps?: number;
      conservativeRatingBps?: number;
      confidenceMass?: string;
      effectiveEvidence?: string;
      upEvidence?: string;
      downEvidence?: string;
      settledRounds?: number;
      lowSince?: string;
      startTime: string | null;
      epochDuration?: number;
      maxDuration?: number;
      minVoters?: number;
      maxVoters?: number;
      hasHumanVerifiedCommit?: boolean;
      humanVerifiedCommitCount?: number;
      humanVerifiedCommitQuorumMet?: boolean;
      lastCommitRevealableAfter?: string | null;
      revealGracePeriod?: string | null;
      estimatedSettlementTime: string | null;
    } | null;
    latestRound?: {
      roundId: string;
      state?: number;
      voteCount: number;
      revealedCount: number;
      totalStake: string;
      upPool: string;
      downPool: string;
      upCount?: number;
      downCount?: number;
      referenceRatingBps?: number;
      ratingBps?: number;
      conservativeRatingBps?: number;
      confidenceMass?: string;
      effectiveEvidence?: string;
      upEvidence?: string;
      downEvidence?: string;
      settledRounds?: number;
      lowSince?: string;
      startTime: string | null;
      epochDuration?: number;
      maxDuration?: number;
      minVoters?: number;
      maxVoters?: number;
      hasHumanVerifiedCommit?: boolean;
      humanVerifiedCommitCount?: number;
      humanVerifiedCommitQuorumMet?: boolean;
      lastCommitRevealableAfter?: string | null;
      revealGracePeriod?: string | null;
      estimatedSettlementTime: string | null;
    } | null;
    rewardPoolSummary?: {
      asset?: number | string | bigint | null;
      currency?: string | null;
      displayCurrency?: string | null;
      decimals?: number | null;
      totalFunded?: string | number | bigint | null;
      totalFundedAmount?: string | number | bigint | null;
      totalAvailable?: string | number | bigint | null;
      currentRewardPoolAmount?: string | number | bigint | null;
      activeUnallocatedAmount?: string | number | bigint | null;
      claimableAllocatedAmount?: string | number | bigint | null;
      totalClaimedAmount?: string | number | bigint | null;
      totalVoterClaimedAmount?: string | number | bigint | null;
      totalFrontendClaimedAmount?: string | number | bigint | null;
      activeRewardPoolCount?: number | null;
      expiredRewardPoolCount?: number | null;
      openEndedRewardPoolCount?: number | null;
      fundedAsset?: number | string | bigint | null;
      fundedCurrency?: string | null;
      fundedDisplayCurrency?: string | null;
      bountyEligibility?: string | number | bigint | null;
      bountyEligibilityDataHash?: string | null;
      hasActiveBounty?: boolean | null;
      nextBountyStartBy?: string | number | bigint | null;
      nextBountyClosesAt?: string | number | bigint | null;
      lastBountyStartBy?: string | number | bigint | null;
      lastBountyClosesAt?: string | number | bigint | null;
      nextFeedbackClosesAt?: string | number | bigint | null;
    } | null;
    feedbackBonusSummary?: {
      asset?: number | string | bigint | null;
      currency?: string | null;
      displayCurrency?: string | null;
      decimals?: number | null;
      totalFunded?: string | number | bigint | null;
      totalFundedAmount?: string | number | bigint | null;
      totalRemaining?: string | number | bigint | null;
      totalRemainingAmount?: string | number | bigint | null;
      activeRemainingAmount?: string | number | bigint | null;
      totalAwarded?: string | number | bigint | null;
      totalAwardedAmount?: string | number | bigint | null;
      totalVoterAwardedAmount?: string | number | bigint | null;
      totalFrontendAwardedAmount?: string | number | bigint | null;
      totalForfeitedAmount?: string | number | bigint | null;
      activePoolCount?: number | null;
      expiredPoolCount?: number | null;
      awardCount?: number | null;
      hasActiveFeedbackBonus?: boolean | null;
      nextFeedbackAwardDeadline?: string | number | bigint | null;
      nextFeedbackClosesAt?: string | number | bigint | null;
    } | null;
    audienceContext?: ProfileSelfReportAudienceContext | null;
  },
  voterAddress?: string,
  ownSubmitterAddresses?: readonly string[],
): ContentItem {
  const ownSubmitterAddressSet = buildNormalizedAddressSet(ownSubmitterAddresses, voterAddress);
  const roundConfig = {
    epochDuration: numberOrDefault(item.roundEpochDuration, DEFAULT_VOTING_CONFIG.epochDuration),
    maxDuration: numberOrDefault(item.roundMaxDuration, DEFAULT_VOTING_CONFIG.maxDuration),
    minVoters: numberOrDefault(item.roundMinVoters, DEFAULT_VOTING_CONFIG.minVoters),
    maxVoters: numberOrDefault(item.roundMaxVoters, DEFAULT_VOTING_CONFIG.maxVoters),
  };
  const mappedOpenRound = mapRoundSummary(item.openRound, roundConfig);
  const mappedLatestRound = mapRoundSummary(item.latestRound, roundConfig);
  const ratingBps = item.ratingBps !== undefined ? BigInt(item.ratingBps) : undefined;
  const conservativeRatingBps =
    item.conservativeRatingBps !== undefined ? BigInt(item.conservativeRatingBps) : undefined;
  const ratingUpEvidence =
    item.ratingUpEvidence !== undefined && item.ratingUpEvidence !== null ? BigInt(item.ratingUpEvidence) : undefined;
  const ratingDownEvidence =
    item.ratingDownEvidence !== undefined && item.ratingDownEvidence !== null
      ? BigInt(item.ratingDownEvidence)
      : undefined;
  const rewardPoolCurrency = item.rewardPoolSummary
    ? normalizeRewardPoolCurrency(item.rewardPoolSummary.currency, item.rewardPoolSummary.asset)
    : undefined;
  const rewardPoolDisplayCurrency =
    item.rewardPoolSummary && rewardPoolCurrency
      ? normalizeRewardPoolDisplayCurrency(item.rewardPoolSummary.displayCurrency, rewardPoolCurrency)
      : undefined;
  const fundedRewardPoolAsset = item.rewardPoolSummary?.fundedAsset ?? item.rewardPoolSummary?.asset;
  const fundedRewardPoolCurrency = item.rewardPoolSummary
    ? normalizeRewardPoolCurrency(
        item.rewardPoolSummary.fundedCurrency ?? item.rewardPoolSummary.currency,
        fundedRewardPoolAsset,
      )
    : undefined;
  const fundedRewardPoolDisplayCurrency =
    item.rewardPoolSummary && fundedRewardPoolCurrency
      ? normalizeRewardPoolDisplayCurrency(
          item.rewardPoolSummary.fundedDisplayCurrency ?? item.rewardPoolSummary.displayCurrency,
          fundedRewardPoolCurrency,
        )
      : undefined;
  const feedbackBonusCurrency = item.feedbackBonusSummary
    ? normalizeRewardPoolCurrency(item.feedbackBonusSummary.currency, item.feedbackBonusSummary.asset)
    : undefined;
  const feedbackBonusDisplayCurrency =
    item.feedbackBonusSummary && feedbackBonusCurrency
      ? normalizeRewardPoolDisplayCurrency(item.feedbackBonusSummary.displayCurrency, feedbackBonusCurrency)
      : undefined;
  const ratingSettledRounds = Math.max(0, item.ratingSettledRounds ?? mappedOpenRound?.settledRounds ?? 0);
  const displayedRating = item.rating;
  const url = item.url ?? "";
  const media = (item.media ?? [])
    .filter(mediaItem => mediaItem.url)
    .map((mediaItem, index) => ({
      mediaIndex: mediaItem.mediaIndex ?? mediaItem.index ?? index,
      mediaType: mediaItem.mediaType ?? "image",
      url: mediaItem.url ?? "",
      canonicalUrl: mediaItem.canonicalUrl ?? mediaItem.url ?? "",
      urlHost: mediaItem.urlHost ?? null,
    }));

  return {
    id: BigInt(item.id),
    url,
    media: media.length > 0 ? media : buildFallbackMediaItems(url),
    contextAccess: item.contextAccess ?? "public",
    contextVisibility: item.contextVisibility ?? item.contextAccess ?? "public",
    confidentiality: item.confidentiality ?? null,
    question: item.question?.trim() || item.title,
    title: item.title,
    description: item.description,
    tags: parseTags(item.tags),
    submitter: item.submitter,
    contentHash: item.contentHash,
    questionMetadataHash: item.questionMetadataHash ?? null,
    resultSpecHash: item.resultSpecHash ?? null,
    audienceContext: item.audienceContext ?? null,
    detailsUrl: item.detailsUrl ?? null,
    detailsHash: item.detailsHash ?? null,
    status: normalizeContentStatus(item.status),
    isOwnContent: ownSubmitterAddressSet.has(item.submitter.toLowerCase()),
    categoryId: BigInt(item.categoryId),
    rating: displayedRating,
    ratingBps,
    conservativeRatingBps,
    ratingUpEvidence,
    ratingDownEvidence,
    ratingSettledRounds,
    ratingReviewStatus:
      item.ratingReviewStatus === undefined || item.ratingReviewStatus === null
        ? undefined
        : Number(item.ratingReviewStatus),
    ratingReviewRoundId:
      item.ratingReviewRoundId === undefined || item.ratingReviewRoundId === null
        ? null
        : BigInt(item.ratingReviewRoundId),
    ratingReviewUpdatedAt:
      item.ratingReviewUpdatedAt === undefined || item.ratingReviewUpdatedAt === null
        ? null
        : BigInt(item.ratingReviewUpdatedAt),
    createdAt: item.createdAt ?? null,
    lastActivityAt: item.lastActivityAt ?? null,
    totalVotes: item.totalVotes ?? 0,
    totalRounds: item.totalRounds ?? 0,
    bundleId: item.bundleId !== undefined && item.bundleId !== null ? BigInt(item.bundleId) : null,
    bundleIndex: item.bundleIndex ?? null,
    bundle:
      item.bundle && item.bundle.id !== undefined && item.bundle.id !== null
        ? {
            id: BigInt(item.bundle.id),
            asset: item.bundle.asset === undefined || item.bundle.asset === null ? null : Number(item.bundle.asset),
            questionCount: item.bundle.questionCount ?? 0,
            requiredCompleters: item.bundle.requiredCompleters ?? 0,
            requiredSettledRounds: item.bundle.requiredSettledRounds ?? 1,
            completedRoundSetCount: item.bundle.completedRoundSetCount ?? 0,
            totalRecordedQuestionRounds: item.bundle.totalRecordedQuestionRounds ?? 0,
            claimedCount: item.bundle.claimedCount ?? 0,
            fundedAmount: BigInt(item.bundle.fundedAmount ?? 0),
            unallocatedAmount: BigInt(item.bundle.unallocatedAmount ?? 0),
            allocatedAmount: BigInt(item.bundle.allocatedAmount ?? 0),
            claimedAmount: BigInt(item.bundle.claimedAmount ?? 0),
            refundedAmount: BigInt(item.bundle.refundedAmount ?? 0),
            bountyEligibility:
              item.bundle.bountyEligibility === undefined || item.bundle.bountyEligibility === null
                ? null
                : Number(item.bundle.bountyEligibility),
            bountyEligibilityDataHash: item.bundle.bountyEligibilityDataHash ?? null,
            bountyStartBy: BigInt(item.bundle.bountyStartBy ?? 0),
            bountyOpensAt: BigInt(item.bundle.bountyOpensAt ?? 0),
            bountyClosesAt: BigInt(item.bundle.bountyClosesAt ?? 0),
            feedbackClosesAt: BigInt(item.bundle.feedbackClosesAt ?? 0),
            bountyWindowSeconds: numberOrDefault(item.bundle.bountyWindowSeconds, 0),
            feedbackWindowSeconds: numberOrDefault(item.bundle.feedbackWindowSeconds, 0),
            expiresAt: BigInt(item.bundle.expiresAt ?? 0),
            failed: item.bundle.failed ?? false,
            refunded: item.bundle.refunded ?? false,
          }
        : null,
    roundConfig,
    openRound: mappedOpenRound,
    latestRound: mappedLatestRound,
    isValidUrl: null,
    thumbnailUrl: null,
    rewardPoolSummary: item.rewardPoolSummary
      ? {
          asset:
            item.rewardPoolSummary.asset === undefined || item.rewardPoolSummary.asset === null
              ? null
              : Number(item.rewardPoolSummary.asset),
          currency: rewardPoolCurrency,
          displayCurrency: rewardPoolDisplayCurrency,
          decimals: item.rewardPoolSummary.decimals ?? 6,
          totalFunded: BigInt(item.rewardPoolSummary.totalFunded ?? item.rewardPoolSummary.totalFundedAmount ?? 0),
          totalAvailable: BigInt(
            item.rewardPoolSummary.totalAvailable ?? item.rewardPoolSummary.currentRewardPoolAmount ?? 0,
          ),
          activeUnallocated:
            item.rewardPoolSummary.activeUnallocatedAmount === undefined ||
            item.rewardPoolSummary.activeUnallocatedAmount === null
              ? undefined
              : BigInt(item.rewardPoolSummary.activeUnallocatedAmount),
          claimableAllocated:
            item.rewardPoolSummary.claimableAllocatedAmount === undefined ||
            item.rewardPoolSummary.claimableAllocatedAmount === null
              ? undefined
              : BigInt(item.rewardPoolSummary.claimableAllocatedAmount),
          totalClaimed: BigInt(item.rewardPoolSummary.totalClaimedAmount ?? 0),
          totalVoterClaimed: BigInt(item.rewardPoolSummary.totalVoterClaimedAmount ?? 0),
          totalFrontendClaimed: BigInt(item.rewardPoolSummary.totalFrontendClaimedAmount ?? 0),
          activeRewardPoolCount: item.rewardPoolSummary.activeRewardPoolCount ?? 0,
          expiredRewardPoolCount: item.rewardPoolSummary.expiredRewardPoolCount ?? 0,
          openEndedRewardPoolCount: item.rewardPoolSummary.openEndedRewardPoolCount ?? 0,
          fundedAsset:
            fundedRewardPoolAsset === undefined || fundedRewardPoolAsset === null
              ? null
              : Number(fundedRewardPoolAsset),
          fundedCurrency: fundedRewardPoolCurrency,
          fundedDisplayCurrency: fundedRewardPoolDisplayCurrency,
          bountyEligibility:
            item.rewardPoolSummary.bountyEligibility === undefined || item.rewardPoolSummary.bountyEligibility === null
              ? null
              : Number(item.rewardPoolSummary.bountyEligibility),
          bountyEligibilityDataHash: item.rewardPoolSummary.bountyEligibilityDataHash ?? null,
          hasActiveBounty:
            item.rewardPoolSummary.hasActiveBounty ?? (item.rewardPoolSummary.activeRewardPoolCount ?? 0) > 0,
          nextBountyStartBy:
            item.rewardPoolSummary.nextBountyStartBy === null || item.rewardPoolSummary.nextBountyStartBy === undefined
              ? null
              : BigInt(item.rewardPoolSummary.nextBountyStartBy),
          nextBountyClosesAt:
            item.rewardPoolSummary.nextBountyClosesAt === null ||
            item.rewardPoolSummary.nextBountyClosesAt === undefined
              ? null
              : BigInt(item.rewardPoolSummary.nextBountyClosesAt),
          lastBountyStartBy:
            item.rewardPoolSummary.lastBountyStartBy === null || item.rewardPoolSummary.lastBountyStartBy === undefined
              ? null
              : BigInt(item.rewardPoolSummary.lastBountyStartBy),
          lastBountyClosesAt:
            item.rewardPoolSummary.lastBountyClosesAt === null ||
            item.rewardPoolSummary.lastBountyClosesAt === undefined
              ? null
              : BigInt(item.rewardPoolSummary.lastBountyClosesAt),
          nextFeedbackClosesAt:
            item.rewardPoolSummary.nextFeedbackClosesAt === null ||
            item.rewardPoolSummary.nextFeedbackClosesAt === undefined
              ? null
              : BigInt(item.rewardPoolSummary.nextFeedbackClosesAt),
        }
      : null,
    feedbackBonusSummary: item.feedbackBonusSummary
      ? {
          asset:
            item.feedbackBonusSummary.asset === undefined || item.feedbackBonusSummary.asset === null
              ? null
              : Number(item.feedbackBonusSummary.asset),
          currency: feedbackBonusCurrency,
          displayCurrency: feedbackBonusDisplayCurrency,
          decimals: item.feedbackBonusSummary.decimals ?? 6,
          totalFunded: BigInt(
            item.feedbackBonusSummary.totalFunded ?? item.feedbackBonusSummary.totalFundedAmount ?? 0,
          ),
          totalRemaining: BigInt(
            item.feedbackBonusSummary.totalRemaining ??
              item.feedbackBonusSummary.activeRemainingAmount ??
              item.feedbackBonusSummary.totalRemainingAmount ??
              0,
          ),
          totalAwarded: BigInt(
            item.feedbackBonusSummary.totalAwarded ?? item.feedbackBonusSummary.totalAwardedAmount ?? 0,
          ),
          totalVoterAwarded: BigInt(item.feedbackBonusSummary.totalVoterAwardedAmount ?? 0),
          totalFrontendAwarded: BigInt(item.feedbackBonusSummary.totalFrontendAwardedAmount ?? 0),
          totalForfeited: BigInt(item.feedbackBonusSummary.totalForfeitedAmount ?? 0),
          activePoolCount: item.feedbackBonusSummary.activePoolCount ?? 0,
          expiredPoolCount: item.feedbackBonusSummary.expiredPoolCount ?? 0,
          awardCount: item.feedbackBonusSummary.awardCount ?? 0,
          hasActiveFeedbackBonus:
            item.feedbackBonusSummary.hasActiveFeedbackBonus ?? (item.feedbackBonusSummary.activePoolCount ?? 0) > 0,
          nextFeedbackAwardDeadline:
            item.feedbackBonusSummary.nextFeedbackAwardDeadline === null ||
            item.feedbackBonusSummary.nextFeedbackAwardDeadline === undefined
              ? item.feedbackBonusSummary.nextFeedbackClosesAt === null ||
                item.feedbackBonusSummary.nextFeedbackClosesAt === undefined
                ? null
                : BigInt(item.feedbackBonusSummary.nextFeedbackClosesAt)
              : BigInt(item.feedbackBonusSummary.nextFeedbackAwardDeadline),
          nextFeedbackClosesAt:
            item.feedbackBonusSummary.nextFeedbackAwardDeadline === null ||
            item.feedbackBonusSummary.nextFeedbackAwardDeadline === undefined
              ? item.feedbackBonusSummary.nextFeedbackClosesAt === null ||
                item.feedbackBonusSummary.nextFeedbackClosesAt === undefined
                ? null
                : BigInt(item.feedbackBonusSummary.nextFeedbackClosesAt)
              : BigInt(item.feedbackBonusSummary.nextFeedbackAwardDeadline),
        }
      : null,
  };
}

type VisibleContentRatingItem = Pick<ContentItem, "rating" | "ratingBps" | "ratingSettledRounds"> &
  Partial<Pick<ContentItem, "ratingReviewStatus" | "ratingReviewRoundId" | "latestRound">>;

function isPendingRatingReview(status: number | null | undefined) {
  return status === RATING_REVIEW_STATUS_PENDING;
}

function ratingFromBps(ratingBps: bigint | number | null | undefined): number | null {
  if (ratingBps === null || ratingBps === undefined) return null;
  return Number(ratingBps) / 100;
}

function getPendingReviewRating(item: VisibleContentRatingItem): number | null {
  if (!isPendingRatingReview(item.ratingReviewStatus)) return null;

  const latestRound = item.latestRound;
  if (!latestRound) return null;

  if (item.ratingReviewRoundId !== null && item.ratingReviewRoundId !== undefined) {
    if (latestRound.roundId !== item.ratingReviewRoundId) return null;
  }

  return ratingFromBps(latestRound.ratingBps ?? latestRound.referenceRatingBps);
}

export function getVisibleContentRating(item: VisibleContentRatingItem): number | null {
  const pendingReviewRating = getPendingReviewRating(item);
  if (pendingReviewRating !== null) return pendingReviewRating;

  if ((item.ratingSettledRounds ?? 0) <= 0) return null;
  return ratingFromBps(item.ratingBps) ?? item.rating;
}

export function mergeContentFeedMetadata(
  feed: ContentItem[],
  metadataMap: Record<string, ContentMetadataResult>,
  validationMap: Record<string, boolean | null>,
): ContentItem[] {
  return feed.map(item => {
    if (!item.url) {
      return item;
    }

    const contentMetadata = metadataMap[item.url] ?? item.contentMetadata;

    return {
      ...item,
      contentMetadata,
      isValidUrl: validationMap[item.url] ?? item.isValidUrl,
      thumbnailUrl: contentMetadata?.thumbnailUrl ?? item.thumbnailUrl,
    };
  });
}

export function filterModeratedContentItems(feed: ContentItem[]): ContentItem[] {
  return feed.filter(item => !isContentItemBlocked(item));
}

function getRewardPoolAmount(item: ContentItem) {
  const rewardAmount =
    item.rewardPoolSummary?.activeUnallocated ??
    item.rewardPoolSummary?.totalAvailable ??
    item.rewardPoolSummary?.totalFunded ??
    0n;
  const feedbackAmount = item.feedbackBonusSummary?.totalRemaining ?? 0n;
  if (rewardAmount <= 0n) return feedbackAmount;
  if (feedbackAmount <= 0n) return rewardAmount;
  if (item.rewardPoolSummary?.currency && item.rewardPoolSummary.currency === item.feedbackBonusSummary?.currency) {
    return rewardAmount + feedbackAmount;
  }
  return rewardAmount > feedbackAmount ? rewardAmount : feedbackAmount;
}

function getSearchTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/\s+/)
        .map(token => token.trim())
        .filter(Boolean),
    ),
  );
}

function getRpcRelevanceScore(item: ContentItem, normalizedQuery: string, queryTokens: string[]): number {
  const title = item.title.toLowerCase();
  const description = item.description.toLowerCase();
  const url = item.url.toLowerCase();
  const tags = item.tags.map(tag => tag.toLowerCase());

  let score = 0;

  if (url === normalizedQuery) {
    score += 220;
  } else if (url.includes(normalizedQuery)) {
    score += 100;
  }

  if (title === normalizedQuery) {
    score += 180;
  } else if (title.startsWith(normalizedQuery)) {
    score += 130;
  } else if (title.includes(normalizedQuery)) {
    score += 90;
  }

  if (tags.some(tag => tag === normalizedQuery)) {
    score += 120;
  } else if (tags.some(tag => tag.includes(normalizedQuery))) {
    score += 70;
  }

  if (description.includes(normalizedQuery)) {
    score += 45;
  }

  let matchedTokens = 0;
  for (const token of queryTokens) {
    let tokenMatched = false;

    if (title.includes(token)) {
      score += 24;
      tokenMatched = true;
    }

    if (tags.some(tag => tag === token)) {
      score += 20;
      tokenMatched = true;
    } else if (tags.some(tag => tag.includes(token))) {
      score += 12;
      tokenMatched = true;
    }

    if (url.includes(token)) {
      score += 14;
      tokenMatched = true;
    }

    if (description.includes(token)) {
      score += 7;
      tokenMatched = true;
    }

    if (tokenMatched) {
      matchedTokens += 1;
    }
  }

  if (queryTokens.length > 1) {
    score += matchedTokens * 6;
  }

  return score;
}

function getSortableRating(item: ContentItem): number {
  return getVisibleContentRating(item) ?? Number.NEGATIVE_INFINITY;
}

// Three-way comparator for bigint ids; safe past Number.MAX_SAFE_INTEGER.
const compareIdAsc = (a: ContentItem, b: ContentItem): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const compareIdDesc = (a: ContentItem, b: ContentItem): number => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export function sortRpcFeed(feed: ContentItem[], sortBy: FeedSort, searchQuery?: string): ContentItem[] {
  const items = [...feed];

  switch (sortBy) {
    case "oldest":
      items.sort((a, b) => compareIdAsc(a, b));
      break;
    case "relevance": {
      const normalizedQuery = searchQuery?.trim().toLowerCase();
      if (!normalizedQuery) {
        items.sort((a, b) => compareIdDesc(a, b));
        break;
      }

      const queryTokens = getSearchTokens(normalizedQuery);
      items.sort((a, b) => {
        const scoreDifference =
          getRpcRelevanceScore(b, normalizedQuery, queryTokens) - getRpcRelevanceScore(a, normalizedQuery, queryTokens);
        if (scoreDifference !== 0) {
          return scoreDifference;
        }

        const ratingDifference = getSortableRating(b) - getSortableRating(a);
        if (ratingDifference !== 0) {
          return ratingDifference;
        }

        return compareIdDesc(a, b);
      });
      break;
    }
    case "highest_rewards":
      items.sort((a, b) => {
        const aAmount = getRewardPoolAmount(a);
        const bAmount = getRewardPoolAmount(b);
        if (aAmount !== bAmount) {
          return aAmount > bAmount ? -1 : 1;
        }
        return compareIdDesc(a, b);
      });
      break;
    case "bounty_first":
      items.sort((a, b) => {
        const aAmount = getRewardPoolAmount(a);
        const bAmount = getRewardPoolAmount(b);
        const aHasReward = aAmount > 0n;
        const bHasReward = bAmount > 0n;
        if (aHasReward !== bHasReward) return aHasReward ? -1 : 1;
        if (aAmount !== bAmount) return aAmount > bAmount ? -1 : 1;
        return compareIdDesc(a, b);
      });
      break;
    case "newest":
      items.sort((a, b) => compareIdDesc(a, b));
      break;
    case "highest_rated":
      items.sort((a, b) => {
        const ratingDifference = getSortableRating(b) - getSortableRating(a);
        if (ratingDifference !== 0) return ratingDifference;
        return compareIdDesc(a, b);
      });
      break;
    case "lowest_rated":
      items.sort((a, b) => {
        const aRating = getSortableRating(a);
        const bRating = getSortableRating(b);
        const aUnrated = aRating === Number.NEGATIVE_INFINITY;
        const bUnrated = bRating === Number.NEGATIVE_INFINITY;
        if (aUnrated !== bUnrated) return aUnrated ? 1 : -1;
        const ratingDifference = aRating - bRating;
        if (ratingDifference !== 0) return ratingDifference;
        return compareIdDesc(a, b);
      });
      break;
    case "most_votes":
      items.sort((a, b) => {
        const voteDifference = b.totalVotes - a.totalVotes;
        if (voteDifference !== 0) return voteDifference;
        return compareIdDesc(a, b);
      });
      break;
    default:
      items.sort((a, b) => compareIdDesc(a, b));
      break;
  }

  return items;
}

function isLikelyUrlSearchQuery(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }

  return LIKELY_URL_SEARCH_PATTERN.test(trimmed);
}

export function isContentSearchQueryTooShort(value: string | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  return trimmed.length < MIN_CONTENT_SEARCH_QUERY_LENGTH && !isLikelyUrlSearchQuery(trimmed);
}

export function filterRpcFeed(feed: ContentItem[], options: UseContentFeedOptions): ContentItem[] {
  const { categoryId, contentIds, searchQuery, submitter, submitters, voteable } = options;
  if (isContentSearchQueryTooShort(searchQuery)) {
    return [];
  }

  const normalizedSearch = searchQuery?.trim().toLowerCase();
  const normalizedSubmitters = buildNormalizedAddressSet(submitters, submitter);
  const contentIdSet = contentIds ? new Set(contentIds.map(id => id.toString())) : null;

  return feed.filter(item => {
    if (voteable && !isContentItemActive(item)) {
      return false;
    }

    if (categoryId !== undefined && item.categoryId !== categoryId) {
      return false;
    }

    if (contentIdSet && !contentIdSet.has(item.id.toString())) {
      return false;
    }

    if (normalizedSubmitters.size > 0 && !normalizedSubmitters.has(item.submitter.toLowerCase())) {
      return false;
    }

    if (normalizedSearch) {
      const matchesSearch =
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.description.toLowerCase().includes(normalizedSearch) ||
        item.url.toLowerCase().includes(normalizedSearch) ||
        item.tags.some(tag => tag.toLowerCase().includes(normalizedSearch));
      if (!matchesSearch) {
        return false;
      }
    }

    return true;
  });
}
