import React from "react";
import {
  type FeedCardMediaPlatformType,
  RewardLifecycleChip,
  getFeedMediaHeightClassName,
  getFeedRewardDeadlineChipSeconds,
  getRewardLifecycleChipClassName,
  resolveFeedCardVisualPlatformType,
  shouldFlushFeedMediaEdges,
  usesNaturalFeedMediaHeight,
} from "./VoteFeedCards";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { CONTENT_STATUS, type ContentItem } from "~~/hooks/contentFeed/shared";
import { buildFallbackMediaItems } from "~~/lib/contentMedia";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

const uploadedImageUrl =
  "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function buildItem(overrides: Partial<ContentItem> = {}): ContentItem {
  const url = overrides.url ?? "https://example.com/context";
  return {
    id: 1n,
    url,
    media: buildFallbackMediaItems(url),
    title: "Example question",
    description: "",
    tags: [],
    submitter: "0x0000000000000000000000000000000000000001",
    contentHash: "0xhash",
    status: CONTENT_STATUS.Active,
    isOwnContent: false,
    categoryId: 1n,
    rating: 50,
    ratingSettledRounds: 1,
    createdAt: "2026-06-23T00:00:00.000Z",
    lastActivityAt: "2026-06-23T00:00:00.000Z",
    totalVotes: 0,
    totalRounds: 0,
    openRound: null,
    latestRound: null,
    isValidUrl: true,
    thumbnailUrl: null,
    rewardPoolSummary: null,
    feedbackBonusSummary: null,
    ...overrides,
  };
}

function assertImageLayout(platformType: FeedCardMediaPlatformType) {
  assert.equal(platformType, "image");
  assert.equal(usesNaturalFeedMediaHeight(platformType), true);
  assert.equal(shouldFlushFeedMediaEdges(platformType), true);
  assert.equal(
    getFeedMediaHeightClassName({ isLaptopCompact: false, isMobileViewport: false, platformType }),
    "w-full",
  );
}

test("feed reward deadline chip is used for a single visible bounty deadline", () => {
  assert.equal(
    getFeedRewardDeadlineChipSeconds({
      rewardPoolTotal: 1_000_000n,
      rewardPoolDeadline: 37_000n,
      feedbackBonusTotal: 0n,
      feedbackBonusDeadline: null,
    }),
    37_000n,
  );
});

test("feed reward deadline chip is used for a single visible feedback bonus deadline", () => {
  assert.equal(
    getFeedRewardDeadlineChipSeconds({
      rewardPoolTotal: 0n,
      rewardPoolDeadline: null,
      feedbackBonusTotal: 1_000_000n,
      feedbackBonusDeadline: 37_000n,
    }),
    37_000n,
  );
});

test("feed reward deadline chip only merges bounty and feedback bonus when deadlines match", () => {
  assert.equal(
    getFeedRewardDeadlineChipSeconds({
      rewardPoolTotal: 1_000_000n,
      rewardPoolDeadline: 37_000n,
      feedbackBonusTotal: 1_000_000n,
      feedbackBonusDeadline: 37_000n,
    }),
    37_000n,
  );
  assert.equal(
    getFeedRewardDeadlineChipSeconds({
      rewardPoolTotal: 1_000_000n,
      rewardPoolDeadline: 37_000n,
      feedbackBonusTotal: 1_000_000n,
      feedbackBonusDeadline: 37_060n,
    }),
    null,
  );
});

test("reward lifecycle chip uses the existing reward chip design classes", () => {
  const html = renderToStaticMarkup(
    React.createElement(RewardLifecycleChip, {
      status: {
        ariaLabel: "Bounty payout pending",
        label: "Payout pending",
        tone: "yellow",
        tooltip: "Rewards are waiting on settlement, payout finality, or indexing.",
      },
    }),
  );

  assert.equal(getRewardLifecycleChipClassName("yellow"), "reward-chip-brand-yellow");
  assert.equal(getRewardLifecycleChipClassName("muted"), "reward-chip-muted");
  assert.match(html, /reward-chip reward-chip-label reward-chip-brand-yellow/);
  assert.match(html, /aria-label="Bounty payout pending"/);
  assert.match(html, />Payout pending<\/span>/);
});

test("feed card image layout uses natural height and flush media edges", () => {
  const item = buildItem({
    media: [
      {
        canonicalUrl: uploadedImageUrl,
        mediaIndex: 0,
        mediaType: "image",
        url: uploadedImageUrl,
        urlHost: null,
      },
    ],
    url: "",
  });

  assertImageLayout(resolveFeedCardVisualPlatformType(item));
});

test("resolved private images reuse the public image card layout", () => {
  const item = buildItem({
    confidentiality: { visibility: "gated" },
    contextAccess: "gated",
    contextVisibility: "gated",
    media: [],
    url: "",
  });

  assert.equal(resolveFeedCardVisualPlatformType(item), "text");
  assertImageLayout(resolveFeedCardVisualPlatformType(item, "image"));
});

test("details-only private context keeps the non-image media layout", () => {
  const item = buildItem({
    confidentiality: { visibility: "gated" },
    contextAccess: "gated",
    contextVisibility: "gated",
    detailsUrl: "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
    media: [],
    url: "",
  });
  const platformType = resolveFeedCardVisualPlatformType(item, "text");

  assert.equal(platformType, "text");
  assert.equal(usesNaturalFeedMediaHeight(platformType), false);
  assert.equal(shouldFlushFeedMediaEdges(platformType), false);
  assert.equal(
    getFeedMediaHeightClassName({ isLaptopCompact: false, isMobileViewport: true, platformType }),
    "w-full min-h-[14rem] max-h-[46svh] flex-1",
  );
});
