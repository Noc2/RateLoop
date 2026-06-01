import assert from "node:assert/strict";
import test from "node:test";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { buildInterestProfile } from "~~/hooks/useInterestProfile";
import { buildFallbackMediaItems } from "~~/lib/contentMedia";
import { rankForYouFeed } from "~~/lib/vote/forYouRanker";

function makeContentItem(overrides: Partial<ContentItem> & Pick<ContentItem, "id" | "url" | "title">): ContentItem {
  return {
    id: overrides.id,
    url: overrides.url,
    media: overrides.media ?? buildFallbackMediaItems(overrides.url),
    title: overrides.title,
    description: overrides.description ?? "Example description",
    tags: overrides.tags ?? [],
    submitter: overrides.submitter ?? "0x0000000000000000000000000000000000000001",
    contentHash: overrides.contentHash ?? "0xhash",
    status: overrides.status ?? 0,
    isOwnContent: overrides.isOwnContent ?? false,
    categoryId: overrides.categoryId ?? 1n,
    rating: overrides.rating ?? 50,
    createdAt: overrides.createdAt ?? "1000",
    lastActivityAt: overrides.lastActivityAt ?? overrides.createdAt ?? "1000",
    totalVotes: overrides.totalVotes ?? 0,
    totalRounds: overrides.totalRounds ?? 0,
    openRound: overrides.openRound ?? null,
    latestRound: overrides.latestRound ?? null,
    isValidUrl: overrides.isValidUrl ?? true,
    thumbnailUrl: overrides.thumbnailUrl ?? null,
    contentMetadata: overrides.contentMetadata,
    rewardPoolSummary: overrides.rewardPoolSummary,
    feedbackBonusSummary: overrides.feedbackBonusSummary,
  };
}

function setStoredSignals(signals: unknown[]) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
  localStorage.setItem("rateloop_recommendation_signals", JSON.stringify(signals));
}

const localStorage = (() => {
  const storage = new Map<string, string>();
  return {
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
    clear() {
      storage.clear();
    },
  };
})();

test("voter-stage ranking favors content aligned with prior votes", () => {
  localStorage.clear();
  setStoredSignals([
    {
      contentId: "11",
      categoryId: "5",
      url: "https://www.youtube.com/watch?v=abc",
      platform: "youtube",
      submitter: "0xaaaa",
      tags: ["technology"],
      type: "vote_commit",
      timestamp: Date.now(),
    },
  ]);

  const profile = buildInterestProfile({ address: "0x123", feed: [], votes: [] });
  const items = [
    makeContentItem({
      id: 1n,
      url: "https://www.youtube.com/watch?v=1",
      title: "Tech video",
      categoryId: 5n,
      tags: ["technology"],
      totalVotes: 2,
      openRound: {
        roundId: 1n,
        voteCount: 1,
        revealedCount: 0,
        totalStake: 10n,
        upPool: 10n,
        downPool: 0n,
        startTime: 10_000n,
        estimatedSettlementTime: 12_000n,
      },
    }),
    makeContentItem({
      id: 2n,
      url: "https://example.com/history.jpg",
      title: "Unrelated article",
      categoryId: 1n,
      tags: ["history"],
      totalVotes: 6,
    }),
  ];

  const ranked = rankForYouFeed(items, {
    nowSeconds: 11_000,
    profile,
    votedContentIds: new Set(),
    watchedContentIds: new Set(),
    followedWallets: new Set(),
  });

  assert.equal(ranked[0]?.id, 1n);
});

test("anonymous cold start still surfaces active, voteable content", () => {
  localStorage.clear();
  setStoredSignals([]);

  const profile = buildInterestProfile({ feed: [], votes: [] });
  const items = [
    makeContentItem({
      id: 1n,
      url: "https://example.com/old",
      title: "Older static post",
      createdAt: "1000",
      lastActivityAt: "1000",
      totalVotes: 1,
    }),
    makeContentItem({
      id: 2n,
      url: "https://example.com/open",
      title: "Fresh open round",
      createdAt: "9800",
      lastActivityAt: "9900",
      totalVotes: 0,
      openRound: {
        roundId: 1n,
        voteCount: 0,
        revealedCount: 0,
        totalStake: 0n,
        upPool: 0n,
        downPool: 0n,
        startTime: 9800n,
        estimatedSettlementTime: 10_900n,
      },
    }),
  ];

  const ranked = rankForYouFeed(items, {
    nowSeconds: 10_000,
    profile,
    votedContentIds: new Set(),
    watchedContentIds: new Set(),
    followedWallets: new Set(),
  });

  assert.equal(ranked[0]?.id, 2n);
});

test("for-you ranking gives bounty-backed content a priority lift", () => {
  localStorage.clear();
  setStoredSignals([]);

  const profile = buildInterestProfile({ feed: [], votes: [] });
  const items = [
    makeContentItem({
      id: 1n,
      url: "https://example.com/unpaid",
      title: "Fresh unpaid",
      createdAt: "9900",
      lastActivityAt: "9900",
      totalVotes: 0,
    }),
    makeContentItem({
      id: 2n,
      url: "https://example.com/funded",
      title: "Funded",
      createdAt: "9800",
      lastActivityAt: "9800",
      totalVotes: 0,
      rewardPoolSummary: {
        totalFunded: 5_000_000n,
        totalAvailable: 5_000_000n,
        activeRewardPoolCount: 1,
        hasActiveBounty: true,
      },
    }),
  ];

  const ranked = rankForYouFeed(items, {
    nowSeconds: 10_000,
    profile,
    votedContentIds: new Set(),
    watchedContentIds: new Set(),
    followedWallets: new Set(),
  });

  assert.equal(ranked[0]?.id, 2n);
});

test("for-you ranking defers expired bounty content behind live content", () => {
  localStorage.clear();
  setStoredSignals([]);

  const profile = buildInterestProfile({ feed: [], votes: [] });
  const items = [
    makeContentItem({
      id: 1n,
      url: "https://example.com/expired",
      title: "Expired but active",
      createdAt: "9900",
      lastActivityAt: "9950",
      totalVotes: 40,
      totalRounds: 8,
      rewardPoolSummary: {
        totalFunded: 15_000_000n,
        totalAvailable: 0n,
        activeRewardPoolCount: 0,
        expiredRewardPoolCount: 1,
        hasActiveBounty: false,
      },
    }),
    makeContentItem({
      id: 2n,
      url: "https://example.com/live",
      title: "Live fallback",
      createdAt: "1000",
      lastActivityAt: "1000",
      totalVotes: 0,
      totalRounds: 0,
    }),
  ];

  const ranked = rankForYouFeed(items, {
    nowSeconds: 10_000,
    profile,
    votedContentIds: new Set(),
    watchedContentIds: new Set(),
    followedWallets: new Set(),
  });

  assert.deepEqual(
    ranked.map(item => item.id),
    [2n, 1n],
  );
});

test("already voted content is downranked in For You", () => {
  localStorage.clear();
  setStoredSignals([]);

  const profile = buildInterestProfile({ address: "0x123", feed: [], votes: [] });
  const items = [
    makeContentItem({
      id: 1n,
      url: "https://www.youtube.com/watch?v=1",
      title: "Already voted",
      categoryId: 5n,
      tags: ["technology"],
      openRound: {
        roundId: 1n,
        voteCount: 2,
        revealedCount: 0,
        totalStake: 10n,
        upPool: 10n,
        downPool: 0n,
        startTime: 10_000n,
        estimatedSettlementTime: 11_000n,
      },
    }),
    makeContentItem({
      id: 2n,
      url: "https://www.youtube.com/watch?v=2",
      title: "Still available",
      categoryId: 5n,
      tags: ["technology"],
      openRound: {
        roundId: 1n,
        voteCount: 1,
        revealedCount: 0,
        totalStake: 5n,
        upPool: 5n,
        downPool: 0n,
        startTime: 10_000n,
        estimatedSettlementTime: 11_500n,
      },
    }),
  ];

  const ranked = rankForYouFeed(items, {
    nowSeconds: 10_500,
    profile,
    votedContentIds: new Set(["1"]),
    watchedContentIds: new Set(),
    followedWallets: new Set(),
  });

  assert.equal(ranked[0]?.id, 2n);
});
