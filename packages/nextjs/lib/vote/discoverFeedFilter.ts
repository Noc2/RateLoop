"use client";

import { ROUND_STATE } from "@rateloop/contracts/protocol";
import type { ContentItem } from "~~/hooks/useContentFeed";
import type { ViewerRewardStatus } from "~~/hooks/useViewerRewardStatuses";

export const DISCOVER_ALL_FILTER = "All";
export const DISCOVER_BROKEN_FILTER = "Broken";
export const DISCOVER_EXPIRED_BOUNTY_FILTER = "Expired";

export type RewardLifecycleStatusTone = "blue" | "green" | "yellow" | "red" | "muted";

export interface RewardLifecycleStatus {
  label: string;
  ariaLabel: string;
  tooltip: string;
  tone: RewardLifecycleStatusTone;
}

function getRewardPoolOpportunityAmount(item: ContentItem) {
  return item.rewardPoolSummary?.activeUnallocated ?? item.rewardPoolSummary?.totalAvailable ?? 0n;
}

function hasActiveBounty(item: ContentItem, nowSeconds: number) {
  const rewardSummary = item.rewardPoolSummary;
  const now = BigInt(nowSeconds);
  if (rewardSummary && getRewardPoolOpportunityAmount(item) > 0n) {
    const closesAt = rewardSummary.nextBountyClosesAt ?? 0n;
    if (closesAt > 0n) return closesAt >= now;

    const startBy = rewardSummary.nextBountyStartBy ?? 0n;
    if (startBy > 0n) return startBy >= now;

    if (rewardSummary.hasActiveBounty || (rewardSummary.activeRewardPoolCount ?? 0) > 0) {
      return true;
    }
  }

  const bundle = item.bundle;
  if (!bundle || bundle.failed || bundle.refunded) return false;
  if (bundle.completedRoundSetCount >= bundle.requiredSettledRounds) return false;

  const remainingAmount = bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount;
  if (remainingAmount <= 0n) return false;

  const bountyClosesAt = bundle.bountyClosesAt ?? 0n;
  if (bountyClosesAt > 0n) return bountyClosesAt >= now;

  const bountyStartBy = bundle.bountyStartBy ?? bundle.expiresAt ?? 0n;
  if (bountyStartBy > 0n) return bountyStartBy >= now;

  return true;
}

export function getActiveBountyClosesAt(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rewardSummary = item.rewardPoolSummary;
  const now = BigInt(nowSeconds);
  if (
    rewardSummary &&
    getRewardPoolOpportunityAmount(item) > 0n &&
    rewardSummary.nextBountyClosesAt &&
    rewardSummary.nextBountyClosesAt >= now
  ) {
    return rewardSummary.nextBountyClosesAt;
  }

  const bundle = item.bundle;
  if (!bundle || bundle.failed || bundle.refunded) return null;
  if (bundle.completedRoundSetCount >= bundle.requiredSettledRounds) return null;

  const remainingAmount = bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount;
  if (remainingAmount <= 0n) return null;
  const bountyClosesAt = bundle.bountyClosesAt ?? 0n;
  if (bountyClosesAt <= 0n || bountyClosesAt < now) return null;

  return bountyClosesAt;
}

export function getPendingBountyStartBy(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const now = BigInt(nowSeconds);
  const rewardSummary = item.rewardPoolSummary;
  if (
    rewardSummary &&
    getRewardPoolOpportunityAmount(item) > 0n &&
    (!rewardSummary.nextBountyClosesAt || rewardSummary.nextBountyClosesAt <= 0n) &&
    rewardSummary.nextBountyStartBy &&
    rewardSummary.nextBountyStartBy >= now
  ) {
    return rewardSummary.nextBountyStartBy;
  }

  const bundle = item.bundle;
  if (!bundle || bundle.failed || bundle.refunded) return null;
  if (bundle.completedRoundSetCount >= bundle.requiredSettledRounds) return null;

  const remainingAmount = bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount;
  if (remainingAmount <= 0n) return null;
  if ((bundle.bountyClosesAt ?? 0n) > 0n) return null;

  const bountyStartBy = bundle.bountyStartBy ?? bundle.expiresAt ?? 0n;
  return bountyStartBy > 0n && bountyStartBy >= now ? bountyStartBy : null;
}

export function isExpiredBountyItem(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rewardSummary = item.rewardPoolSummary;
  const now = BigInt(nowSeconds);
  const missedRewardPoolStartBy = Boolean(
    rewardSummary &&
      (!rewardSummary.nextBountyClosesAt || rewardSummary.nextBountyClosesAt <= 0n) &&
      rewardSummary.nextBountyStartBy &&
      rewardSummary.nextBountyStartBy < now,
  );
  const hasExpiredRewardPool = Boolean(
    rewardSummary &&
      (rewardSummary.totalFunded > 0n || getRewardPoolOpportunityAmount(item) > 0n) &&
      !hasActiveBounty(item, nowSeconds) &&
      ((rewardSummary.expiredRewardPoolCount ?? 0) > 0 ||
        getRewardPoolOpportunityAmount(item) <= 0n ||
        missedRewardPoolStartBy),
  );
  const bundle = item.bundle;
  const hasExpiredBundle = Boolean(
    bundle &&
      !bundle.failed &&
      !bundle.refunded &&
      bundle.completedRoundSetCount < bundle.requiredSettledRounds &&
      bundle.fundedAmount > 0n &&
      (bundle.unallocatedAmount + bundle.allocatedAmount - bundle.claimedAmount <= 0n ||
        ((bundle.bountyClosesAt ?? 0n) > 0n && (bundle.bountyClosesAt ?? 0n) < now) ||
        ((bundle.bountyClosesAt ?? 0n) <= 0n &&
          (bundle.bountyStartBy ?? 0n) > 0n &&
          (bundle.bountyStartBy ?? 0n) < now)),
  );

  return (hasExpiredRewardPool || hasExpiredBundle) && !hasActiveBounty(item, nowSeconds);
}

export function compareExpiredBountyPriority(
  left: ContentItem,
  right: ContentItem,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const leftExpired = isExpiredBountyItem(left, nowSeconds);
  const rightExpired = isExpiredBountyItem(right, nowSeconds);
  if (leftExpired === rightExpired) return 0;
  return leftExpired ? 1 : -1;
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
      getRewardPoolOpportunityAmount(item) <= 0n,
  );
}

export function getActiveFeedbackClosesAt(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const feedbackSummary = item.feedbackBonusSummary;
  if (!feedbackSummary || feedbackSummary.totalRemaining <= 0n) return null;

  const closesAt = feedbackSummary.nextFeedbackClosesAt ?? 0n;
  // This is the rater-facing feedback eligibility close, not the later award deadline.
  if (closesAt <= 0n || closesAt < BigInt(nowSeconds)) return null;

  return closesAt;
}

export function hasActiveFeedbackBonus(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const feedbackSummary = item.feedbackBonusSummary;
  if (!feedbackSummary || feedbackSummary.totalRemaining <= 0n) return false;

  const closesAt = feedbackSummary.nextFeedbackClosesAt ?? 0n;
  // Inclusive boundary: still active at now == closesAt (see getActiveFeedbackClosesAt).
  if (closesAt <= 0n || closesAt < BigInt(nowSeconds)) return false;

  return Boolean(
    feedbackSummary.hasActiveFeedbackBonus ||
      (feedbackSummary.activePoolCount ?? 0) > 0 ||
      closesAt >= BigInt(nowSeconds),
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

  return getRewardPoolOpportunityAmount(item);
}

export function getVisibleFeedbackBonusAmount(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  return hasActiveFeedbackBonus(item, nowSeconds) ? (item.feedbackBonusSummary?.totalRemaining ?? 0n) : 0n;
}

export function getVisibleRewardOpportunityAmount(item: ContentItem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const rewardAmount = getVisibleRewardPoolAmount(item, nowSeconds);
  const feedbackAmount = getVisibleFeedbackBonusAmount(item, nowSeconds);
  if (rewardAmount <= 0n) return feedbackAmount;
  if (feedbackAmount <= 0n) return rewardAmount;
  if (item.rewardPoolSummary?.currency && item.rewardPoolSummary.currency === item.feedbackBonusSummary?.currency) {
    return rewardAmount + feedbackAmount;
  }
  return rewardAmount > feedbackAmount ? rewardAmount : feedbackAmount;
}

function hasFundedBounty(item: ContentItem) {
  const rewardSummary = item.rewardPoolSummary;
  const bundle = item.bundle;
  return Boolean(
    (rewardSummary &&
      (rewardSummary.totalFunded > 0n ||
        rewardSummary.totalAvailable > 0n ||
        (rewardSummary.totalClaimed ?? 0n) > 0n ||
        (rewardSummary.totalVoterClaimed ?? 0n) > 0n ||
        (rewardSummary.totalFrontendClaimed ?? 0n) > 0n ||
        (rewardSummary.expiredRewardPoolCount ?? 0) > 0 ||
        (rewardSummary.activeRewardPoolCount ?? 0) > 0)) ||
      (bundle && bundle.fundedAmount > 0n),
  );
}

function hasClaimableAllocatedBounty(item: ContentItem) {
  const rewardSummary = item.rewardPoolSummary;
  if (rewardSummary && (rewardSummary.claimableAllocated ?? 0n) > 0n) return true;

  const bundle = item.bundle;
  return Boolean(bundle && bundle.allocatedAmount > bundle.claimedAmount);
}

function hasResolvingBountyRound(item: ContentItem) {
  const latestRound = item.latestRound ?? item.openRound;
  if (!latestRound) return false;
  if (latestRound.state === ROUND_STATE.SettlementPending) return true;
  if (latestRound.state !== undefined && latestRound.state !== ROUND_STATE.Open) return false;
  return true;
}

export function getRewardLifecycleStatus(
  item: ContentItem,
  viewerRewardStatus?: ViewerRewardStatus | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): RewardLifecycleStatus | null {
  if (getVisibleRewardPoolAmount(item, nowSeconds) > 0n || getVisibleFeedbackBonusAmount(item, nowSeconds) > 0n) {
    return null;
  }

  if ((viewerRewardStatus?.claimableBountyCount ?? 0) > 0) {
    return {
      label: "Bounty claimable",
      ariaLabel: "Bounty claimable",
      tooltip: "This wallet has an eligible revealed vote with bounty rewards ready to claim.",
      tone: "green",
    };
  }

  if ((viewerRewardStatus?.awaitingBountyPayoutCount ?? 0) > 0) {
    return {
      label: "Finalizing payout",
      ariaLabel: "Bounty payout finalizing",
      tooltip: "This wallet's bounty allocation is waiting for finalized payout proof before it can be claimed.",
      tone: "yellow",
    };
  }

  if ((viewerRewardStatus?.awaitingBountyAllocationCount ?? 0) > 0) {
    return {
      label: "Calculating payout",
      ariaLabel: "Bounty payout calculating",
      tooltip: "This wallet has a revealed vote in a qualifying bounty round. The round payout still needs allocation.",
      tone: "yellow",
    };
  }

  if ((viewerRewardStatus?.pendingBountyCount ?? 0) > 0) {
    return {
      label: "Payout pending",
      ariaLabel: "Bounty payout pending",
      tooltip: "A bounty claim or payout from an earlier round is still pending for this wallet.",
      tone: "yellow",
    };
  }

  if (hasClaimableAllocatedBounty(item)) {
    return {
      label: "Payout ready",
      ariaLabel: "Bounty payout ready",
      tooltip: "Bounty rewards have been allocated. Eligible revealed voters can claim from the rewards panel.",
      tone: "green",
    };
  }

  if (hasFundedBounty(item) && hasResolvingBountyRound(item)) {
    return {
      label: "Payout pending",
      ariaLabel: "Bounty payout pending",
      tooltip:
        "Voting is closed for a funded bounty round. Rewards are waiting on settlement, payout finality, or indexing.",
      tone: "yellow",
    };
  }

  if (shouldShowBountyExpiredStatus(item, nowSeconds)) {
    return {
      label: "Bounty ended",
      ariaLabel: "Bounty ended",
      tooltip: "The bounty window has closed and there is no active bounty left on this question.",
      tone: "muted",
    };
  }

  if ((viewerRewardStatus?.pendingFeedbackBonusCount ?? 0) > 0) {
    return {
      label: "Bonus pending",
      ariaLabel: "Feedback Bonus pending",
      tooltip: "A Feedback Bonus review or payment from an earlier round is still pending for this wallet.",
      tone: "green",
    };
  }

  if (shouldShowFeedbackClosedStatus(item, nowSeconds)) {
    return {
      label: "Feedback closed",
      ariaLabel: "Feedback Bonus closed",
      tooltip: "The Feedback Bonus window has closed and there is no active Feedback Bonus left on this question.",
      tone: "muted",
    };
  }

  return {
    label: "No active bounty",
    ariaLabel: "No active bounty or Feedback Bonus",
    tooltip: "There is no active bounty or Feedback Bonus on this question.",
    tone: "red",
  };
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
    items = items.filter(item => item.isValidUrl !== false);
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
