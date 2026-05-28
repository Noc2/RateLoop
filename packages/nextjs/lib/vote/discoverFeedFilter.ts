"use client";

import type { ContentItem } from "~~/hooks/useContentFeed";

export const DISCOVER_ALL_FILTER = "All";
export const DISCOVER_BROKEN_FILTER = "Broken";
export const DISCOVER_EXPIRED_BOUNTY_FILTER = "Expired";

function hasActiveBounty(item: ContentItem, nowSeconds: number) {
  const rewardSummary = item.rewardPoolSummary;
  if (
    rewardSummary &&
    rewardSummary.totalAvailable > 0n &&
    (rewardSummary.hasActiveBounty ||
      (rewardSummary.activeRewardPoolCount ?? 0) > 0 ||
      Boolean(rewardSummary.nextBountyClosesAt && rewardSummary.nextBountyClosesAt > BigInt(nowSeconds)))
  ) {
    return true;
  }

  const bundle = item.bundle;
  if (!bundle || bundle.failed || bundle.refunded) return false;
  if (bundle.completedRoundSetCount >= bundle.requiredSettledRounds) return false;

  const remainingAmount = bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount;
  if (remainingAmount <= 0n) return false;

  const bountyClosesAt = bundle.bountyClosesAt ?? 0n;
  return bountyClosesAt === 0n || bountyClosesAt > BigInt(nowSeconds);
}

export function getActiveBountyClosesAt(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rewardSummary = item.rewardPoolSummary;
  if (
    rewardSummary &&
    rewardSummary.totalAvailable > 0n &&
    rewardSummary.nextBountyClosesAt &&
    rewardSummary.nextBountyClosesAt > BigInt(nowSeconds)
  ) {
    return rewardSummary.nextBountyClosesAt;
  }

  const bundle = item.bundle;
  if (!bundle || bundle.failed || bundle.refunded) return null;
  if (bundle.completedRoundSetCount >= bundle.requiredSettledRounds) return null;

  const remainingAmount = bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount;
  if (remainingAmount <= 0n) return null;
  const bountyClosesAt = bundle.bountyClosesAt ?? 0n;
  if (bountyClosesAt <= 0n || bountyClosesAt <= BigInt(nowSeconds)) return null;

  return bountyClosesAt;
}

function isExpiredBountyItem(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rewardSummary = item.rewardPoolSummary;
  const hasExpiredRewardPool = Boolean(
    rewardSummary &&
      (rewardSummary.totalFunded > 0n || rewardSummary.totalAvailable > 0n) &&
      !hasActiveBounty(item, nowSeconds) &&
      ((rewardSummary.expiredRewardPoolCount ?? 0) > 0 || rewardSummary.totalAvailable <= 0n),
  );
  const bundle = item.bundle;
  const hasExpiredBundle = Boolean(
    bundle &&
      !bundle.failed &&
      !bundle.refunded &&
      bundle.completedRoundSetCount < bundle.requiredSettledRounds &&
      bundle.fundedAmount > 0n &&
      (bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount <= 0n ||
        ((bundle.bountyClosesAt ?? 0n) > 0n && (bundle.bountyClosesAt ?? 0n) <= BigInt(nowSeconds))),
  );

  return (hasExpiredRewardPool || hasExpiredBundle) && !hasActiveBounty(item, nowSeconds);
}

export function shouldShowBountyExpiredStatus(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (isExpiredBountyItem(item, nowSeconds)) return true;

  const bundle = item.bundle;
  return Boolean(
    bundle &&
      !bundle.failed &&
      !bundle.refunded &&
      bundle.completedRoundSetCount < bundle.requiredSettledRounds &&
      bundle.fundedAmount > 0n &&
      !hasActiveBounty(item, nowSeconds) &&
      (item.rewardPoolSummary?.totalAvailable ?? 0n) <= 0n,
  );
}

export function getActiveFeedbackClosesAt(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const feedbackSummary = item.feedbackBonusSummary;
  if (!feedbackSummary || feedbackSummary.totalRemaining <= 0n) return null;

  const closesAt = feedbackSummary.nextFeedbackClosesAt ?? 0n;
  if (closesAt <= 0n || closesAt <= BigInt(nowSeconds)) return null;

  return closesAt;
}

export function hasActiveFeedbackBonus(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const feedbackSummary = item.feedbackBonusSummary;
  if (!feedbackSummary || feedbackSummary.totalRemaining <= 0n) return false;

  const closesAt = feedbackSummary.nextFeedbackClosesAt ?? 0n;
  if (closesAt > 0n && closesAt <= BigInt(nowSeconds)) return false;

  return Boolean(
    feedbackSummary.hasActiveFeedbackBonus ||
      (feedbackSummary.activePoolCount ?? 0) > 0 ||
      (feedbackSummary.nextFeedbackClosesAt && feedbackSummary.nextFeedbackClosesAt > BigInt(nowSeconds)),
  );
}

export function shouldShowFeedbackClosedStatus(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const feedbackSummary = item.feedbackBonusSummary;
  if (!feedbackSummary) return false;

  const hasFeedbackPool =
    feedbackSummary.totalFunded > 0n ||
    feedbackSummary.totalRemaining > 0n ||
    (feedbackSummary.expiredPoolCount ?? 0) > 0;
  return hasFeedbackPool && !hasActiveFeedbackBonus(item, nowSeconds);
}

export function getVisibleRewardPoolAmount(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (shouldShowBountyExpiredStatus(item, nowSeconds) || shouldShowFeedbackClosedStatus(item, nowSeconds)) {
    return 0n;
  }

  return item.rewardPoolSummary?.totalAvailable ?? 0n;
}

export function getVisibleFeedbackBonusAmount(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  return hasActiveFeedbackBonus(item, nowSeconds) ? (item.feedbackBonusSummary?.totalRemaining ?? 0n) : 0n;
}

export function filterDiscoverCategoryItems(
  feed: ContentItem[],
  activeCategory: string,
  activeCategoryId?: bigint,
  nowSeconds = Math.floor(Date.now() / 1000),
): ContentItem[] {
  let items = [...feed];

  if (activeCategory === DISCOVER_BROKEN_FILTER) {
    items = items.filter(item => item.isValidUrl === false);
  } else if (activeCategory === DISCOVER_EXPIRED_BOUNTY_FILTER) {
    items = items.filter(item => item.isValidUrl !== false && isExpiredBountyItem(item, nowSeconds));
  } else {
    items = items.filter(item => item.isValidUrl !== false && !isExpiredBountyItem(item, nowSeconds));
  }

  if (
    activeCategory !== DISCOVER_ALL_FILTER &&
    activeCategory !== DISCOVER_BROKEN_FILTER &&
    activeCategory !== DISCOVER_EXPIRED_BOUNTY_FILTER &&
    activeCategoryId === undefined
  ) {
    items = items.filter(item => item.tags.includes(activeCategory));
  }

  return items;
}
