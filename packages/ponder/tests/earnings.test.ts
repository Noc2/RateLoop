import { afterEach, describe, expect, it, vi } from "vitest";

function serializeExpression(value: unknown) {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

interface RecordedQuery {
  selection: unknown;
  innerJoins: unknown[][];
  leftJoins: unknown[][];
  wheres: unknown[];
}

function mockEarningsModules(resultsByCall: unknown[][] = []) {
  const queries: RecordedQuery[] = [];

  const db = {
    select: vi.fn((selection: unknown) => {
      const recorded: RecordedQuery = {
        selection,
        innerJoins: [],
        leftJoins: [],
        wheres: [],
      };
      const callIndex = queries.length;
      queries.push(recorded);
      const result = resultsByCall[callIndex] ?? [];
      const builder: Record<string, unknown> = {};
      const chain = (recordInto?: (args: unknown[]) => void) =>
        vi.fn((...args: unknown[]) => {
          recordInto?.(args);
          return builder;
        });
      Object.assign(builder, {
        from: chain(),
        innerJoin: chain((args) => recorded.innerJoins.push(args)),
        leftJoin: chain((args) => recorded.leftJoins.push(args)),
        where: chain((args) => recorded.wheres.push(args[0])),
        groupBy: chain(),
        orderBy: chain(),
        limit: chain(),
        offset: chain(),
        then: (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(result).then(resolve, reject),
      });
      return builder;
    }),
  };

  vi.doMock("ponder:api", () => ({ db }));
  vi.doMock("ponder", () => ({
    and: (...args: unknown[]) => ({ kind: "and", args }),
    desc: (expr: unknown) => ({ kind: "desc", expr }),
    eq: (...args: unknown[]) => ({ kind: "eq", args }),
    gte: (...args: unknown[]) => ({ kind: "gte", args }),
    lt: (...args: unknown[]) => ({ kind: "lt", args }),
    or: (...args: unknown[]) => ({ kind: "or", args }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: [...strings],
      values,
    }),
  }));
  vi.doMock("ponder:schema", () => ({
    content: {
      canonicalUrl: "content.canonicalUrl",
      description: "content.description",
      id: "content.id",
      tags: "content.tags",
      title: "content.title",
      url: "content.url",
      urlHost: "content.urlHost",
    },
    feedbackBonusAward: {
      asset: "feedbackBonusAward.asset",
      awardedAt: "feedbackBonusAward.awardedAt",
      contentId: "feedbackBonusAward.contentId",
      feedbackHash: "feedbackBonusAward.feedbackHash",
      frontendFee: "feedbackBonusAward.frontendFee",
      grossAmount: "feedbackBonusAward.grossAmount",
      id: "feedbackBonusAward.id",
      poolId: "feedbackBonusAward.poolId",
      recipient: "feedbackBonusAward.recipient",
      recipientAmount: "feedbackBonusAward.recipientAmount",
      roundId: "feedbackBonusAward.roundId",
    },
    profile: { address: "profile.address", name: "profile.name" },
    questionBundleClaim: {
      amount: "questionBundleClaim.amount",
      bundleId: "questionBundleClaim.bundleId",
      claimant: "questionBundleClaim.claimant",
      claimedAt: "questionBundleClaim.claimedAt",
      frontendFee: "questionBundleClaim.frontendFee",
      grossAmount: "questionBundleClaim.grossAmount",
      id: "questionBundleClaim.id",
      roundSetIndex: "questionBundleClaim.roundSetIndex",
    },
    questionBundleReward: {
      asset: "questionBundleReward.asset",
      id: "questionBundleReward.id",
    },
    questionRewardPool: {
      asset: "questionRewardPool.asset",
      id: "questionRewardPool.id",
    },
    questionRewardPoolClaim: {
      amount: "questionRewardPoolClaim.amount",
      claimant: "questionRewardPoolClaim.claimant",
      claimedAt: "questionRewardPoolClaim.claimedAt",
      contentId: "questionRewardPoolClaim.contentId",
      frontendFee: "questionRewardPoolClaim.frontendFee",
      grossAmount: "questionRewardPoolClaim.grossAmount",
      id: "questionRewardPoolClaim.id",
      rewardPoolId: "questionRewardPoolClaim.rewardPoolId",
      roundId: "questionRewardPoolClaim.roundId",
    },
    rewardClaim: {
      claimedAt: "rewardClaim.claimedAt",
      contentId: "rewardClaim.contentId",
      id: "rewardClaim.id",
      lrepReward: "rewardClaim.lrepReward",
      roundId: "rewardClaim.roundId",
      source: "rewardClaim.source",
      voter: "rewardClaim.voter",
    },
  }));

  return { db, queries };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("ponder:api");
  vi.doUnmock("ponder");
  vi.doUnmock("ponder:schema");
});

const ADDRESS = "0x0000000000000000000000000000000000000001" as const;

describe("earnings source filters", () => {
  it("accepts the launch source and rejects unknown sources", async () => {
    mockEarningsModules();
    const { parseEarningsSourceFilter } = await import("../src/api/earnings.js");

    expect(parseEarningsSourceFilter("launch")).toBe("launch");
    expect(parseEarningsSourceFilter("round")).toBe("round");
    expect(parseEarningsSourceFilter(undefined)).toBe("all");
    expect(parseEarningsSourceFilter("epoch")).toBeNull();
  });
});

describe("getProfileEarningsSummary", () => {
  it("separates round and launch reward claims by rewardClaim.source", async () => {
    const { queries } = mockEarningsModules([
      [],
      [],
      [],
      [{ asset: 0, totalAmount: 9n, eventCount: 2, latestPaidAt: 50n }],
      [{ asset: 0, totalAmount: 4n, eventCount: 1, latestPaidAt: 75n }],
    ]);
    const { getProfileEarningsSummary } = await import("../src/api/earnings.js");

    const summary = await getProfileEarningsSummary(ADDRESS);

    // bounty x2, feedback, round, launch
    expect(queries).toHaveLength(5);
    const roundWhere = serializeExpression(queries[3]!.wheres);
    expect(roundWhere).toContain("rewardClaim.source");
    expect(roundWhere).toContain('"round"');
    const launchWhere = serializeExpression(queries[4]!.wheres);
    expect(launchWhere).toContain("rewardClaim.source");
    expect(launchWhere).toContain('"launch"');

    expect(summary.roundLrepEarned).toBe(9n);
    expect(summary.launchLrepEarned).toBe(4n);
    expect(summary.totalLrepEarned).toBe(13n);
    expect(summary.paidEventCount).toBe(3);
    expect(summary.latestPaidAt).toBe(75n);
  });

  it("only queries launch claims when the launch source is requested", async () => {
    const { queries } = mockEarningsModules();
    const { getProfileEarningsSummary } = await import("../src/api/earnings.js");

    await getProfileEarningsSummary(ADDRESS, { source: "launch" });

    expect(queries).toHaveLength(1);
    const where = serializeExpression(queries[0]!.wheres);
    expect(where).toContain("rewardClaim.source");
    expect(where).toContain('"launch"');
  });
});

describe("getRecentProfileEarnings", () => {
  it("applies moderation to content-backed earning titles", async () => {
    const { queries } = mockEarningsModules();
    const { getRecentProfileEarnings } = await import("../src/api/earnings.js");

    await getRecentProfileEarnings(ADDRESS, 20);

    const questionRewardWhere = serializeExpression(queries[0]!.wheres);
    expect(questionRewardWhere).toContain("questionRewardPoolClaim.claimant");
    expect(questionRewardWhere).toContain("content.title");
    expect(questionRewardWhere).toContain("content.description");
    expect(questionRewardWhere).toContain("content.urlHost");

    const bundleRewardWhere = serializeExpression(queries[1]!.wheres);
    expect(bundleRewardWhere).not.toContain("content.title");

    const feedbackBonusWhere = serializeExpression(queries[2]!.wheres);
    expect(feedbackBonusWhere).toContain("feedbackBonusAward.recipient");
    expect(feedbackBonusWhere).toContain("content.title");

    const roundRewardWhere = serializeExpression(queries[3]!.wheres);
    expect(roundRewardWhere).toContain("rewardClaim.voter");
    expect(roundRewardWhere).toContain("content.title");
  });

  it("left-joins content so launch rows without content still itemize", async () => {
    const { queries } = mockEarningsModules([
      [],
      [],
      [],
      [
        {
          id: "launch-1",
          source: "launch_reward",
          asset: 0,
          amount: 4n,
          grossAmount: 4n,
          frontendFee: 0n,
          contentId: null,
          roundId: null,
          rewardPoolId: null,
          bundleId: null,
          roundSetIndex: null,
          feedbackHash: null,
          title: null,
          paidAt: 75n,
        },
      ],
    ]);
    const { getRecentProfileEarnings } = await import("../src/api/earnings.js");

    const items = await getRecentProfileEarnings(ADDRESS, 20);

    const rewardClaimQuery = queries[3]!;
    // The rewardClaim list must not inner-join content: launch rows have contentId 0.
    expect(serializeExpression(rewardClaimQuery.leftJoins)).toContain(
      "content.id",
    );
    expect(serializeExpression(rewardClaimQuery.innerJoins)).not.toContain(
      "content.id",
    );
    const where = serializeExpression(rewardClaimQuery.wheres);
    expect(where).toContain("in ('round', 'launch')");

    expect(items).toEqual([
      expect.objectContaining({
        id: "launch-1",
        source: "launch_reward",
        currency: "LREP",
        amount: 4n,
      }),
    ]);
  });
});

describe("getEarningsLeaderboard", () => {
  it("splits round and launch contributions into separate buckets", async () => {
    const { queries } = mockEarningsModules([
      [],
      [],
      [],
      [
        {
          address: ADDRESS,
          profileName: null,
          asset: 0,
          totalAmount: 9n,
          eventCount: 2,
          latestPaidAt: 50n,
        },
      ],
      [
        {
          address: ADDRESS,
          profileName: null,
          asset: 0,
          totalAmount: 4n,
          eventCount: 1,
          latestPaidAt: 75n,
        },
      ],
    ]);
    const { getEarningsLeaderboard } = await import("../src/api/earnings.js");

    const items = await getEarningsLeaderboard({
      asset: "all",
      bounds: { startsAt: null, endsAt: null },
      limit: 10,
      offset: 0,
      source: "all",
    });

    expect(queries).toHaveLength(5);
    expect(items).toEqual([
      expect.objectContaining({
        voter: ADDRESS,
        roundLrepEarned: 9n,
        launchLrepEarned: 4n,
        totalLrepEarned: 13n,
        paidEventCount: 3,
      }),
    ]);
  });
});
