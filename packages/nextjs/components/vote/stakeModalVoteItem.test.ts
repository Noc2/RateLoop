import { resolveStakeModalVoteItem } from "./stakeModalVoteItem";
import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_STATUS, type ContentItem } from "~~/hooks/contentFeed/shared";
import { buildFallbackMediaItems } from "~~/lib/contentMedia";

function buildItem(id: bigint, overrides: Partial<ContentItem> = {}): ContentItem {
  const url = `https://example.com/${id.toString()}`;
  return {
    id,
    url,
    media: buildFallbackMediaItems(url),
    title: `Question ${id.toString()}`,
    description: "",
    tags: [],
    submitter: "0x0000000000000000000000000000000000000001",
    contentHash: `hash-${id.toString()}`,
    status: CONTENT_STATUS.Active,
    isOwnContent: false,
    categoryId: 1n,
    rating: 50,
    ratingSettledRounds: 1,
    createdAt: "2026-03-31T00:00:00.000Z",
    lastActivityAt: "2026-03-31T00:00:00.000Z",
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

test("resolveStakeModalVoteItem prefers the live feed entry over the snapshot", () => {
  const liveItem = buildItem(7n, { title: "fresh" });
  const snapshot = buildItem(7n, { title: "stale" });

  assert.equal(resolveStakeModalVoteItem({ feed: [buildItem(1n), liveItem], contentId: 7n, snapshot }), liveItem);
});

test("resolveStakeModalVoteItem falls back to the snapshot when a refetch drops the item", () => {
  const snapshot = buildItem(7n);

  assert.equal(resolveStakeModalVoteItem({ feed: [buildItem(1n)], contentId: 7n, snapshot }), snapshot);
});

test("resolveStakeModalVoteItem ignores snapshots for a different content id", () => {
  const snapshot = buildItem(8n);

  assert.equal(resolveStakeModalVoteItem({ feed: [], contentId: 7n, snapshot }), null);
});

test("resolveStakeModalVoteItem returns null without a live item or snapshot", () => {
  assert.equal(resolveStakeModalVoteItem({ feed: [buildItem(1n)], contentId: 7n, snapshot: null }), null);
  assert.equal(resolveStakeModalVoteItem({ feed: [], contentId: 7n }), null);
});
