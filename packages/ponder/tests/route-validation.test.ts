import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

function serializeExpression(value: unknown) {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

function createQueryBuilder<T>(result: T) {
  const builder = {
    from: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    having: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    then: (
      resolve: (value: T) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  return builder;
}

function mockPonderModules<T>(result: T) {
  const queryBuilder = createQueryBuilder(result);
  const db = {
    select: vi.fn(() => queryBuilder),
  };

  vi.doMock("ponder:api", () => ({ db }));
  vi.doMock("ponder", () => ({
    and: (...args: unknown[]) => ({ kind: "and", args }),
    asc: (expr: unknown) => ({ kind: "asc", expr }),
    desc: (expr: unknown) => ({ kind: "desc", expr }),
    eq: (...args: unknown[]) => ({ kind: "eq", args }),
    gte: (...args: unknown[]) => ({ kind: "gte", args }),
    inArray: (...args: unknown[]) => ({ kind: "inArray", args }),
    lt: (...args: unknown[]) => ({ kind: "lt", args }),
    notInArray: (...args: unknown[]) => ({ kind: "notInArray", args }),
    or: (...args: unknown[]) => ({ kind: "or", args }),
    replaceBigInts: (data: unknown, replacer: (value: bigint) => unknown) =>
      JSON.parse(
        JSON.stringify(data, (_key, value) =>
          typeof value === "bigint" ? replacer(value) : value,
        ),
      ),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      kind: "sql",
      strings: [...strings],
      values,
    }),
  }));
  vi.doMock("ponder:schema", () => ({
    advisoryVote: {
      committedAt: "advisoryVote.committedAt",
      creditedAt: "advisoryVote.creditedAt",
      launchCreditClaimed: "advisoryVote.launchCreditClaimed",
      paidAmount: "advisoryVote.paidAmount",
      revealed: "advisoryVote.revealed",
      voter: "advisoryVote.voter",
    },
    category: {
      id: "category.id",
      name: "category.name",
      slug: "category.slug",
      totalVotes: "category.totalVotes",
    },
    content: {
      canonicalUrl: "content.canonicalUrl",
      id: "content.id",
      bundleId: "content.bundleId",
      bundleIndex: "content.bundleIndex",
      categoryId: "content.categoryId",
      createdAt: "content.createdAt",
      description: "content.description",
      conservativeRatingBps: "content.conservativeRatingBps",
      ratingBps: "content.ratingBps",
      ratingConfidenceMass: "content.ratingConfidenceMass",
      rating: "content.rating",
      ratingEffectiveEvidence: "content.ratingEffectiveEvidence",
      ratingLowSince: "content.ratingLowSince",
      ratingSettledRounds: "content.ratingSettledRounds",
      status: "content.status",
      submitter: "content.submitter",
      tags: "content.tags",
      title: "content.title",
      totalVotes: "content.totalVotes",
      url: "content.url",
      urlHost: "content.urlHost",
    },
    contentMedia: {
      canonicalUrl: "contentMedia.canonicalUrl",
      contentId: "contentMedia.contentId",
      id: "contentMedia.id",
      mediaIndex: "contentMedia.mediaIndex",
      mediaType: "contentMedia.mediaType",
      url: "contentMedia.url",
      urlHost: "contentMedia.urlHost",
    },
    globalStats: {
      id: "globalStats.id",
    },
    launchRaterRewardProgress: {
      cohortIndex: "launchRaterRewardProgress.cohortIndex",
      distinctAnchorRoundCount:
        "launchRaterRewardProgress.distinctAnchorRoundCount",
      distinctVerifiedAnchorCount:
        "launchRaterRewardProgress.distinctVerifiedAnchorCount",
      eligibleAt: "launchRaterRewardProgress.eligibleAt",
      lastCommitKey: "launchRaterRewardProgress.lastCommitKey",
      lastQualifiedContentId:
        "launchRaterRewardProgress.lastQualifiedContentId",
      lastQualifiedRoundId: "launchRaterRewardProgress.lastQualifiedRoundId",
      lastScoreBps: "launchRaterRewardProgress.lastScoreBps",
      latestCreditedAt: "launchRaterRewardProgress.latestCreditedAt",
      latestPaidAt: "launchRaterRewardProgress.latestPaidAt",
      capBps: "launchRaterRewardProgress.capBps",
      capUnlockNullifierHash:
        "launchRaterRewardProgress.capUnlockNullifierHash",
      fullCapUnlocked: "launchRaterRewardProgress.fullCapUnlocked",
      fullLaunchCap: "launchRaterRewardProgress.fullLaunchCap",
      launchCap: "launchRaterRewardProgress.launchCap",
      launchPaid: "launchRaterRewardProgress.launchPaid",
      payoutEligible: "launchRaterRewardProgress.payoutEligible",
      qualifyingRatingCount: "launchRaterRewardProgress.qualifyingRatingCount",
      rater: "launchRaterRewardProgress.rater",
      rewardedRatingCount: "launchRaterRewardProgress.rewardedRatingCount",
      updatedAt: "launchRaterRewardProgress.updatedAt",
    },
    launchRewardPolicyState: {
      eligibilityRatingCount: "launchRewardPolicyState.eligibilityRatingCount",
      id: "launchRewardPolicyState.id",
      minDistinctAnchorRounds:
        "launchRewardPolicyState.minDistinctAnchorRounds",
      minDistinctVerifiedAnchors:
        "launchRewardPolicyState.minDistinctVerifiedAnchors",
      minQualifyingScoreBps: "launchRewardPolicyState.minQualifyingScoreBps",
      minVerifiedHumans: "launchRewardPolicyState.minVerifiedHumans",
      minVoters: "launchRewardPolicyState.minVoters",
      requireNoPendingCleanup:
        "launchRewardPolicyState.requireNoPendingCleanup",
      rewardingRatingCount: "launchRewardPolicyState.rewardingRatingCount",
      unverifiedEarnedRaterCapBps:
        "launchRewardPolicyState.unverifiedEarnedRaterCapBps",
      updatedAt: "launchRewardPolicyState.updatedAt",
    },
    raterFollow: {
      active: "raterFollow.active",
      createdAt: "raterFollow.createdAt",
      follower: "raterFollow.follower",
      id: "raterFollow.id",
      target: "raterFollow.target",
      unfollowedAt: "raterFollow.unfollowedAt",
      updatedAt: "raterFollow.updatedAt",
    },
    raterProfile: {
      address: "raterProfile.address",
      raterType: "raterProfile.raterType",
    },
    raterHumanCredential: {
      evidenceHash: "raterHumanCredential.evidenceHash",
      expiresAt: "raterHumanCredential.expiresAt",
      nullifierHash: "raterHumanCredential.nullifierHash",
      provider: "raterHumanCredential.provider",
      rater: "raterHumanCredential.rater",
      revoked: "raterHumanCredential.revoked",
      scope: "raterHumanCredential.scope",
      updatedAt: "raterHumanCredential.updatedAt",
      verified: "raterHumanCredential.verified",
      verifiedAt: "raterHumanCredential.verifiedAt",
    },
    profile: {
      address: "profile.address",
      createdAt: "profile.createdAt",
      name: "profile.name",
      selfReport: "profile.selfReport",
      totalContent: "profile.totalContent",
      totalRewardsClaimed: "profile.totalRewardsClaimed",
      totalVotes: "profile.totalVotes",
      updatedAt: "profile.updatedAt",
    },
    feedbackBonusAward: {
      frontendFee: "feedbackBonusAward.frontendFee",
      grossAmount: "feedbackBonusAward.grossAmount",
      recipientAmount: "feedbackBonusAward.recipientAmount",
    },
    feedbackBonusPool: {
      contentId: "feedbackBonusPool.contentId",
      forfeited: "feedbackBonusPool.forfeited",
      forfeitedAmount: "feedbackBonusPool.forfeitedAmount",
      fundedAmount: "feedbackBonusPool.fundedAmount",
      remainingAmount: "feedbackBonusPool.remainingAmount",
    },
    questionRewardPool: {
      asset: "questionRewardPool.asset",
      allocatedAmount: "questionRewardPool.allocatedAmount",
      claimedAmount: "questionRewardPool.claimedAmount",
      contentId: "questionRewardPool.contentId",
      createdAt: "questionRewardPool.createdAt",
      fundedAmount: "questionRewardPool.fundedAmount",
      id: "questionRewardPool.id",
      qualifiedRounds: "questionRewardPool.qualifiedRounds",
      refunded: "questionRewardPool.refunded",
      refundedAmount: "questionRewardPool.refundedAmount",
      requiredVoters: "questionRewardPool.requiredVoters",
      requiredSettledRounds: "questionRewardPool.requiredSettledRounds",
      startRoundId: "questionRewardPool.startRoundId",
      unallocatedAmount: "questionRewardPool.unallocatedAmount",
    },
    questionBundleClaim: {
      amount: "questionBundleClaim.amount",
      frontendFee: "questionBundleClaim.frontendFee",
      grossAmount: "questionBundleClaim.grossAmount",
      roundSetIndex: "questionBundleClaim.roundSetIndex",
    },
    questionBundleQuestion: {
      bundleId: "questionBundleQuestion.bundleId",
      bundleIndex: "questionBundleQuestion.bundleIndex",
      contentId: "questionBundleQuestion.contentId",
      id: "questionBundleQuestion.id",
      updatedAt: "questionBundleQuestion.updatedAt",
    },
    questionBundleRound: {
      bundleId: "questionBundleRound.bundleId",
      bundleIndex: "questionBundleRound.bundleIndex",
      contentId: "questionBundleRound.contentId",
      id: "questionBundleRound.id",
      roundId: "questionBundleRound.roundId",
      roundSetIndex: "questionBundleRound.roundSetIndex",
      settled: "questionBundleRound.settled",
      updatedAt: "questionBundleRound.updatedAt",
    },
    questionBundleRoundSet: {
      allocation: "questionBundleRoundSet.allocation",
      bundleId: "questionBundleRoundSet.bundleId",
      claimedAmount: "questionBundleRoundSet.claimedAmount",
      claimedCount: "questionBundleRoundSet.claimedCount",
      frontendFeeAllocation: "questionBundleRoundSet.frontendFeeAllocation",
      id: "questionBundleRoundSet.id",
      roundSetIndex: "questionBundleRoundSet.roundSetIndex",
      updatedAt: "questionBundleRoundSet.updatedAt",
    },
    questionBundleReward: {
      allocatedAmount: "questionBundleReward.allocatedAmount",
      asset: "questionBundleReward.asset",
      claimedAmount: "questionBundleReward.claimedAmount",
      claimedCount: "questionBundleReward.claimedCount",
      completedRoundSetCount: "questionBundleReward.completedRoundSetCount",
      createdAt: "questionBundleReward.createdAt",
      expiresAt: "questionBundleReward.expiresAt",
      failed: "questionBundleReward.failed",
      fundedAmount: "questionBundleReward.fundedAmount",
      id: "questionBundleReward.id",
      questionCount: "questionBundleReward.questionCount",
      refunded: "questionBundleReward.refunded",
      refundedAmount: "questionBundleReward.refundedAmount",
      requiredCompleters: "questionBundleReward.requiredCompleters",
      requiredSettledRounds: "questionBundleReward.requiredSettledRounds",
      totalRecordedQuestionRounds:
        "questionBundleReward.totalRecordedQuestionRounds",
      unallocatedAmount: "questionBundleReward.unallocatedAmount",
      updatedAt: "questionBundleReward.updatedAt",
    },
    questionRewardPoolClaim: {
      amount: "questionRewardPoolClaim.amount",
      frontendFee: "questionRewardPoolClaim.frontendFee",
      grossAmount: "questionRewardPoolClaim.grossAmount",
    },
    questionRewardPoolRound: {
      allocation: "questionRewardPoolRound.allocation",
      rewardPoolId: "questionRewardPoolRound.rewardPoolId",
      eligibleVoters: "questionRewardPoolRound.eligibleVoters",
      rawEligibleVoters: "questionRewardPoolRound.rawEligibleVoters",
      effectiveParticipantUnits:
        "questionRewardPoolRound.effectiveParticipantUnits",
      totalClaimWeight: "questionRewardPoolRound.totalClaimWeight",
      roundId: "questionRewardPoolRound.roundId",
    },
    ratingChange: {
      confidenceMass: "ratingChange.confidenceMass",
      conservativeRatingBps: "ratingChange.conservativeRatingBps",
      effectiveEvidence: "ratingChange.effectiveEvidence",
      lowSince: "ratingChange.lowSince",
      newRatingBps: "ratingChange.newRatingBps",
      oldRatingBps: "ratingChange.oldRatingBps",
      referenceRatingBps: "ratingChange.referenceRatingBps",
      roundId: "ratingChange.roundId",
      settledRounds: "ratingChange.settledRounds",
      timestamp: "ratingChange.timestamp",
    },
    rewardClaim: {
      claimedAt: "rewardClaim.claimedAt",
      hrepReward: "rewardClaim.hrepReward",
      stakePayer: "rewardClaim.stakePayer",
      stakeReturned: "rewardClaim.stakeReturned",
      voter: "rewardClaim.voter",
    },
    round: {
      confidenceMass: "round.confidenceMass",
      contentId: "round.contentId",
      downPool: "round.downPool",
      conservativeRatingBps: "round.conservativeRatingBps",
      effectiveEvidence: "round.effectiveEvidence",
      lowSince: "round.lowSince",
      revealedCount: "round.revealedCount",
      roundId: "round.roundId",
      ratingBps: "round.ratingBps",
      referenceRatingBps: "round.referenceRatingBps",
      settledAt: "round.settledAt",
      settledRounds: "round.settledRounds",
      startTime: "round.startTime",
      state: "round.state",
      totalStake: "round.totalStake",
      upPool: "round.upPool",
      upWins: "round.upWins",
      voteCount: "round.voteCount",
    },
    tokenHolder: {
      address: "tokenHolder.address",
      firstSeenAt: "tokenHolder.firstSeenAt",
    },
    vote: {
      committedAt: "vote.committedAt",
      contentId: "vote.contentId",
      identityHolder: "vote.identityHolder",
      identityKey: "vote.identityKey",
      identityVoter: "vote.identityVoter",
      isUp: "vote.isUp",
      revealed: "vote.revealed",
      roundId: "vote.roundId",
      stake: "vote.stake",
      rbtsForfeitedStake: "vote.rbtsForfeitedStake",
      rbtsRewardWeight: "vote.rbtsRewardWeight",
      rbtsScoreBps: "vote.rbtsScoreBps",
      rbtsStakeReturned: "vote.rbtsStakeReturned",
      voter: "vote.voter",
    },
    voterCategoryStats: {
      categoryId: "voterCategoryStats.categoryId",
      totalLosses: "voterCategoryStats.totalLosses",
      totalSettledVotes: "voterCategoryStats.totalSettledVotes",
      totalStakeLost: "voterCategoryStats.totalStakeLost",
      totalStakeWon: "voterCategoryStats.totalStakeWon",
      totalWins: "voterCategoryStats.totalWins",
      voter: "voterCategoryStats.voter",
    },
    voterStats: {
      bestWinStreak: "voterStats.bestWinStreak",
      currentStreak: "voterStats.currentStreak",
      totalLosses: "voterStats.totalLosses",
      totalSettledVotes: "voterStats.totalSettledVotes",
      totalStakeLost: "voterStats.totalStakeLost",
      totalStakeWon: "voterStats.totalStakeWon",
      totalWins: "voterStats.totalWins",
      voter: "voterStats.voter",
    },
  }));
  vi.doMock("../src/api/follow-utils.js", () => ({
    getFollowStatsMap: vi.fn(async (addresses: readonly `0x${string}`[]) => {
      return new Map(
        addresses.map((address) => [
          address,
          { followerCount: 3, followingCount: 2 },
        ]),
      );
    }),
    listActiveFollowedAddresses: vi.fn(async () => [
      "0x0000000000000000000000000000000000000002",
    ]),
  }));

  return { db, queryBuilder };
}

afterEach(() => {
  vi.unmock("../src/api/shared.js");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function mockSharedModule() {
  vi.doMock("../src/api/shared.js", async () => {
    const actual = await vi.importActual<any>("../src/api/shared.js");
    return {
      ...actual,
      attachOpenRoundSummary: vi.fn(async (items: unknown[]) => items),
    };
  });
}

describe("registerContentRoutes", () => {
  it("rejects invalid content status filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?status=foo");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid status filter" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns empty results for short generic searches without querying the database", async () => {
    const { db } = mockPonderModules([]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?search=ai");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      hasMore: false,
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects invalid multi-submitter filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?submitters=0x123,not-an-address",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid submitters filter",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("uses bounded search pagination without running an exact count", async () => {
    const { db, queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?search=curyo&limit=5&offset=10",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(queryBuilder.limit).toHaveBeenCalledWith(6);
    expect(body).toMatchObject({
      total: null,
      limit: 5,
      offset: 10,
      hasMore: false,
    });
  });

  it("uses full-text search conditions and relevance-first ordering", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?search=radioactivity%20research&sortBy=relevance",
    );

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    expect(serializeExpression(whereArg)).toContain("websearch_to_tsquery");

    const [firstOrderBy] = queryBuilder.orderBy.mock.calls[0] ?? [];
    expect(serializeExpression(firstOrderBy)).toContain("ts_rank_cd");
  });

  it("uses canonical url candidates for exact url searches", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?search=https://Example.com:443/path?q=1#frag",
    );

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    expect(serializeExpression(whereArg)).toContain("content.canonicalUrl");
    expect(serializeExpression(whereArg)).toContain("content.url");
    expect(serializeExpression(whereArg)).not.toContain("websearch_to_tsquery");
  });

  it("adds moderation predicates to content list queries before pagination", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?status=all");

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
    expect(serialized).toContain("content.title");
    expect(serialized).toContain("content.description");
    expect(serialized).toContain("content.tags");
  });

  it("orders highest reward content by available bounty amount", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?sortBy=highest_rewards",
    );

    expect(response.status).toBe(200);

    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("questionRewardPool.unallocatedAmount");
    expect(serializedWhere).toContain("questionRewardPool.allocatedAmount");
    expect(serializedWhere).toContain("questionRewardPool.claimedAmount");
    expect(serializedWhere).toContain("feedbackBonusPool.remainingAmount");
    expect(serializedWhere).toContain("content.id");

    const serializedOrderBy = serializeExpression(
      queryBuilder.orderBy.mock.calls[0] ?? [],
    );
    expect(serializedOrderBy).toContain("questionRewardPool.unallocatedAmount");
    expect(serializedOrderBy).toContain("questionRewardPool.allocatedAmount");
    expect(serializedOrderBy).toContain("questionRewardPool.claimedAmount");
    expect(serializedOrderBy).toContain("feedbackBonusPool.remainingAmount");
    expect(serializedOrderBy).toContain("content.createdAt");
  });

  it("supports filtering content by multiple raw submitter wallets", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?submitters=0x0000000000000000000000000000000000000001,0x00000000000000000000000000000000000000aa",
    );

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("inArray");
    expect(serialized).toContain("content.submitter");
    expect(serialized).toContain("0x00000000000000000000000000000000000000aa");
  });

  it("adds moderation predicates to direct content lookups", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content/1");

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("content.id");
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
  });

  it("filters seed categories with the moderation predicate", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/categories");

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("category.slug");
    expect(serialized).toContain("category.name");
  });

  it("rejects invalid round submitter filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/rounds?submitter=not-an-address",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid submitter address",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("filters rounds by submitter in the database query", async () => {
    const { queryBuilder } = mockPonderModules([{ id: "1-1" }]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/rounds?submitter=0x0000000000000000000000000000000000000001&state=1",
    );

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("content.submitter");
    expect(serialized).toContain("0x0000000000000000000000000000000000000001");
    expect(serialized).toContain("round.state");
  });

  it("rejects submitter settled round requests without a valid submitter", async () => {
    const { db } = mockPonderModules([]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const missingResponse = await app.request(
      "http://localhost/submitter-settled-rounds",
    );
    const invalidResponse = await app.request(
      "http://localhost/submitter-settled-rounds?submitter=not-an-address",
    );

    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      error: "submitter parameter required",
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: "Invalid submitter address",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries settled rounds through the dedicated submitter endpoint", async () => {
    const { queryBuilder } = mockPonderModules([
      { contentId: 1n, roundId: 2n },
    ]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/submitter-settled-rounds?submitter=0x0000000000000000000000000000000000000001&limit=25&offset=5",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.innerJoin).toHaveBeenCalled();
    expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    expect(queryBuilder.offset).toHaveBeenCalledWith(5);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("content.submitter");
    expect(serialized).toContain("0x0000000000000000000000000000000000000001");
    expect(serialized).toContain("round.state");
  });

  it("uses live profile aggregates instead of cached profile counters", async () => {
    mockPonderModules([
      {
        address: "0x00000000000000000000000000000000000000aa",
        name: "Late profile",
        selfReport: "",
        totalVotes: 0,
        totalContent: 0,
        totalRewardsClaimed: 0n,
        count: 7,
        total: 42n,
      },
    ]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/profile/0x00000000000000000000000000000000000000aa",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalVotes: 7,
      totalContent: 7,
      totalRewardsClaimed: "42",
    });
    expect(body.social).toEqual({
      followerCount: 3,
      followingCount: 2,
    });
  });
});

describe("registerLeaderboardRoutes", () => {
  it("orders profile leaderboards by live source aggregates", async () => {
    const { db, queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/leaderboard?type=voters",
    );

    expect(response.status).toBe(200);
    const selection = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(selection).toContain("vote.voter");
    expect(selection).toContain("content.submitter");
    expect(selection).toContain("rewardClaim.hrepReward");
    expect(selection).not.toContain("profile.totalVotes");

    const orderArg = queryBuilder.orderBy.mock.calls[0]?.[0];
    const serializedOrder = serializeExpression(orderArg);
    expect(serializedOrder).toContain("vote.voter");
    expect(serializedOrder).not.toContain("profile.totalVotes");
  });

  it("pages bounded-window accuracy leaderboards at the database layer", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?window=7d&limit=50&offset=25",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.orderBy).toHaveBeenCalled();
    expect(queryBuilder.limit).toHaveBeenCalledWith(50);
    expect(queryBuilder.offset).toHaveBeenCalledWith(25);
    expect(queryBuilder.limit).not.toHaveBeenCalledWith(1000);
  });

  it("accepts signal-score accuracy leaderboards without stake-based ordering", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?sortBy=signalScore&minVotes=5&minSignalVotes=5",
    );

    expect(response.status).toBe(200);
    const orderArgs = queryBuilder.orderBy.mock.calls[0] ?? [];
    const serialized = serializeExpression(orderArgs);
    expect(serialized).toContain("rbtsScoreBps");
    expect(serialized).toContain("count(*)");
    expect(serialized).toContain("vote.voter");
    expect(serialized).not.toContain("totalStakeWon");
  });

  it("attaches public reputation context when requested", async () => {
    mockPonderModules([
      {
        voter: "0x00000000000000000000000000000000000000aa",
        rater: "0x00000000000000000000000000000000000000aa",
        totalSettledVotes: 10,
        totalWins: 7,
        totalLosses: 3,
        totalStakeWon: 100n,
        totalStakeLost: 25n,
        currentStreak: 2,
        bestWinStreak: 5,
        profileName: "Rep",
        count: 4,
        raterType: 1,
        verified: true,
        revoked: false,
        expiresAt: 9_999_999_999n,
      },
    ]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?includeReputation=1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0].reputation).toMatchObject({
      humanCredentialStatus: "verified",
      participationLane: "verified_human",
      followerCount: 3,
      followingCount: 2,
    });
  });

  it("rejects invalid signal-score vote minimums", async () => {
    const { db } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?sortBy=signalScore&minSignalVotes=-1",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid minSignalVotes",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects oversized offsets before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/token-holders?offset=50001",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid offset" });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("registerDataRoutes", () => {
  it("rejects invalid rater participation status addresses before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/rater-participation-status/not-an-address",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid address" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists public follows with counts", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        walletAddress: "0x00000000000000000000000000000000000000bb",
        createdAt: 123n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/follows/0x00000000000000000000000000000000000000aa?limit=5&offset=2",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queryBuilder.limit).toHaveBeenCalledWith(5);
    expect(queryBuilder.offset).toHaveBeenCalledWith(2);
    expect(body).toEqual({
      items: [
        {
          walletAddress: "0x00000000000000000000000000000000000000bb",
          createdAt: "123",
        },
      ],
      count: 2,
      followerCount: 3,
      followingCount: 2,
      limit: 5,
      offset: 2,
    });
  });

  it("rejects invalid follower pagination offsets", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/followers/0x00000000000000000000000000000000000000aa?offset=50001",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid offset" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists public followers with counts", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        walletAddress: "0x00000000000000000000000000000000000000bb",
        createdAt: 456n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/followers/0x00000000000000000000000000000000000000aa?limit=4&offset=1",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queryBuilder.limit).toHaveBeenCalledWith(4);
    expect(queryBuilder.offset).toHaveBeenCalledWith(1);
    expect(body).toEqual({
      items: [
        {
          walletAddress: "0x00000000000000000000000000000000000000bb",
          createdAt: "456",
        },
      ],
      count: 3,
      followerCount: 3,
      followingCount: 2,
      limit: 4,
      offset: 1,
    });
  });

  it("returns rater participation status with launch context", async () => {
    const zeroHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    const { db } = mockPonderModules([
      {
        raterType: 2,
        verified: true,
        revoked: false,
        verifiedAt: 1_000n,
        expiresAt: 9_999_999_999n,
        evidenceHash: zeroHash,
        qualifyingRatingCount: 6,
        rewardedRatingCount: 4,
        distinctVerifiedAnchorCount: 2,
        distinctAnchorRoundCount: 6,
        payoutEligible: true,
        launchCap: 100n,
        fullLaunchCap: 400n,
        capBps: 2_500,
        fullCapUnlocked: false,
        capUnlockNullifierHash: null,
        launchPaid: 25n,
        cohortIndex: 2,
        latestCreditedAt: 3_200n,
        latestPaidAt: 3_300n,
        minQualifyingScoreBps: 7_000,
        minVoters: 3,
        minVerifiedHumans: 1,
        minDistinctVerifiedAnchors: 2,
        minDistinctAnchorRounds: 2,
        eligibilityRatingCount: 5,
        rewardingRatingCount: 10,
        unverifiedEarnedRaterCapBps: 2_500,
        requireNoPendingCleanup: true,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/rater-participation-status/0x00000000000000000000000000000000000000aa",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(db.select).toHaveBeenCalled();
    expect(body).toMatchObject({
      rater: "0x00000000000000000000000000000000000000aa",
      raterTypeName: "AI",
      participationLane: "verified_human",
      humanCredential: {
        status: "verified",
      },
      launchRewards: {
        eligible: true,
        qualifyingRatingCount: 6,
        rewardedRatingCount: 4,
        remainingLaunchCap: "75",
        fullLaunchCap: "400",
        capBps: 2_500,
        fullCapUnlocked: false,
        unlockableLaunchCap: "300",
        remainingRewardSlots: 6,
        policy: {
          minQualifyingScoreBps: 7_000,
          minDistinctVerifiedAnchors: 2,
          unverifiedEarnedRaterCapBps: 2_500,
        },
      },
      participationPolicy: {
        baseRewardWeightBps: 10_000,
        humanVerificationAffectsRewardWeight: false,
        verifiedHumanCountsAsLaunchAnchor: true,
      },
    });
  });

  it("expires rater participation status against wall-clock time", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(40_000_000);
    const zeroHash =
      "0x0000000000000000000000000000000000000000000000000000000000000000";
    mockPonderModules([
      {
        raterType: 2,
        updatedAt: 5_000n,
        verified: true,
        revoked: false,
        verifiedAt: 1_000n,
        expiresAt: 30_000n,
        evidenceHash: zeroHash,
        active: false,
        seededAt: 0n,
        sunsetAt: 0n,
        seedRoot: zeroHash,
        count: 0,
        qualifyingRatingCount: 1,
        rewardedRatingCount: 0,
        distinctVerifiedAnchorCount: 1,
        distinctAnchorRoundCount: 1,
        payoutEligible: false,
        launchCap: 50n,
        fullLaunchCap: 50n,
        capBps: 10_000,
        fullCapUnlocked: true,
        capUnlockNullifierHash: zeroHash,
        launchPaid: 0n,
        cohortIndex: null,
        latestCreditedAt: 5_000n,
        latestPaidAt: null,
        minQualifyingScoreBps: 7_000,
        minVoters: 3,
        minVerifiedHumans: 1,
        minDistinctVerifiedAnchors: 2,
        minDistinctAnchorRounds: 2,
        eligibilityRatingCount: 5,
        rewardingRatingCount: 10,
        unverifiedEarnedRaterCapBps: 10_000,
        requireNoPendingCleanup: true,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/rater-participation-status/0x00000000000000000000000000000000000000aa",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      asOf: {
        chainTimestamp: "5000",
        wallTimestamp: "40000",
        indexedBlockNumber: null,
      },
      participationLane: "open",
      humanCredential: {
        status: "expired",
      },
      launchRewards: {
        eligible: false,
        remainingLaunchCap: "50",
        fullLaunchCap: "50",
        capBps: 10_000,
        fullCapUnlocked: true,
        unlockableLaunchCap: "0",
        remainingRewardSlots: 10,
      },
      participationPolicy: {
        baseRewardWeightBps: 10_000,
      },
    });

    nowSpy.mockRestore();
  });

  it("includes bounty payouts in global stats", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        totalContent: 2,
        totalVotes: 3,
        totalRoundsSettled: 1,
        totalRewardsClaimed: 0n,
        totalProfiles: 4,
        totalVoterIds: 5,
        totalVerifiedHumans: 6,
        totalQuestionRewardsPaid: 123_450_000n,
        totalQuestionRewardsPaidToVoters: 119_746_500n,
        totalQuestionRewardsPaidToFrontends: 3_703_500n,
        totalFeedbackBonusesFunded: 40_000_000n,
        totalFeedbackBonusesPaid: 12_000_000n,
        totalFeedbackBonusesPaidToVoters: 11_640_000n,
        totalFeedbackBonusesPaidToFrontends: 360_000n,
        totalFeedbackBonusesForfeited: 5_000_000n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request("http://localhost/stats");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      totalQuestionRewardsPaid: "123450000",
      totalQuestionRewardsPaidToVoters: "119746500",
      totalQuestionRewardsPaidToFrontends: "3703500",
      totalFeedbackBonusesFunded: "40000000",
      totalFeedbackBonusesPaid: "12000000",
      totalFeedbackBonusesPaidToVoters: "11640000",
      totalFeedbackBonusesPaidToFrontends: "360000",
      totalFeedbackBonusesForfeited: "5000000",
      totalVerifiedHumans: 6,
    });
    const verifiedHumanWhere = queryBuilder.where.mock.calls
      .map(([value]) => serializeExpression(value))
      .find((value) => value.includes("raterHumanCredential.expiresAt"));
    expect(verifiedHumanWhere ?? "").toContain("raterHumanCredential.verified");
    expect(verifiedHumanWhere ?? "").toContain("raterHumanCredential.revoked");
    expect(verifiedHumanWhere ?? "").toContain(
      "raterHumanCredential.expiresAt",
    );
  });

  it("rejects vote cooldown requests without valid voters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/vote-cooldowns?contentIds=1,2",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "voters parameter required",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects vote cooldown requests without valid content ids before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/vote-cooldowns?voters=0x0000000000000000000000000000000000000001&contentIds=not-a-number",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "contentIds parameter required",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("groups vote cooldown requests by content id", async () => {
    const { queryBuilder } = mockPonderModules([
      { contentId: 1n, latestCommittedAt: 1000n },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/vote-cooldowns?voters=0x0000000000000000000000000000000000000001&contentIds=1,2",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          contentId: "1",
          latestCommittedAt: "1000",
          cooldownEndsAt: "87400",
        },
      ],
    });
    expect(queryBuilder.groupBy).toHaveBeenCalledWith("vote.contentId");
  });

  it("rejects bounty claim candidate requests without a valid voter", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const missingResponse = await app.request(
      "http://localhost/question-reward-claim-candidates",
    );
    const invalidResponse = await app.request(
      "http://localhost/question-reward-claim-candidates?voter=not-an-address",
    );

    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      error: "voter parameter required",
    });
    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: "Invalid voter address",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("queries bounty claim candidates across linked voter identities", async () => {
    const { queryBuilder } = mockPonderModules([
      { rewardPoolId: 1n, contentId: 2n, roundId: 3n },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/question-reward-claim-candidates?voter=0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002&limit=25&offset=5",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.innerJoin).toHaveBeenCalled();
    expect(queryBuilder.leftJoin).toHaveBeenCalled();
    expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    expect(queryBuilder.offset).toHaveBeenCalledWith(5);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);
    expect(serialized).toContain("inArray");
    expect(serialized).toContain("0x0000000000000000000000000000000000000001");
    expect(serialized).toContain("0x0000000000000000000000000000000000000002");
    expect(serialized).toContain("vote.revealed");
    expect(serialized).toContain("round.state");
    expect(serialized).toContain("questionRewardPool.startRoundId");
  });
});

describe("registerDiscoveryRoutes", () => {
  it("adds moderation predicates to discover signals queries", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/discover-signals/0x0000000000000000000000000000000000000001?watched=1,2&followed=0x0000000000000000000000000000000000000002",
    );

    expect(response.status).toBe(200);

    const serializedWhereCalls = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(serializedWhereCalls.length).toBeGreaterThanOrEqual(4);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.title")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.description"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.urlHost")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.canonicalUrl"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.tags")),
    ).toBe(true);
  });

  it("adds moderation predicates to notification event queries", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/notification-events/0x0000000000000000000000000000000000000001?watched=1,2&followed=0x0000000000000000000000000000000000000002",
    );

    expect(response.status).toBe(200);

    const serializedWhereCalls = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(serializedWhereCalls.length).toBeGreaterThanOrEqual(6);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.title")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.description"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.urlHost")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.canonicalUrl"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.tags")),
    ).toBe(true);
  });

  it("adds moderation predicates to featured content queries", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/featured-today?limit=6",
    );

    expect(response.status).toBe(200);

    const serializedWhereCalls = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(serializedWhereCalls.length).toBe(2);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.title")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.description"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.urlHost")),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) =>
        value.includes("content.canonicalUrl"),
      ),
    ).toBe(true);
    expect(
      serializedWhereCalls.every((value) => value.includes("content.tags")),
    ).toBe(true);
  });
});
