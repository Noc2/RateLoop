import { clampContentRating, formatRatingScoreOutOfTen } from "../ui/ratingDisplay";
import { RATE_ROUTE } from "~~/constants/routes";
import { detectPlatform, getThumbnailUrl } from "~~/utils/platforms";

export const VOTE_SHARE_RATING_VERSION_PARAM = "rv";

const VOTE_SHARE_CARD_VERSION = "og6";
const TITLE_MAX_LENGTH = 96;
const DESCRIPTION_MAX_LENGTH = 180;
const ALT_MAX_LENGTH = 180;
const ALLOWED_SHARE_IMAGE_HOSTS = new Set(["i.ytimg.com", "img.youtube.com"]);

export type ContentShareRatingSource = "content_rating_bps" | "content_rating";
export type ContentShareRewardCurrency = "LREP" | "USDC" | "MIXED";
export type ContentShareRewardDisplayCurrency = "LREP" | "USD" | "MIXED";

type ContentShareRewardAmountInput = bigint | number | string | null | undefined;

interface ContentShareRewardSummaryInput {
  asset?: ContentShareRewardAmountInput;
  currency?: string | null;
  displayCurrency?: string | null;
  decimals?: number | null;
}

interface ContentShareRewardPoolSummaryInput extends ContentShareRewardSummaryInput {
  activeUnallocated?: ContentShareRewardAmountInput;
  activeUnallocatedAmount?: ContentShareRewardAmountInput;
  currentRewardPoolAmount?: ContentShareRewardAmountInput;
  totalAvailable?: ContentShareRewardAmountInput;
}

interface ContentShareFeedbackBonusSummaryInput extends ContentShareRewardSummaryInput {
  activeRemainingAmount?: ContentShareRewardAmountInput;
  totalRemaining?: ContentShareRewardAmountInput;
  totalRemainingAmount?: ContentShareRewardAmountInput;
}

export interface ContentShareContentInput {
  id: string;
  chainId?: number | null;
  deploymentKey?: string | null;
  contentRegistryAddress?: string | null;
  contextAccess?: "public" | "gated" | string | null;
  contextVisibility?: "public" | "gated" | string | null;
  url?: string | null;
  title: string;
  description: string;
  rating?: number | null;
  ratingBps?: number;
  ratingSettledRounds?: number;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  contentMetadata?: {
    thumbnailUrl?: string | null;
    imageUrl?: string | null;
  } | null;
  totalVotes?: number;
  lastActivityAt?: string | null;
  openRound?: {
    voteCount?: number;
  } | null;
  rewardPoolSummary?: ContentShareRewardPoolSummaryInput | null;
  feedbackBonusSummary?: ContentShareFeedbackBonusSummaryInput | null;
}

export interface ContentShareRating {
  rating: number;
  ratingBps: number;
  label: string;
  source: ContentShareRatingSource;
}

export interface ContentShareReward {
  amount: string;
  amountLabel: string;
  currency: ContentShareRewardCurrency;
  displayCurrency: ContentShareRewardDisplayCurrency;
}

export interface ContentShareData {
  contentId: string;
  contentUrl: string;
  contentTitle: string;
  contentDescription: string;
  contentImageUrl: string | null;
  title: string;
  description: string;
  imageAlt: string;
  rating: ContentShareRating | null;
  ratingVersion: string;
  totalVotes: number;
  openRoundVoteCount: number;
  bountyReward: ContentShareReward | null;
  feedbackBonusReward: ContentShareReward | null;
  rewardSummary: string;
  shareUrl: string;
  imageUrl: string;
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function truncateText(value: string, maxLength: number): string {
  const normalized = normalizeSpace(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 3) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function normalizeFiniteInteger(value: number | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function normalizeNonNegativeBigInt(value: ContentShareRewardAmountInput): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;

  return BigInt(trimmed);
}

function firstDefinedBigInt(...values: ContentShareRewardAmountInput[]): bigint {
  for (const value of values) {
    const normalized = normalizeNonNegativeBigInt(value);
    if (normalized !== null) return normalized;
  }

  return 0n;
}

function normalizeRewardCurrency(
  currency: string | null | undefined,
  asset: ContentShareRewardAmountInput,
): ContentShareRewardCurrency {
  const normalizedCurrency = currency?.trim().toUpperCase();
  if (normalizedCurrency === "LREP" || normalizedCurrency === "USDC" || normalizedCurrency === "MIXED") {
    return normalizedCurrency;
  }

  const normalizedAsset = normalizeNonNegativeBigInt(asset);
  if (normalizedAsset === 0n) return "LREP";
  if (normalizedAsset === 1n) return "USDC";
  return "USDC";
}

function normalizeRewardDisplayCurrency(
  displayCurrency: string | null | undefined,
  currency: ContentShareRewardCurrency,
): ContentShareRewardDisplayCurrency {
  const normalizedDisplayCurrency = displayCurrency?.trim().toUpperCase();
  if (
    normalizedDisplayCurrency === "LREP" ||
    normalizedDisplayCurrency === "USD" ||
    normalizedDisplayCurrency === "MIXED"
  ) {
    return normalizedDisplayCurrency;
  }

  if (currency === "LREP") return "LREP";
  if (currency === "MIXED") return "MIXED";
  return "USD";
}

function normalizeRewardDecimals(value: number | null | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 18 ? value : 6;
}

function formatAtomicTokenAmount(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = scale > 0n ? value / scale : value;
  const fractional = scale > 0n ? value % scale : 0n;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractionalText = decimals > 0 ? fractional.toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return fractionalText ? `${groupedWhole}.${fractionalText}` : groupedWhole;
}

function formatUsdRewardAmount(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const rawCents = scale > 0n ? (value * 100n + scale / 2n) / scale : value * 100n;
  const wholeCents = rawCents / 100n;
  const cents = rawCents % 100n;
  const groupedWhole = wholeCents.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fractional = scale > 0n ? value % scale : 0n;
  return fractional > 0n ? `$${groupedWhole}.${cents.toString().padStart(2, "0")}` : `$${groupedWhole}`;
}

function formatContentShareRewardAmount(
  value: bigint,
  decimals: number,
  currency: ContentShareRewardCurrency,
  displayCurrency: ContentShareRewardDisplayCurrency,
): string {
  if (currency === "MIXED" || displayCurrency === "MIXED") return "Mixed";
  if (currency === "LREP" || displayCurrency === "LREP") return `${formatAtomicTokenAmount(value, decimals)} LREP`;
  return formatUsdRewardAmount(value, decimals);
}

function normalizeRatingBps(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(10_000, Math.max(0, Math.round(value)));
}

function normalizeActivitySeconds(value: string | null | undefined): number {
  const trimmed = value?.trim();
  if (!trimmed) return 0;

  if (/^\d+$/.test(trimmed)) {
    const timestamp = Number(trimmed);
    if (!Number.isFinite(timestamp) || timestamp < 0) return 0;

    return Math.floor(timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp);
  }

  const activityMs = Date.parse(trimmed);
  return Number.isFinite(activityMs) ? Math.floor(activityMs / 1000) : 0;
}

function normalizeHttpsImageUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || !ALLOWED_SHARE_IMAGE_HOSTS.has(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getPlatformShareImageUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;

  const platform = detectPlatform(trimmed);
  const thumbnailUrl = getThumbnailUrl(trimmed, platform.type === "youtube" ? "hqdefault" : undefined);
  return normalizeHttpsImageUrl(thumbnailUrl);
}

export function resolveContentShareImageUrl(content: ContentShareContentInput): string | null {
  const candidates = [
    content.imageUrl,
    content.thumbnailUrl,
    content.contentMetadata?.imageUrl,
    content.contentMetadata?.thumbnailUrl,
    getPlatformShareImageUrl(content.url),
  ];

  for (const candidate of candidates) {
    const imageUrl = normalizeHttpsImageUrl(candidate);
    if (imageUrl) return imageUrl;
  }

  return null;
}

export function normalizeContentShareContentId(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return null;

  const normalized = candidate.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const id = BigInt(normalized);
  return id > 0n ? id.toString() : null;
}

export function resolveContentShareRating(content: ContentShareContentInput): ContentShareRating | null {
  if (content.ratingSettledRounds !== undefined && content.ratingSettledRounds <= 0) {
    return null;
  }

  const contentRatingBps = normalizeRatingBps(content.ratingBps);
  const hasRawRating = typeof content.rating === "number" && Number.isFinite(content.rating);
  if (contentRatingBps === null && !hasRawRating) {
    return null;
  }

  const ratingBps = contentRatingBps ?? Math.round(clampContentRating(Number(content.rating)) * 100);
  const source: ContentShareRatingSource = contentRatingBps !== null ? "content_rating_bps" : "content_rating";
  const rating = ratingBps / 100;

  return {
    rating,
    ratingBps,
    label: formatRatingScoreOutOfTen(rating),
    source,
  };
}

function resolveContentShareBountyReward(content: ContentShareContentInput): ContentShareReward | null {
  const summary = content.rewardPoolSummary;
  if (!summary) return null;

  const amount = firstDefinedBigInt(
    summary.activeUnallocatedAmount,
    summary.activeUnallocated,
    summary.totalAvailable,
    summary.currentRewardPoolAmount,
  );
  if (amount <= 0n) return null;

  const decimals = normalizeRewardDecimals(summary.decimals);
  const currency = normalizeRewardCurrency(summary.currency, summary.asset);
  const displayCurrency = normalizeRewardDisplayCurrency(summary.displayCurrency, currency);

  return {
    amount: amount.toString(),
    amountLabel: formatContentShareRewardAmount(amount, decimals, currency, displayCurrency),
    currency,
    displayCurrency,
  };
}

function resolveContentShareFeedbackBonusReward(content: ContentShareContentInput): ContentShareReward | null {
  const summary = content.feedbackBonusSummary;
  if (!summary) return null;

  const amount = firstDefinedBigInt(
    summary.totalRemaining,
    summary.activeRemainingAmount,
    summary.totalRemainingAmount,
  );
  if (amount <= 0n) return null;

  const decimals = normalizeRewardDecimals(summary.decimals);
  const currency = normalizeRewardCurrency(summary.currency, summary.asset);
  const displayCurrency = normalizeRewardDisplayCurrency(summary.displayCurrency, currency);

  return {
    amount: amount.toString(),
    amountLabel: formatContentShareRewardAmount(amount, decimals, currency, displayCurrency),
    currency,
    displayCurrency,
  };
}

function buildRewardVersionPart(reward: ContentShareReward | null): string {
  return reward ? `${reward.currency.toLowerCase()}-${reward.amount}` : "none";
}

function buildRewardSummary(bountyReward: ContentShareReward | null, feedbackBonusReward: ContentShareReward | null) {
  if (bountyReward && feedbackBonusReward) {
    return `${bountyReward.amountLabel} in bounties and ${feedbackBonusReward.amountLabel} in Feedback Bonuses.`;
  }

  if (bountyReward) {
    return `Bounty: ${bountyReward.amountLabel} for eligible raters.`;
  }

  if (feedbackBonusReward) {
    return `Feedback Bonus: ${feedbackBonusReward.amountLabel} for useful rater feedback.`;
  }

  return "Bounties and Feedback Bonuses appear on RateLoop when available.";
}

function buildUnratedShareDescription(
  contentDescription: string,
  bountyReward: ContentShareReward | null,
  feedbackBonusReward: ContentShareReward | null,
): string {
  if (bountyReward && feedbackBonusReward) {
    return `Start rating and earn up to ${bountyReward.amountLabel} in bounties plus ${feedbackBonusReward.amountLabel} in Feedback Bonuses.`;
  }

  if (bountyReward) {
    return `Start rating and earn up to ${bountyReward.amountLabel} in bounties.`;
  }

  if (feedbackBonusReward) {
    return `Start rating and earn up to ${feedbackBonusReward.amountLabel} in Feedback Bonuses.`;
  }

  return contentDescription || "Stake LREP and rate this on RateLoop.";
}

export function buildContentShareRatingVersion(
  content: ContentShareContentInput,
  rating = resolveContentShareRating(content),
): string {
  const activitySeconds = normalizeActivitySeconds(content.lastActivityAt);
  const totalVotes = normalizeFiniteInteger(content.totalVotes);
  const openRoundVoteCount = normalizeFiniteInteger(content.openRound?.voteCount);
  const bountyReward = resolveContentShareBountyReward(content);
  const feedbackBonusReward = resolveContentShareFeedbackBonusReward(content);

  // Bump this renderer prefix when social-card visuals change and crawler caches need a fresh image URL.
  return `${VOTE_SHARE_CARD_VERSION}-r-${content.id}-${rating?.ratingBps ?? "na"}-${totalVotes}-${openRoundVoteCount}-${activitySeconds}-${buildRewardVersionPart(
    bountyReward,
  )}-${buildRewardVersionPart(feedbackBonusReward)}`;
}

function setContentShareScopeParams(url: URL, content: ContentShareContentInput) {
  if (typeof content.chainId === "number" && Number.isSafeInteger(content.chainId) && content.chainId > 0) {
    url.searchParams.set("chainId", String(content.chainId));
  }
}

function buildVoteShareUrl(origin: string, content: ContentShareContentInput, ratingVersion?: string): string {
  const url = new URL(RATE_ROUTE, `${origin.replace(/\/+$/, "")}/`);
  url.searchParams.set("content", content.id);
  setContentShareScopeParams(url, content);
  if (ratingVersion) {
    url.searchParams.set(VOTE_SHARE_RATING_VERSION_PARAM, ratingVersion);
  }
  return url.toString();
}

function buildVoteShareImageUrl(origin: string, content: ContentShareContentInput, ratingVersion: string): string {
  const url = new URL("/og/vote.png", `${origin.replace(/\/+$/, "")}/`);
  url.searchParams.set("content", content.id);
  setContentShareScopeParams(url, content);
  url.searchParams.set(VOTE_SHARE_RATING_VERSION_PARAM, ratingVersion);
  return url.toString();
}

export function buildContentShareData(content: ContentShareContentInput, origin: string): ContentShareData {
  const contentTitle = truncateText(content.title || `Content #${content.id}`, TITLE_MAX_LENGTH);
  const contentDescription = truncateText(content.description, DESCRIPTION_MAX_LENGTH);
  const contentUrl = content.url?.trim() ?? "";
  const contentImageUrl = resolveContentShareImageUrl(content);
  const rating = resolveContentShareRating(content);
  const ratingVersion = buildContentShareRatingVersion(content, rating);
  const totalVotes = normalizeFiniteInteger(content.totalVotes);
  const openRoundVoteCount = normalizeFiniteInteger(content.openRound?.voteCount);
  const bountyReward = resolveContentShareBountyReward(content);
  const feedbackBonusReward = resolveContentShareFeedbackBonusReward(content);
  const rewardSummary = buildRewardSummary(bountyReward, feedbackBonusReward);
  const voteLabel = `${totalVotes} vote${totalVotes === 1 ? "" : "s"}`;
  const title = truncateText(
    rating ? `Rated ${rating.label}/10 on RateLoop: ${contentTitle}` : `Rate this on RateLoop: ${contentTitle}`,
    TITLE_MAX_LENGTH,
  );
  const description = truncateText(
    rating
      ? `Current rating ${rating.label}/10 from ${voteLabel}. Disagree? Stake LREP and vote.`
      : buildUnratedShareDescription(contentDescription, bountyReward, feedbackBonusReward),
    DESCRIPTION_MAX_LENGTH,
  );
  const imageAlt = truncateText(
    rating
      ? `RateLoop social card for ${contentTitle}, showing a current rating of ${rating.label} out of 10.`
      : `RateLoop social card for ${contentTitle}, which has no community rating yet.`,
    ALT_MAX_LENGTH,
  );

  return {
    contentId: content.id,
    contentUrl,
    contentTitle,
    contentDescription,
    contentImageUrl,
    title,
    description,
    imageAlt,
    rating,
    ratingVersion,
    totalVotes,
    openRoundVoteCount,
    bountyReward,
    feedbackBonusReward,
    rewardSummary,
    shareUrl: buildVoteShareUrl(origin, content, ratingVersion),
    imageUrl: buildVoteShareImageUrl(origin, content, ratingVersion),
  };
}
