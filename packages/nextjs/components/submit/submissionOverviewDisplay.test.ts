import {
  getSubmissionBountyDeadline,
  getSubmissionBountyLabel,
  getSubmissionFeedbackLabel,
} from "./submissionOverviewDisplay";
import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_STATUS, type ContentItem } from "~~/hooks/contentFeed/shared";

function buildItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: 1n,
    url: "",
    media: [],
    title: "Would you use this?",
    description: "",
    tags: [],
    submitter: "0x0000000000000000000000000000000000000001",
    contentHash: "hash-1",
    status: CONTENT_STATUS.Active,
    isOwnContent: true,
    categoryId: 1n,
    rating: 50,
    ratingSettledRounds: 1,
    createdAt: null,
    lastActivityAt: null,
    totalVotes: 3,
    totalRounds: 1,
    bundle: null,
    openRound: null,
    latestRound: null,
    isValidUrl: true,
    thumbnailUrl: null,
    rewardPoolSummary: null,
    feedbackBonusSummary: null,
    ...overrides,
  };
}

function expectedDate(seconds: bigint): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(Number(seconds) * 1000));
}

test("submission bounty display uses historical funded amount and deadline after bounty expiry", () => {
  const closesAt = 1_780_000_000n;
  const item = buildItem({
    rewardPoolSummary: {
      currency: "MIXED",
      fundedCurrency: "USDC",
      totalFunded: 5_000_000n,
      totalAvailable: 0n,
      activeRewardPoolCount: 0,
      expiredRewardPoolCount: 1,
      openEndedRewardPoolCount: 0,
      hasActiveBounty: false,
      nextBountyClosesAt: null,
      lastBountyClosesAt: closesAt,
    },
  });

  assert.equal(getSubmissionBountyLabel(item), "$5");
  assert.equal(getSubmissionBountyDeadline(item), expectedDate(closesAt));
});

test("submission bounty deadline keeps open-ended pools open instead of showing start-by", () => {
  const item = buildItem({
    rewardPoolSummary: {
      currency: "USDC",
      fundedCurrency: "USDC",
      totalFunded: 3_000_000n,
      totalAvailable: 3_000_000n,
      activeRewardPoolCount: 1,
      openEndedRewardPoolCount: 1,
      hasActiveBounty: true,
      lastBountyStartBy: 1_780_000_000n,
    },
  });

  assert.equal(getSubmissionBountyLabel(item), "$3");
  assert.equal(getSubmissionBountyDeadline(item), "Open-ended");
});

test("submission bundle bounty display does not disappear after the bundle closes", () => {
  const closesAt = 1_780_100_000n;
  const item = buildItem({
    bundle: {
      id: 4n,
      asset: 0,
      questionCount: 2,
      requiredCompleters: 3,
      requiredSettledRounds: 1,
      completedRoundSetCount: 1,
      totalRecordedQuestionRounds: 2,
      claimedCount: 3,
      fundedAmount: 7_000_000n,
      unallocatedAmount: 0n,
      allocatedAmount: 0n,
      claimedAmount: 7_000_000n,
      refundedAmount: 0n,
      bountyStartBy: 1_779_000_000n,
      bountyOpensAt: 1_779_500_000n,
      bountyClosesAt: closesAt,
      feedbackClosesAt: closesAt,
      bountyWindowSeconds: 86_400,
      feedbackWindowSeconds: 86_400,
      expiresAt: closesAt,
      failed: false,
      refunded: false,
    },
  });

  assert.equal(getSubmissionBountyLabel(item), "7 LREP");
  assert.equal(getSubmissionBountyDeadline(item), expectedDate(closesAt));
});

test("submission feedback display still only shows active awardable bonuses", () => {
  const item = buildItem({
    feedbackBonusSummary: {
      currency: "USDC",
      totalFunded: 4_000_000n,
      totalRemaining: 4_000_000n,
      totalAwarded: 0n,
      activePoolCount: 1,
      awardCount: 0,
      hasActiveFeedbackBonus: true,
    },
  });

  assert.equal(getSubmissionFeedbackLabel(item), "$4");
  assert.equal(getSubmissionFeedbackLabel(buildItem()), "-");
});
