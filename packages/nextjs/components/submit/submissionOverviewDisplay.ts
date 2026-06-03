"use client";

import type { RewardPoolCurrency } from "~~/hooks/contentFeed/shared";
import type { ContentItem } from "~~/hooks/useContentFeed";
import {
  SUBMISSION_REWARD_ASSET_LREP,
  SUBMISSION_REWARD_ASSET_USDC,
  formatSubmissionRewardAmount,
  formatUsdAmount,
} from "~~/lib/questionRewardPools";

function formatTimestampSeconds(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return "-";
  if (value === 0n) return "Open-ended";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Number(value) * 1000));
}

function formatCompactAmount(value: bigint, currency?: RewardPoolCurrency): string {
  if (currency === "MIXED") return "Mixed";
  if (currency === "LREP") return formatSubmissionRewardAmount(value, "lrep");
  return formatUsdAmount(value);
}

function getBundleCurrency(asset: number | null | undefined): RewardPoolCurrency {
  if (asset === SUBMISSION_REWARD_ASSET_LREP) return "LREP";
  if (asset === SUBMISSION_REWARD_ASSET_USDC) return "USDC";
  return "MIXED";
}

function getBundleBountyAmount(item: ContentItem): bigint {
  const bundle = item.bundle;
  if (!bundle) return 0n;
  if (bundle.fundedAmount > 0n) return bundle.fundedAmount;
  return bundle.unallocatedAmount + bundle.allocatedAmount + bundle.claimedAmount;
}

export function getSubmissionBountyLabel(item: ContentItem): string {
  const summary = item.rewardPoolSummary;
  if (summary) {
    const amount = summary.totalFunded > 0n ? summary.totalFunded : summary.totalAvailable;
    if (amount > 0n) {
      return formatCompactAmount(amount, summary.fundedCurrency ?? summary.currency);
    }
  }

  const bundleAmount = getBundleBountyAmount(item);
  if (bundleAmount > 0n) {
    return formatCompactAmount(bundleAmount, getBundleCurrency(item.bundle?.asset));
  }

  return "-";
}

export function getSubmissionBountyDeadline(item: ContentItem): string {
  const summary = item.rewardPoolSummary;
  if (summary && (summary.totalFunded > 0n || summary.totalAvailable > 0n)) {
    const closesAt = summary.nextBountyClosesAt ?? summary.lastBountyClosesAt;
    if (closesAt && closesAt > 0n) return formatTimestampSeconds(closesAt);

    if ((summary.openEndedRewardPoolCount ?? 0) > 0) return "Open-ended";

    const startBy = summary.nextBountyStartBy ?? summary.lastBountyStartBy;
    if (startBy && startBy > 0n) return formatTimestampSeconds(startBy);
  }

  const bundle = item.bundle;
  if (bundle && getBundleBountyAmount(item) > 0n) {
    if (bundle.bountyClosesAt && bundle.bountyClosesAt > 0n) return formatTimestampSeconds(bundle.bountyClosesAt);
    if (bundle.bountyWindowSeconds === 0) return "Open-ended";

    const startBy = bundle.bountyStartBy && bundle.bountyStartBy > 0n ? bundle.bountyStartBy : bundle.expiresAt;
    if (startBy && startBy > 0n) return formatTimestampSeconds(startBy);
  }

  return "-";
}

export function getSubmissionFeedbackLabel(item: ContentItem): string {
  const summary = item.feedbackBonusSummary;
  if (!summary || !summary.hasActiveFeedbackBonus || summary.totalRemaining <= 0n) {
    return "-";
  }

  return formatCompactAmount(summary.totalRemaining, summary.currency);
}
