import { Hono } from "hono";
import { canonicalJson, canonicalJsonHash } from "@rateloop/node-utils/json";
import { encodePacked, keccak256 } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePonderProtocolDeploymentMetadata } from "../src/protocol-deployment.js";

function serializeExpression(value: unknown) {
  return JSON.stringify(value, (_key, current) =>
    typeof current === "bigint" ? current.toString() : current,
  );
}

function testAddressIdentityKey(account: `0x${string}`) {
  return keccak256(
    encodePacked(
      ["string", "address"],
      ["rateloop.address-identity-v1", account],
    ),
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

function mockPonderModules<T>(result: T, additionalResults: unknown[] = []) {
  const queryBuilders = [
    createQueryBuilder<unknown>(result),
    ...additionalResults.map((additionalResult) =>
      createQueryBuilder(additionalResult),
    ),
  ];
  let selectCallCount = 0;
  const db = {
    select: vi.fn(() => {
      const queryBuilder =
        queryBuilders[Math.min(selectCallCount, queryBuilders.length - 1)]!;
      selectCallCount += 1;
      return queryBuilder;
    }),
  };
  const queryBuilder = queryBuilders[0]!;

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
      contentId: "advisoryVote.contentId",
      creditedAt: "advisoryVote.creditedAt",
      launchCreditClaimed: "advisoryVote.launchCreditClaimed",
      paidAmount: "advisoryVote.paidAmount",
      revealed: "advisoryVote.revealed",
      roundId: "advisoryVote.roundId",
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
      lastActivityAt: "content.lastActivityAt",
      bundleId: "content.bundleId",
      bundleIndex: "content.bundleIndex",
      categoryId: "content.categoryId",
      createdAt: "content.createdAt",
      description: "content.description",
      detailsHash: "content.detailsHash",
      detailsUrl: "content.detailsUrl",
      gated: "content.gated",
      confidentialityBondAmount: "content.confidentialityBondAmount",
      confidentialityBondAsset: "content.confidentialityBondAsset",
      confidentialityDisclosurePolicy:
        "content.confidentialityDisclosurePolicy",
      confidentialityPublishedAt: "content.confidentialityPublishedAt",
      conservativeRatingBps: "content.conservativeRatingBps",
      ratingBps: "content.ratingBps",
      ratingConfidenceMass: "content.ratingConfidenceMass",
      rating: "content.rating",
      ratingDownEvidence: "content.ratingDownEvidence",
      ratingEffectiveEvidence: "content.ratingEffectiveEvidence",
      ratingLowSince: "content.ratingLowSince",
      ratingSettledRounds: "content.ratingSettledRounds",
      ratingUpEvidence: "content.ratingUpEvidence",
      status: "content.status",
      submitter: "content.submitter",
      tags: "content.tags",
      targetAudience: "content.targetAudience",
      questionMetadata: "content.questionMetadata",
      questionMetadataHash: "content.questionMetadataHash",
      questionMetadataUri: "content.questionMetadataUri",
      resultSpecHash: "content.resultSpecHash",
      title: "content.title",
      totalVotes: "content.totalVotes",
      url: "content.url",
      urlHost: "content.urlHost",
    },
    contentFeedback: {
      author: "contentFeedback.author",
      committedAt: "contentFeedback.committedAt",
      contentId: "contentFeedback.contentId",
      feedbackHash: "contentFeedback.feedbackHash",
      id: "contentFeedback.id",
      revealed: "contentFeedback.revealed",
      roundId: "contentFeedback.roundId",
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
    correlationEpochSnapshot: {
      id: "correlationEpochSnapshot.id",
      updatedAt: "correlationEpochSnapshot.updatedAt",
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
    raterIdentityBan: {
      active: "raterIdentityBan.active",
      bannedAt: "raterIdentityBan.bannedAt",
      evidenceHash: "raterIdentityBan.evidenceHash",
      expiresAt: "raterIdentityBan.expiresAt",
      nullifierHash: "raterIdentityBan.nullifierHash",
      permanent: "raterIdentityBan.permanent",
      provider: "raterIdentityBan.provider",
      reason: "raterIdentityBan.reason",
      unbannedAt: "raterIdentityBan.unbannedAt",
      updatedAt: "raterIdentityBan.updatedAt",
    },
    raterHumanPresence: {
      evidenceHash: "raterHumanPresence.evidenceHash",
      freshUntil: "raterHumanPresence.freshUntil",
      id: "raterHumanPresence.id",
      kind: "raterHumanPresence.kind",
      lastRecheckedAt: "raterHumanPresence.lastRecheckedAt",
      nullifierHash: "raterHumanPresence.nullifierHash",
      rater: "raterHumanPresence.rater",
      updatedAt: "raterHumanPresence.updatedAt",
      verified: "raterHumanPresence.verified",
    },
    raterWorldCredential: {
      evidenceHash: "raterWorldCredential.evidenceHash",
      expiresAt: "raterWorldCredential.expiresAt",
      id: "raterWorldCredential.id",
      kind: "raterWorldCredential.kind",
      nullifierHash: "raterWorldCredential.nullifierHash",
      rater: "raterWorldCredential.rater",
      revoked: "raterWorldCredential.revoked",
      scope: "raterWorldCredential.scope",
      updatedAt: "raterWorldCredential.updatedAt",
      verified: "raterWorldCredential.verified",
      verifiedAt: "raterWorldCredential.verifiedAt",
    },
    profile: {
      address: "profile.address",
      createdAt: "profile.createdAt",
      name: "profile.name",
      selfReport: "profile.selfReport",
      selfReportedRaterType: "profile.selfReportedRaterType",
      totalContent: "profile.totalContent",
      totalRewardsClaimed: "profile.totalRewardsClaimed",
      totalVotes: "profile.totalVotes",
      updatedAt: "profile.updatedAt",
    },
    profileSelfReportHistory: {
      address: "profileSelfReportHistory.address",
      blockNumber: "profileSelfReportHistory.blockNumber",
      logIndex: "profileSelfReportHistory.logIndex",
      selfReport: "profileSelfReportHistory.selfReport",
      updatedAt: "profileSelfReportHistory.updatedAt",
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
    feedbackBonusPool: {
      asset: "feedbackBonusPool.asset",
      awardedAmount: "feedbackBonusPool.awardedAmount",
      awardCount: "feedbackBonusPool.awardCount",
      awardDeadline: "feedbackBonusPool.awardDeadline",
      awarder: "feedbackBonusPool.awarder",
      contentId: "feedbackBonusPool.contentId",
      feedbackClosesAt: "feedbackBonusPool.feedbackClosesAt",
      frontendAwardedAmount: "feedbackBonusPool.frontendAwardedAmount",
      forfeited: "feedbackBonusPool.forfeited",
      forfeitedAmount: "feedbackBonusPool.forfeitedAmount",
      fundedAmount: "feedbackBonusPool.fundedAmount",
      id: "feedbackBonusPool.id",
      remainingAmount: "feedbackBonusPool.remainingAmount",
      roundId: "feedbackBonusPool.roundId",
      voterAwardedAmount: "feedbackBonusPool.voterAwardedAmount",
    },
    questionRewardPool: {
      asset: "questionRewardPool.asset",
      allocatedAmount: "questionRewardPool.allocatedAmount",
      bountyEligibilityDataHash: "questionRewardPool.bountyEligibilityDataHash",
      claimedAmount: "questionRewardPool.claimedAmount",
      contentId: "questionRewardPool.contentId",
      createdAt: "questionRewardPool.createdAt",
      bountyClosesAt: "questionRewardPool.bountyClosesAt",
      bountyEligibility: "questionRewardPool.bountyEligibility",
      bountyStartBy: "questionRewardPool.bountyStartBy",
      bountyWindowSeconds: "questionRewardPool.bountyWindowSeconds",
      feedbackClosesAt: "questionRewardPool.feedbackClosesAt",
      frontendClaimedAmount: "questionRewardPool.frontendClaimedAmount",
      funder: "questionRewardPool.funder",
      funderIdentityKey: "questionRewardPool.funderIdentityKey",
      fundedAmount: "questionRewardPool.fundedAmount",
      id: "questionRewardPool.id",
      qualifiedRounds: "questionRewardPool.qualifiedRounds",
      refunded: "questionRewardPool.refunded",
      refundedAmount: "questionRewardPool.refundedAmount",
      requiredVoters: "questionRewardPool.requiredVoters",
      requiredSettledRounds: "questionRewardPool.requiredSettledRounds",
      startRoundId: "questionRewardPool.startRoundId",
      unallocatedAmount: "questionRewardPool.unallocatedAmount",
      voterClaimedAmount: "questionRewardPool.voterClaimedAmount",
    },
    questionBundleClaim: {
      amount: "questionBundleClaim.amount",
      bundleId: "questionBundleClaim.bundleId",
      claimedAt: "questionBundleClaim.claimedAt",
      claimant: "questionBundleClaim.claimant",
      frontendFee: "questionBundleClaim.frontendFee",
      grossAmount: "questionBundleClaim.grossAmount",
      id: "questionBundleClaim.id",
      identityKey: "questionBundleClaim.identityKey",
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
      claimedAt: "questionRewardPoolClaim.claimedAt",
      claimant: "questionRewardPoolClaim.claimant",
      contentId: "questionRewardPoolClaim.contentId",
      frontendFee: "questionRewardPoolClaim.frontendFee",
      grossAmount: "questionRewardPoolClaim.grossAmount",
      id: "questionRewardPoolClaim.id",
      identityKey: "questionRewardPoolClaim.identityKey",
      rewardPoolId: "questionRewardPoolClaim.rewardPoolId",
      roundId: "questionRewardPoolClaim.roundId",
    },
    questionRewardPoolRound: {
      allocation: "questionRewardPoolRound.allocation",
      correlationWeightRoot: "questionRewardPoolRound.correlationWeightRoot",
      rewardPoolId: "questionRewardPoolRound.rewardPoolId",
      eligibleVoters: "questionRewardPoolRound.eligibleVoters",
      rawEligibleVoters: "questionRewardPoolRound.rawEligibleVoters",
      effectiveParticipantUnits:
        "questionRewardPoolRound.effectiveParticipantUnits",
      totalClaimWeight: "questionRewardPoolRound.totalClaimWeight",
      roundId: "questionRewardPoolRound.roundId",
    },
    roundPayoutSnapshot: {
      artifactUri: "roundPayoutSnapshot.artifactUri",
      contentId: "roundPayoutSnapshot.contentId",
      domain: "roundPayoutSnapshot.domain",
      id: "roundPayoutSnapshot.id",
      rewardPoolId: "roundPayoutSnapshot.rewardPoolId",
      roundId: "roundPayoutSnapshot.roundId",
      status: "roundPayoutSnapshot.status",
      weightRoot: "roundPayoutSnapshot.weightRoot",
    },
    ratingChange: {
      confidenceMass: "ratingChange.confidenceMass",
      conservativeRatingBps: "ratingChange.conservativeRatingBps",
      downEvidence: "ratingChange.downEvidence",
      effectiveEvidence: "ratingChange.effectiveEvidence",
      lowSince: "ratingChange.lowSince",
      newRatingBps: "ratingChange.newRatingBps",
      oldRatingBps: "ratingChange.oldRatingBps",
      referenceRatingBps: "ratingChange.referenceRatingBps",
      roundId: "ratingChange.roundId",
      settledRounds: "ratingChange.settledRounds",
      timestamp: "ratingChange.timestamp",
      upEvidence: "ratingChange.upEvidence",
    },
    rewardClaim: {
      claimedAt: "rewardClaim.claimedAt",
      contentId: "rewardClaim.contentId",
      id: "rewardClaim.id",
      lrepReward: "rewardClaim.lrepReward",
      roundId: "rewardClaim.roundId",
      source: "rewardClaim.source",
      stakePayer: "rewardClaim.stakePayer",
      stakeReturned: "rewardClaim.stakeReturned",
      voter: "rewardClaim.voter",
    },
    round: {
      confidenceMass: "round.confidenceMass",
      contentId: "round.contentId",
      downEvidence: "round.downEvidence",
      downPool: "round.downPool",
      conservativeRatingBps: "round.conservativeRatingBps",
      effectiveEvidence: "round.effectiveEvidence",
      hasHumanVerifiedCommit: "round.hasHumanVerifiedCommit",
      humanVerifiedCommitCount: "round.humanVerifiedCommitCount",
      lastCommitRevealableAfter: "round.lastCommitRevealableAfter",
      lowSince: "round.lowSince",
      maxDuration: "round.maxDuration",
      maxVoters: "round.maxVoters",
      minVoters: "round.minVoters",
      revealedCount: "round.revealedCount",
      roundId: "round.roundId",
      ratingBps: "round.ratingBps",
      referenceRatingBps: "round.referenceRatingBps",
      revealGracePeriod: "round.revealGracePeriod",
      settledAt: "round.settledAt",
      settledRounds: "round.settledRounds",
      startTime: "round.startTime",
      state: "round.state",
      totalStake: "round.totalStake",
      upEvidence: "round.upEvidence",
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
      commitBlockNumber: "vote.commitBlockNumber",
      commitKey: "vote.commitKey",
      commitLogIndex: "vote.commitLogIndex",
      contentId: "vote.contentId",
      credentialMask: "vote.credentialMask",
      epochIndex: "vote.epochIndex",
      freshCredentialMask: "vote.freshCredentialMask",
      identityHolder: "vote.identityHolder",
      identityKey: "vote.identityKey",
      isUp: "vote.isUp",
      revealed: "vote.revealed",
      revealedAt: "vote.revealedAt",
      roundId: "vote.roundId",
      stake: "vote.stake",
      rbtsForfeitedStake: "vote.rbtsForfeitedStake",
      rbtsRewardWeight: "vote.rbtsRewardWeight",
      rbtsScoreBps: "vote.rbtsScoreBps",
      rbtsStakeReturned: "vote.rbtsStakeReturned",
      rbtsWeight: "vote.rbtsWeight",
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

  return { db, queryBuilder, queryBuilders };
}

afterEach(() => {
  vi.doUnmock("../src/api/shared.js");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("shared API helpers", () => {
  it("keeps feedback bonus close time distinct from award deadline", async () => {
    const { db } = mockPonderModules(
      [],
      [
        [
          {
            contentId: 1n,
            asset: 1,
            poolCount: 1,
            activePoolCount: 1,
            expiredPoolCount: 0,
            totalFundedAmount: 1_000_000n,
            totalRemainingAmount: 1_000_000n,
            activeRemainingAmount: 1_000_000n,
            expiredRemainingAmount: 0n,
            totalAwardedAmount: 0n,
            totalVoterAwardedAmount: 0n,
            totalFrontendAwardedAmount: 0n,
            totalForfeitedAmount: 0n,
            awardCount: 0,
            nextFeedbackAwardDeadline: 220n,
            nextFeedbackClosesAt: 150n,
          },
        ],
        [],
        [],
      ],
    );
    const { attachOpenRoundSummary } = await import("../src/api/shared.js");

    const [item] = await attachOpenRoundSummary(
      [{ id: 1n, title: "Feedback question", url: "https://example.com" }],
      100n,
    );

    const feedbackBonusSelect = db.select.mock.calls[1]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(
      serializeExpression(feedbackBonusSelect?.nextFeedbackClosesAt),
    ).toContain("feedbackBonusPool.feedbackClosesAt");
    expect(item?.feedbackBonusSummary.nextFeedbackClosesAt).toBe(150n);
    expect(item?.feedbackBonusSummary.nextFeedbackAwardDeadline).toBe(220n);
  });
});

describe("question bundle claim candidates", () => {
  it("excludes bundle round sets already claimed by the voter identity", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        bundleId: 7n,
        roundSetIndex: 0,
        asset: 1,
        correlationWeightRoot: null,
        payoutWeightRoot: null,
        payoutArtifactHash: null,
        payoutArtifactUri: null,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/question-bundle-claim-candidates?voter=0x0000000000000000000000000000000000000001",
    );

    expect(response.status).toBe(200);

    const leftJoinExpressions = queryBuilder.leftJoin.mock.calls.map(call =>
      serializeExpression(call),
    );
    expect(
      leftJoinExpressions.some(
        join =>
          join.includes("questionBundleClaim.bundleId") &&
          join.includes("questionBundleClaim.roundSetIndex") &&
          join.includes("questionBundleClaim.identityKey"),
      ),
    ).toBe(true);

    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("questionBundleClaim.id");
    expect(serializedWhere).toContain("is null");
  });
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

function gatedConfidentialityFields(overrides: Record<string, unknown> = {}) {
  return {
    confidentialityBondAmount: 0n,
    confidentialityBondAsset: "LREP",
    confidentialityDisclosurePolicy: "private_forever",
    confidentialityPublishedAt: null,
    gated: true,
    questionMetadata: canonicalJson({
      confidentiality: {
        bond: { amount: "0", asset: "LREP" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      schemaVersion: "rateloop.question.v3",
      title: "Public-safe private context title",
    }),
    ...overrides,
  };
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

  it("rejects invalid target audience filters with canonical suggestions", async () => {
    const { db } = mockPonderModules([]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?targetAudience.roles=developer",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("targetAudience.roles");
    expect(body.error).toContain("developer");
    expect(body.error).toContain("engineer");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("serves verified question metadata by hash", async () => {
    const targetAudience = { languages: ["de"], roles: ["engineer"] };
    const questionMetadata = {
      schemaVersion: "rateloop.question.v2",
      targetAudience,
      templateId: "generic_rating",
      templateInputs: null,
      templateVersion: 1,
      title: "German engineering feedback",
    };
    const questionMetadataHash = canonicalJsonHash(questionMetadata);
    mockPonderModules([
      {
        contentId: 42n,
        createdAt: 123n,
        questionMetadata: canonicalJson(questionMetadata),
        questionMetadataHash,
        questionMetadataUri: `https://rateloop.ai/question-metadata/${questionMetadataHash}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: JSON.stringify(targetAudience),
        title: "German engineering feedback",
      },
    ]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      `http://localhost/question-metadata/${questionMetadataHash}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.questionMetadataHash).toBe(questionMetadataHash);
    expect(body.questionMetadata).toEqual(questionMetadata);
    expect(body.items).toEqual([
      {
        contentId: "42",
        createdAt: "123",
        questionMetadataUri: `https://rateloop.ai/question-metadata/${questionMetadataHash}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience,
        title: "German engineering feedback",
      },
    ]);
  });

  it("does not serve gated undisclosed question metadata preimages", async () => {
    const questionMetadata = {
      schemaVersion: "rateloop.question.v3",
      confidentiality: {
        bond: { amount: "0", asset: "LREP" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      targetAudience: { roles: ["founder"] },
      templateInputs: { privateStimulus: "unreleased concept text" },
      title: "Public-safe prototype title",
    };
    const questionMetadataHash = canonicalJsonHash(questionMetadata);
    mockPonderModules([
      {
        contentId: 43n,
        createdAt: 123n,
        ...gatedConfidentialityFields({
          questionMetadata: canonicalJson(questionMetadata),
        }),
        questionMetadataHash,
        questionMetadataUri: `https://rateloop.ai/question-metadata/${questionMetadataHash}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: JSON.stringify(questionMetadata.targetAudience),
        title: "Public-safe prototype title",
      },
    ]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      `http://localhost/question-metadata/${questionMetadataHash}`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error:
        "Question metadata preimage is not available until confidential context is public.",
    });
  });

  it("publishes late-synced after_settlement confidentiality when a terminal round already exists", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPonderNetwork = process.env.PONDER_NETWORK;
    const query = vi.fn(async () => ({ rowCount: 1 }));
    vi.doMock("pg", () => ({
      Pool: vi.fn(function MockPool() {
        return { query };
      }),
    }));
    process.env.DATABASE_URL = "postgres://localhost/rateloop";
    process.env.NODE_ENV = "test";
    process.env.PONDER_NETWORK = "hardhat";
    process.env.PONDER_METADATA_SYNC_ALLOW_OPEN = "true";

    try {
      mockPonderModules([]);
      const { registerContentRoutes } = await import(
        "../src/api/routes/content-routes.js"
      );

      const app = new Hono();
      registerContentRoutes(app);
      const questionMetadata = {
        schemaVersion: "rateloop.question.v3",
        confidentiality: {
          bond: { amount: "0", asset: "LREP" },
          disclosurePolicy: "after_settlement",
          visibility: "gated",
        },
        title: "Public-safe prototype title",
      };
      const questionMetadataHash = canonicalJsonHash(questionMetadata);
      const deployment = resolvePonderProtocolDeploymentMetadata();
      expect(deployment).not.toBeNull();

      const response = await app.request("http://localhost/question-metadata", {
        body: JSON.stringify({
          deploymentKey: deployment?.deploymentKey,
          metadata: [
            {
              contentId: "42",
              questionMetadata,
              questionMetadataHash,
              resultSpecHash: `0x${"3".repeat(64)}`,
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ updated: 1, skipped: 0 });
      expect(query).toHaveBeenCalledTimes(1);
      const [sqlText, params] = query.mock.calls[0]!;
      expect(sqlText).toContain('"confidentiality_published_at" = case');
      expect(sqlText).toContain('from "rateloop_ponder_hardhat"."round"');
      expect(sqlText).toContain('"state" in ($31, $32, $33)');
      expect(params[25]).toBe(true);
      expect(params[26]).toBe("after_settlement");
      expect(params[29]).toBe("42");
      expect(params.slice(30)).toHaveLength(3);
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalPonderNetwork === undefined) {
        delete process.env.PONDER_NETWORK;
      } else {
        process.env.PONDER_NETWORK = originalPonderNetwork;
      }
    }
  });

  it("uses the Base Sepolia default schema for metadata sync writes", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPonderNetwork = process.env.PONDER_NETWORK;
    const originalDatabaseSchema = process.env.DATABASE_SCHEMA;
    const originalRateloopSchema = process.env.RATELOOP_PONDER_DATABASE_SCHEMA;
    const originalAllowOpen = process.env.PONDER_METADATA_SYNC_ALLOW_OPEN;
    const query = vi.fn(async () => ({ rowCount: 1 }));
    vi.doMock("pg", () => ({
      Pool: vi.fn(function MockPool() {
        return { query };
      }),
    }));
    process.env.DATABASE_URL = "postgres://localhost/rateloop";
    process.env.NODE_ENV = "test";
    process.env.PONDER_NETWORK = "baseSepolia";
    process.env.PONDER_METADATA_SYNC_ALLOW_OPEN = "true";
    delete process.env.DATABASE_SCHEMA;
    delete process.env.RATELOOP_PONDER_DATABASE_SCHEMA;

    try {
      mockPonderModules([]);
      const { registerContentRoutes } = await import(
        "../src/api/routes/content-routes.js"
      );

      const app = new Hono();
      registerContentRoutes(app);
      const questionMetadata = {
        schemaVersion: "rateloop.question.v3",
        title: "Public-safe Base Sepolia title",
      };
      const questionMetadataHash = canonicalJsonHash(questionMetadata);
      const deployment = resolvePonderProtocolDeploymentMetadata();
      expect(deployment).not.toBeNull();

      const response = await app.request("http://localhost/question-metadata", {
        body: JSON.stringify({
          deploymentKey: deployment?.deploymentKey,
          metadata: [
            {
              contentId: "42",
              questionMetadata,
              questionMetadataHash,
              resultSpecHash: `0x${"3".repeat(64)}`,
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ updated: 1, skipped: 0 });
      expect(query).toHaveBeenCalledTimes(1);
      const [sqlText] = query.mock.calls[0]!;
      expect(sqlText).toContain('"rateloop_ponder_base_sepolia"."content"');
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalPonderNetwork === undefined) {
        delete process.env.PONDER_NETWORK;
      } else {
        process.env.PONDER_NETWORK = originalPonderNetwork;
      }
      if (originalDatabaseSchema === undefined) {
        delete process.env.DATABASE_SCHEMA;
      } else {
        process.env.DATABASE_SCHEMA = originalDatabaseSchema;
      }
      if (originalRateloopSchema === undefined) {
        delete process.env.RATELOOP_PONDER_DATABASE_SCHEMA;
      } else {
        process.env.RATELOOP_PONDER_DATABASE_SCHEMA = originalRateloopSchema;
      }
      if (originalAllowOpen === undefined) {
        delete process.env.PONDER_METADATA_SYNC_ALLOW_OPEN;
      } else {
        process.env.PONDER_METADATA_SYNC_ALLOW_OPEN = originalAllowOpen;
      }
    }
  });

  it("rejects metadata sync writes for a different deployment key", async () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPonderNetwork = process.env.PONDER_NETWORK;
    const query = vi.fn(async () => ({ rowCount: 1 }));
    vi.doMock("pg", () => ({
      Pool: vi.fn(function MockPool() {
        return { query };
      }),
    }));
    process.env.DATABASE_URL = "postgres://localhost/rateloop";
    process.env.NODE_ENV = "test";
    process.env.PONDER_NETWORK = "hardhat";
    process.env.PONDER_METADATA_SYNC_ALLOW_OPEN = "true";

    try {
      mockPonderModules([]);
      const { registerContentRoutes } = await import(
        "../src/api/routes/content-routes.js"
      );

      const app = new Hono();
      registerContentRoutes(app);
      const questionMetadata = {
        schemaVersion: "rateloop.question.v3",
        title: "Public-safe prototype title",
      };
      const questionMetadataHash = canonicalJsonHash(questionMetadata);
      const deployment = resolvePonderProtocolDeploymentMetadata();
      expect(deployment).not.toBeNull();

      const response = await app.request("http://localhost/question-metadata", {
        body: JSON.stringify({
          deploymentKey: `${deployment?.deploymentKey}:stale`,
          metadata: [
            {
              contentId: "42",
              questionMetadata,
              questionMetadataHash,
              resultSpecHash: `0x${"3".repeat(64)}`,
            },
          ],
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "deploymentKey does not match this Ponder deployment.",
        expectedDeploymentKey: deployment?.deploymentKey,
        receivedDeploymentKey: `${deployment?.deploymentKey}:stale`,
      });
      expect(query).not.toHaveBeenCalled();
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalPonderNetwork === undefined) {
        delete process.env.PONDER_NETWORK;
      } else {
        process.env.PONDER_NETWORK = originalPonderNetwork;
      }
      vi.doUnmock("pg");
      vi.resetModules();
    }
  });

  it("does not serve mismatched question metadata preimages", async () => {
    const questionMetadataHash = canonicalJsonHash({
      schemaVersion: "rateloop.question.v2",
      title: "Expected preimage",
    });
    mockPonderModules([
      {
        contentId: 42n,
        createdAt: 123n,
        questionMetadata: canonicalJson({
          schemaVersion: "rateloop.question.v2",
          title: "Different preimage",
        }),
        questionMetadataHash,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: null,
        title: "Expected preimage",
      },
    ]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      `http://localhost/question-metadata/${questionMetadataHash}`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Question metadata preimage is not available.",
    });
  });

  it("redacts targeting metadata from default content responses", async () => {
    const targetAudience = { languages: ["de"], roles: ["engineer"] };
    mockPonderModules(
      [
        {
          id: 42n,
          questionMetadata: canonicalJson({
            schemaVersion: "rateloop.question.v2",
            targetAudience,
            title: "German engineering feedback",
          }),
          questionMetadataUri: `https://rateloop.ai/question-metadata/${"2".repeat(64)}`,
          targetAudience: JSON.stringify(targetAudience),
          title: "German engineering feedback",
        },
      ],
      [[], [{ count: 1 }]],
    );
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?limit=5");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]).not.toHaveProperty("targetAudience");
    expect(body.items[0]).not.toHaveProperty("questionMetadata");
    expect(body.items[0]).not.toHaveProperty("questionMetadataUri");
  });

  it("redacts gated undisclosed context from default content responses", async () => {
    const questionMetadata = {
      schemaVersion: "rateloop.question.v3",
      confidentiality: {
        bond: { amount: "2500000", asset: "USDC" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
      title: "Public-safe prototype title",
    };
    mockPonderModules(
      [
        {
          id: 42n,
          description: "Sensitive unreleased landing-page copy.",
          detailsHash: `0x${"4".repeat(64)}`,
          detailsUrl:
            "https://www.rateloop.ai/api/attachments/details/det_abcdefghijklmnop",
          gated: true,
          confidentialityBondAmount: 2500000n,
          confidentialityBondAsset: "USDC",
          confidentialityDisclosurePolicy: "private_forever",
          confidentialityPublishedAt: null,
          questionMetadata: canonicalJson(questionMetadata),
          title: "Public-safe prototype title",
        },
      ],
      [
        [
          {
            contentId: 42n,
            mediaIndex: 0,
            mediaType: "image",
            url: "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp",
            canonicalUrl:
              "https://www.rateloop.ai/api/attachments/images/att_abcdefghijklmnop.webp",
            urlHost: "www.rateloop.ai",
          },
        ],
        [{ count: 1 }],
      ],
    );
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?limit=5");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      contextAccess: "gated",
      contextVisibility: "gated",
      description: "",
      detailsHash: null,
      detailsUrl: null,
      media: [],
      confidentiality: {
        bondAmount: "2500000",
        bondAsset: "USDC",
        disclosurePolicy: "private_forever",
        publishedAt: null,
        visibility: "gated",
      },
    });
  });

  it("redacts context when gating comes only from indexed escrow events", async () => {
    mockPonderModules(
      [
        {
          id: 43n,
          description: "Sensitive event-indexed prototype copy.",
          detailsHash: `0x${"5".repeat(64)}`,
          detailsUrl:
            "https://www.rateloop.ai/api/attachments/details/det_eventindexed",
          gated: true,
          confidentialityBondAmount: 1_000_000n,
          confidentialityBondAsset: "LREP",
          confidentialityDisclosurePolicy: null,
          confidentialityPublishedAt: null,
          questionMetadata: null,
          title: "Public-safe event title",
        },
      ],
      [
        [
          {
            contentId: 43n,
            mediaIndex: 0,
            mediaType: "image",
            url: "https://www.rateloop.ai/api/attachments/images/att_eventindexed.webp",
            canonicalUrl:
              "https://www.rateloop.ai/api/attachments/images/att_eventindexed.webp",
            urlHost: "www.rateloop.ai",
          },
        ],
        [{ count: 1 }],
      ],
    );
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?limit=5");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      contextAccess: "gated",
      contextVisibility: "gated",
      description: "",
      detailsHash: null,
      detailsUrl: null,
      media: [],
      confidentiality: {
        bondAmount: "1000000",
        bondAsset: "LREP",
        disclosurePolicy: "after_settlement",
        publishedAt: null,
        visibility: "gated",
      },
    });
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
      "http://localhost/content?search=rateloop&limit=5&offset=10",
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

  it("uses an extra row to detect more non-search content pages", async () => {
    const { queryBuilder } = mockPonderModules([
      { id: 1n },
      { id: 2n },
      { id: 3n },
      { id: 4n },
      { id: 5n },
      { id: 6n },
    ]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?limit=5");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queryBuilder.limit).toHaveBeenCalledWith(6);
    expect(body.items).toHaveLength(5);
    expect(body).toMatchObject({
      limit: 5,
      offset: 0,
      hasMore: true,
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
    expect(serializeExpression(whereArg)).toContain("content.gated");
    expect(serializeExpression(whereArg)).toContain(
      "content.confidentialityPublishedAt",
    );

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

  it("can sort content with bounties first without hiding unpaid content", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?sortBy=bounty_first",
    );

    expect(response.status).toBe(200);

    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).not.toContain(
      "questionRewardPool.unallocatedAmount",
    );

    const serializedOrderBy = serializeExpression(
      queryBuilder.orderBy.mock.calls[0] ?? [],
    );
    expect(serializedOrderBy).toContain("case when");
    expect(serializedOrderBy).toContain("questionRewardPool.unallocatedAmount");
    expect(serializedOrderBy).toContain("feedbackBonusPool.remainingAmount");
  });

  it("adds voteable round lifecycle predicates when requested", async () => {
    const { queryBuilder } = mockPonderModules([{ id: 1n }]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?status=all&voteable=1",
    );

    expect(response.status).toBe(200);

    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("content.status");
    expect(serializedWhere).toContain("round.state");
    expect(serializedWhere).toContain("round.startTime");
    expect(serializedWhere).toContain("round.maxDuration");
    expect(serializedWhere).toContain("round.voteCount");
    expect(serializedWhere).toContain("round.maxVoters");
    expect(serializedWhere).toContain("round.revealedCount");
    expect(serializedWhere).toContain("round.minVoters");
    expect(serializedWhere).toContain("round.humanVerifiedCommitCount");
    expect(serializedWhere).toContain("greatest");
    expect(serializedWhere).toContain("round.lastCommitRevealableAfter");
    expect(serializedWhere).toContain("round.revealGracePeriod");
    expect(serializedWhere).toContain("advisoryVote.contentId");
    expect(serializedWhere).toContain("advisoryVote.roundId");
  });

  it("rejects invalid voteable filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/content?voteable=maybe",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid voteable filter" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects malformed content now timestamps before querying the database", async () => {
    const { db } = mockPonderModules([]);
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/content?now=abc");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "now must be a non-negative integer",
    });
    expect(db.select).not.toHaveBeenCalled();
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

  it("rejects invalid roundId filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/rounds?contentId=1&roundId=not-a-number",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid roundId" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("filters rounds by roundId in the database query", async () => {
    const { queryBuilder } = mockPonderModules([{ id: "42-7" }]);
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/rounds?contentId=42&roundId=7&limit=1",
    );

    expect(response.status).toBe(200);

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);

    expect(serialized).toContain("round.contentId");
    expect(serialized).toContain("round.roundId");
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
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
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
  });

  it("adds moderation predicates to profile recent submissions", async () => {
    const { queryBuilders } = mockPonderModules(
      [{ address: "0x0000000000000000000000000000000000000001" }],
      [
        [{ count: 0 }],
        [{ count: 0 }],
        [{ total: 0n }],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    );
    mockSharedModule();
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request(
      "http://localhost/profile/0x0000000000000000000000000000000000000001",
    );

    expect(response.status).toBe(200);

    const serialized = queryBuilders
      .flatMap(builder =>
        builder.where.mock.calls.map(([value]) => serializeExpression(value)),
      )
      .find(
        value =>
          value.includes("content.submitter") &&
          value.includes("content.urlHost"),
      );
    expect(serialized).toBeDefined();
    expect(serialized).toContain("content.submitter");
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
  });

  it("redacts gated undisclosed context from round previews", async () => {
    mockPonderModules(
      [
        {
          id: "42-1",
          contentId: 42n,
          roundId: 1n,
          description: "Sensitive prototype text.",
          title: "Public-safe private context title",
          url: "https://rateloop.ai/api/attachments/details/det_privatecontext1",
          submitter: "0x0000000000000000000000000000000000000001",
          categoryId: 1n,
          ...gatedConfidentialityFields(),
        },
      ],
      [[{ count: 1 }]],
    );
    const { registerContentRoutes } = await import(
      "../src/api/routes/content-routes.js"
    );

    const app = new Hono();
    registerContentRoutes(app);

    const response = await app.request("http://localhost/rounds?state=1");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      contextAccess: "gated",
      description: "",
      url: "",
    });
    expect(body.items[0]).not.toHaveProperty("gated");
    expect(body.items[0]).not.toHaveProperty("questionMetadata");
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
    expect(selection).toContain("rewardClaim.lrepReward");
    expect(selection).not.toContain("profile.totalVotes");

    const orderArg = queryBuilder.orderBy.mock.calls[0]?.[0];
    const serializedOrder = serializeExpression(orderArg);
    expect(serializedOrder).toContain("vote.voter");
    expect(serializedOrder).not.toContain("profile.totalVotes");
  });

  it("pages bounded-window accuracy leaderboards at the database layer", async () => {
    const { db, queryBuilder } = mockPonderModules([]);
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

    const selection = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(selection).toContain("vote.identityHolder");
    const joins = serializeExpression(queryBuilder.leftJoin.mock.calls);
    expect(joins).toContain("vote.identityHolder");
    const groupBy = serializeExpression(queryBuilder.groupBy.mock.calls);
    expect(groupBy).toContain("vote.identityHolder");
    const orderBy = serializeExpression(queryBuilder.orderBy.mock.calls);
    expect(orderBy).toContain("vote.identityHolder");
  });

  it("uses identity holders for bounded-window win-rate accuracy leaderboards", async () => {
    const { db, queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?window=7d&sortBy=winRate",
    );

    expect(response.status).toBe(200);
    const selection = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(selection).toContain("vote.identityHolder");
    const joins = serializeExpression(queryBuilder.leftJoin.mock.calls);
    expect(joins).toContain("vote.identityHolder");
    const groupBy = serializeExpression(queryBuilder.groupBy.mock.calls);
    expect(groupBy).toContain("vote.identityHolder");
    const orderBy = serializeExpression(queryBuilder.orderBy.mock.calls);
    expect(orderBy).toContain("vote.identityHolder");
  });

  it("builds earnings leaderboards from net recipient reward amounts", async () => {
    const { db, queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/earnings-leaderboard?window=30d&asset=usdc&source=bounty&limit=25&offset=5",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.innerJoin).toHaveBeenCalled();
    expect(queryBuilder.leftJoin).toHaveBeenCalled();
    const selection = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(selection).toContain("questionRewardPoolClaim.amount");
    expect(selection).not.toContain("questionRewardPoolClaim.grossAmount");

    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serializedWhere = serializeExpression(whereArg);
    expect(serializedWhere).toContain("questionRewardPool.asset");
    expect(serializedWhere).toContain("questionRewardPoolClaim.claimedAt");
  });

  it("rejects unsupported earnings leaderboard filters", async () => {
    const { db } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/earnings-leaderboard?asset=eth",
    );

    expect(response.status).toBe(400);
    expect(db.select).not.toHaveBeenCalled();
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

  it("filters accuracy leaderboards by effective rater type before paging", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?sortBy=signalScore&raterType=ai",
    );

    expect(response.status).toBe(200);
    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);
    expect(serialized).toContain("raterProfile.raterType");
    expect(serialized).toContain("profile.selfReportedRaterType");
    expect(serialized).toContain("raterHumanCredential.verified");
    expect(serialized).toContain("2");
  });

  it("rejects invalid rater type filters before querying", async () => {
    const { db } = mockPonderModules([]);
    const { registerLeaderboardRoutes } = await import(
      "../src/api/routes/leaderboard-routes.js"
    );

    const app = new Hono();
    registerLeaderboardRoutes(app);

    const response = await app.request(
      "http://localhost/accuracy-leaderboard?raterType=unknown",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid raterType" });
    expect(db.select).not.toHaveBeenCalled();
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
  it("redacts gated undisclosed context from question bundle previews", async () => {
    mockPonderModules(
      [
        {
          id: 7n,
          asset: "LREP",
          fundedAmount: 10n,
          requiredCompleters: 2,
        },
      ],
      [
        [
          {
            id: 1n,
            bundleId: 7n,
            contentId: 42n,
            bundleIndex: 0,
            updatedAt: 123n,
            description: "Sensitive bundle member text.",
            title: "Public-safe private context title",
            url: "https://rateloop.ai/api/attachments/details/det_privatecontext2",
            submitter: "0x0000000000000000000000000000000000000001",
            categoryId: 1n,
            status: 0,
            rating: 0n,
            ratingBps: 0,
            createdAt: 100n,
            ...gatedConfidentialityFields(),
          },
        ],
        [],
        [],
      ],
    );
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request("http://localhost/question-bundles/7");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.questions[0]).toMatchObject({
      contextAccess: "gated",
      description: "",
      url: "",
    });
    expect(body.questions[0]).not.toHaveProperty("gated");
    expect(body.questions[0]).not.toHaveProperty("questionMetadata");
  });

  it("adds moderation predicates to question bundle previews", async () => {
    const { queryBuilders } = mockPonderModules(
      [{ id: 7n }],
      [[], [], []],
    );
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request("http://localhost/question-bundles/7");

    expect(response.status).toBe(200);

    const questionsBuilder = queryBuilders[1]!;
    const serialized = serializeExpression(
      questionsBuilder.where.mock.calls[0]?.[0],
    );
    expect(serialized).toContain("questionBundleQuestion.bundleId");
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
  });

  it("rejects invalid feedback bonus pool awarder filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/feedback-bonus-pools?contentId=1&awarder=not-an-address",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid awarder address" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists active feedback bonus pools for an awarder", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        id: 7n,
        contentId: 1n,
        roundId: 2n,
        awarder: "0x00000000000000000000000000000000000000aa",
        remainingAmount: 2_000_000n,
        feedbackClosesAt: 9_999_999_999n,
        awardDeadline: 9_999_999_999n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/feedback-bonus-pools?contentId=1&roundId=2&awarder=0x00000000000000000000000000000000000000AA&activeOnly=true&limit=5",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queryBuilder.limit).toHaveBeenCalledWith(5);
    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("feedbackBonusPool.contentId");
    expect(serializedWhere).toContain("feedbackBonusPool.roundId");
    expect(serializedWhere).toContain("feedbackBonusPool.awarder");
    expect(serializedWhere).toContain("feedbackBonusPool.remainingAmount");
    expect(serializedWhere).toContain("feedbackBonusPool.awardDeadline");
    expect(body.items[0]).toMatchObject({
      id: "7",
      contentId: "1",
      roundId: "2",
      awarder: "0x00000000000000000000000000000000000000aa",
      remainingAmount: "2000000",
    });
  });

  it("rejects invalid feedback bonus award hash filters before querying the database", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/feedback-bonus-awards?contentId=1&feedbackHashes=0x1234",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid feedback hash" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("lists feedback bonus awards for visible feedback hashes", async () => {
    const hash =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const { queryBuilder } = mockPonderModules([
      {
        id: `7-${hash}`,
        poolId: 7n,
        contentId: 1n,
        roundId: 2n,
        feedbackHash: hash,
        grossAmount: 1_000_000n,
        recipientAmount: 970_000n,
        frontendFee: 30_000n,
        awardedAt: 5_000n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      `http://localhost/feedback-bonus-awards?contentId=1&roundId=2&feedbackHashes=${hash}&limit=5`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(queryBuilder.limit).toHaveBeenCalledWith(5);
    const serializedWhere = serializeExpression(
      queryBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("feedbackBonusAward.contentId");
    expect(serializedWhere).toContain("feedbackBonusAward.roundId");
    expect(serializedWhere).toContain("feedbackBonusAward.feedbackHash");
    expect(body.items[0]).toMatchObject({
      poolId: "7",
      feedbackHash: hash,
      grossAmount: "1000000",
      recipientAmount: "970000",
      frontendFee: "30000",
    });
  });

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

  it("includes active confidentiality sanctions in rater participation status", async () => {
    const nullifierHash = `0x${"9".repeat(64)}`;
    const evidenceHash = `0x${"8".repeat(64)}`;
    mockPonderModules([
      {
        raterType: 1,
        updatedAt: 6_000n,
        verified: true,
        revoked: false,
        provider: 2,
        nullifierHash,
        verifiedAt: 1_000n,
        expiresAt: 9_999_999_999n,
        evidenceHash,
        active: true,
        permanent: false,
        reason: "verified leak",
        bannedAt: 5_000n,
        unbannedAt: null,
        qualifyingRatingCount: 0,
        rewardedRatingCount: 0,
        distinctVerifiedAnchorCount: 0,
        distinctAnchorRoundCount: 0,
        payoutEligible: false,
        launchCap: 0n,
        fullLaunchCap: 0n,
        capBps: 0,
        fullCapUnlocked: false,
        capUnlockNullifierHash: null,
        launchPaid: 0n,
        cohortIndex: null,
        latestCreditedAt: null,
        latestPaidAt: null,
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
    expect(body.confidentialitySanction).toMatchObject({
      active: true,
      provider: 2,
      permanent: false,
      expiresAt: "9999999999",
      evidenceHash,
      reason: "verified leak",
      bannedAt: "5000",
      unbannedAt: null,
    });
    expect(JSON.stringify(body.confidentialitySanction)).not.toContain(
      nullifierHash,
    );
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
        totalFrontendFeesClaimed: 7_500_000n,
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
      totalFrontendFeesClaimed: "7500000",
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

  it("rejects viewer reward status requests without valid voters or content ids", async () => {
    const { db } = mockPonderModules([]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const missingResponse = await app.request(
      "http://localhost/viewer-reward-statuses?contentIds=1,2",
    );
    const invalidVoterResponse = await app.request(
      "http://localhost/viewer-reward-statuses?voters=not-an-address&contentIds=1,2",
    );
    const invalidContentResponse = await app.request(
      "http://localhost/viewer-reward-statuses?voters=0x0000000000000000000000000000000000000001&contentIds=not-a-number",
    );

    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({
      error: "voters parameter required",
    });
    expect(invalidVoterResponse.status).toBe(400);
    expect(await invalidVoterResponse.json()).toEqual({
      error: "Invalid voter address",
    });
    expect(invalidContentResponse.status).toBe(400);
    expect(await invalidContentResponse.json()).toEqual({
      error: "Invalid contentIds",
    });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("summarizes pending viewer bounty and feedback bonus statuses by content", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        contentId: 2n,
        pendingBountyCount: 1,
        claimableBountyCount: 0,
        awaitingBountyAllocationCount: 0,
        awaitingBountyPayoutCount: 1,
        latestBountyRoundId: 3n,
        pendingFeedbackBonusCount: 1,
        latestFeedbackBonusRoundId: 4n,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/viewer-reward-statuses?voters=0x0000000000000000000000000000000000000001&contentIds=2",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          contentId: "2",
          pendingBountyCount: 1,
          claimableBountyCount: 0,
          awaitingBountyAllocationCount: 0,
          awaitingBountyPayoutCount: 1,
          latestBountyRoundId: "3",
          pendingFeedbackBonusCount: 1,
          latestFeedbackBonusRoundId: "4",
          hasPendingBounty: true,
          hasPendingFeedbackBonus: true,
        },
      ],
    });
    expect(queryBuilder.where).toHaveBeenCalledTimes(2);
    const whereExpressions = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(whereExpressions[0]).toContain("vote.revealed");
    expect(whereExpressions[0]).toContain("questionRewardPoolClaim.id");
    expect(whereExpressions[1]).toContain("contentFeedback.author");
    expect(whereExpressions[1]).toContain("feedbackBonusPool.awardDeadline");
    expect(queryBuilder.groupBy).toHaveBeenCalledWith("vote.contentId");
    expect(queryBuilder.groupBy).toHaveBeenCalledWith(
      "contentFeedback.contentId",
    );
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
    expect(serialized).toContain("questionRewardPoolClaim.id");
    expect(serialized).toContain("content.urlHost");
    expect(serialized).toContain("content.canonicalUrl");
    const joinExpressions = queryBuilder.leftJoin.mock.calls.map((call) =>
      serializeExpression(call),
    );
    expect(
      joinExpressions.some((join) =>
        join.includes("questionRewardPoolClaim.identityKey"),
      ),
    ).toBe(true);
  });

  it("attaches payout proofs for finalized USDC bounty candidates", async () => {
    const leaf = `0x${"d".repeat(64)}`;
    const payoutWeight = {
      domain: 1,
      rewardPoolId: "1",
      contentId: "2",
      roundId: "3",
      commitKey: `0x${"a".repeat(64)}`,
      identityKey: `0x${"b".repeat(64)}`,
      account: "0x0000000000000000000000000000000000000001",
      baseWeight: "10000",
      independenceBps: 10000,
      effectiveWeight: "10000",
      reasonHash: `0x${"c".repeat(64)}`,
      leaf,
    };
    const artifactUri = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        roundPayoutSnapshots: [
          {
            domain: 1,
            rewardPoolId: "1",
            contentId: "2",
            roundId: "3",
            leaves: [payoutWeight],
          },
        ],
      }),
    )}`;
    mockPonderModules([
      {
        rewardPoolId: 1n,
        contentId: 2n,
        asset: 1,
        roundId: 3n,
        title: "USDC bounty",
        allocation: 10_000n,
        eligibleVoters: 1,
        rawEligibleVoters: 1,
        effectiveParticipantUnits: 10000,
        totalClaimWeight: 10000n,
        correlationWeightRoot: null,
        payoutWeightRoot: leaf,
        payoutArtifactUri: artifactUri,
        commitKey: payoutWeight.commitKey,
        identityKey: payoutWeight.identityKey,
        qualified: true,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/question-reward-claim-candidates?voter=0x0000000000000000000000000000000000000001",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      rewardPoolId: "1",
      contentId: "2",
      roundId: "3",
      currency: "USDC",
      requiresPayoutProof: true,
      payoutWeight: {
        domain: 1,
        rewardPoolId: "1",
        contentId: "2",
        roundId: "3",
        commitKey: payoutWeight.commitKey,
        identityKey: payoutWeight.identityKey,
        account: payoutWeight.account,
        baseWeight: "10000",
        independenceBps: 10000,
        effectiveWeight: "10000",
        reasonHash: payoutWeight.reasonHash,
      },
      payoutProof: [],
    });
  });

  it("omits USDC bounty claim candidates when finalized payout proof data is unavailable", async () => {
    mockPonderModules([
      {
        rewardPoolId: 1n,
        contentId: 2n,
        asset: 1,
        roundId: 3n,
        title: "USDC bounty",
        allocation: 10_000n,
        eligibleVoters: 1,
        rawEligibleVoters: 1,
        effectiveParticipantUnits: 10000,
        totalClaimWeight: 10000n,
        correlationWeightRoot: null,
        payoutWeightRoot: `0x${"d".repeat(64)}`,
        payoutArtifactUri: null,
        commitKey: `0x${"a".repeat(64)}`,
        identityKey: `0x${"b".repeat(64)}`,
        qualified: true,
      },
    ]);
    const { registerDataRoutes } = await import(
      "../src/api/routes/data-routes.js"
    );

    const app = new Hono();
    registerDataRoutes(app);

    const response = await app.request(
      "http://localhost/question-reward-claim-candidates?voter=0x0000000000000000000000000000000000000001",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
  });
});

describe("registerCorrelationRoutes", () => {
  it("lists settled reward rounds that still need payout snapshots", async () => {
    const { queryBuilder } = mockPonderModules([
      {
        rewardPoolId: 7n,
        contentId: 9n,
        roundId: 2n,
        requiredVoters: 3,
        requiredSettledRounds: 1,
        qualifiedRounds: 0,
        bountyEligibility: 0,
        bountyClosesAt: 0n,
        settledAt: 123n,
        revealedCount: 1,
        snapshotStatus: null,
      },
    ]);
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-candidates?limit=25",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.innerJoin).toHaveBeenCalled();
    expect(queryBuilder.leftJoin).toHaveBeenCalled();
    expect(queryBuilder.limit).toHaveBeenCalledWith(25);
    const orderByArgs = queryBuilder.orderBy.mock.calls[0] ?? [];
    expect(serializeExpression(orderByArgs[0])).toContain("round.roundId");
    expect(serializeExpression(orderByArgs[1])).toContain(
      "questionRewardPool.id",
    );
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      rewardPoolId: "7",
      contentId: "9",
      roundId: "2",
      bountyEligibility: 0,
    });
    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);
    expect(serialized).toContain("round.state");
    expect(serialized).toContain("roundPayoutSnapshot.id");
    expect(serialized).toContain("round.revealedCount");
    expect(serialized).toContain("questionRewardPool.requiredVoters");
  });

  it("returns eligible revealed vote inputs for correlation scoring", async () => {
    const { db, queryBuilder } = mockPonderModules(
      [
        {
          account: "0x0000000000000000000000000000000000000001",
          voter: "0x0000000000000000000000000000000000000001",
          identityKey: `0x${"a".repeat(64)}`,
          commitKey: `0x${"b".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          features: "",
        },
        {
          account: "0x0000000000000000000000000000000000000002",
          voter: "0x0000000000000000000000000000000000000002",
          identityKey: `0x${"c".repeat(64)}`,
          commitKey: `0x${"d".repeat(64)}`,
          isUp: false,
          stake: 15000000n,
          epochIndex: 1,
          revealWeight: null,
          baseWeight: 10000n,
          verifiedHuman: false,
          historicalVoteCount: 3,
          features: "",
        },
      ],
      [
        [],
        [
          {
            questionMetadataHash: `0x${"2".repeat(64)}`,
            questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
            resultSpecHash: `0x${"3".repeat(64)}`,
            settledAt: 777n,
            targetAudience: JSON.stringify({
              languages: ["de"],
              roles: ["engineer"],
            }),
          },
        ],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    expect(queryBuilder.innerJoin).toHaveBeenCalled();
    expect(queryBuilder.leftJoin).toHaveBeenCalled();
    const body = await response.json();
    expect(body.items[0]).toMatchObject({
      account: "0x0000000000000000000000000000000000000001",
      identityKey: `0x${"a".repeat(64)}`,
      commitKey: `0x${"b".repeat(64)}`,
      isUp: true,
      stake: "25000000",
      epochIndex: 0,
      revealWeight: "25000000",
      baseWeight: "10000",
      verifiedHuman: true,
      features: [`identity:0x${"a".repeat(64)}`],
    });
    expect(body.items[1]).toMatchObject({
      account: "0x0000000000000000000000000000000000000002",
      identityKey: `0x${"c".repeat(64)}`,
      commitKey: `0x${"d".repeat(64)}`,
      isUp: false,
      stake: "15000000",
      epochIndex: 1,
      revealWeight: null,
      baseWeight: "10000",
      verifiedHuman: false,
      features: [`identity:0x${"c".repeat(64)}`],
    });
    expect(body.roundContext).toEqual({
      trailingBaseRateUpBps: 5000,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: `0x${"2".repeat(64)}`,
        questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 0,
    });
    const selection = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(selection).toContain("historicalVoteCount");
    expect(selection).toContain("totalSettledVotes");
    expect(selection).toContain("- 1");
    expect(selection).toContain("vote.isUp");
    expect(selection).toContain("vote.stake");
    expect(selection).toContain("vote.epochIndex");
    expect(selection).toContain("vote.rbtsWeight");
    expect(selection).not.toContain("profileSelfReportHistory");
    const whereArg = queryBuilder.where.mock.calls[0]?.[0];
    const serialized = serializeExpression(whereArg);
    expect(serialized).toContain("vote.revealed");
    expect(serialized).toContain("questionRewardPool.bountyEligibility");
    expect(serialized).toContain("raterHumanCredential.rater");
    const serializedJoins = queryBuilder.leftJoin.mock.calls.map((call) =>
      serializeExpression(call),
    );
    expect(
      serializedJoins.some((join) =>
        join.includes("raterHumanCredential.expiresAt"),
      ),
    ).toBe(true);
    expect(
      serializedJoins.some((join) => join.includes("round.settledAt")),
    ).toBe(true);
  });

  it("excludes raw-address banned voters from correlation scoring inputs", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const nullifierHash = `0x${"1".repeat(64)}` as const;
    const unrelatedIdentityKey = `0x${"a".repeat(64)}` as const;
    expect(unrelatedIdentityKey).not.toBe(testAddressIdentityKey(voter));
    const { queryBuilders } = mockPonderModules(
      [
        {
          account: voter,
          voter,
          identityKey: unrelatedIdentityKey,
          commitKey: `0x${"b".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          features: "",
        },
      ],
      [
        [
          {
            provider: 2,
            nullifierHash,
          },
        ],
        [
          {
            rater: voter,
            provider: 2,
            nullifierHash,
          },
        ],
        [{ settledAt: 777n }],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.excludedVotes).toEqual([
      {
        account: voter,
        identityKey: unrelatedIdentityKey,
        commitKey: `0x${"b".repeat(64)}`,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: ["voter_address_banned"],
        roundOpenTime: null,
      },
    ]);
    expect(serializeExpression(queryBuilders[1]?.where.mock.calls[0]?.[0])).toContain("raterIdentityBan.active");
    expect(serializeExpression(queryBuilders[2]?.where.mock.calls[0]?.[0])).toContain(
      "raterHumanCredential.nullifierHash",
    );
  });

  it("excludes holder-address banned voters from correlation scoring inputs", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const holder = "0x0000000000000000000000000000000000000002";
    const nullifierHash = `0x${"2".repeat(64)}` as const;
    const unrelatedIdentityKey = `0x${"c".repeat(64)}` as const;
    expect(unrelatedIdentityKey).not.toBe(testAddressIdentityKey(voter));
    expect(unrelatedIdentityKey).not.toBe(testAddressIdentityKey(holder));
    const { queryBuilders } = mockPonderModules(
      [
        {
          account: holder,
          voter,
          identityKey: unrelatedIdentityKey,
          commitKey: `0x${"d".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          features: "",
        },
      ],
      [
        [
          {
            provider: 2,
            nullifierHash,
          },
        ],
        [
          {
            rater: holder,
            provider: 2,
            nullifierHash,
          },
        ],
        [{ settledAt: 777n }],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.excludedVotes).toEqual([
      {
        account: holder,
        identityKey: unrelatedIdentityKey,
        commitKey: `0x${"d".repeat(64)}`,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: ["holder_address_banned"],
        roundOpenTime: null,
      },
    ]);
    expect(serializeExpression(queryBuilders[1]?.where.mock.calls[0]?.[0])).toContain("raterIdentityBan.active");
    expect(serializeExpression(queryBuilders[2]?.where.mock.calls[0]?.[0])).toContain(
      "raterHumanCredential.nullifierHash",
    );
  });

  it("reports both voter and holder address ban reasons for delegated correlation votes", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const holder = "0x0000000000000000000000000000000000000002";
    const voterNullifierHash = `0x${"1".repeat(64)}` as const;
    const holderNullifierHash = `0x${"2".repeat(64)}` as const;
    const unrelatedIdentityKey = `0x${"e".repeat(64)}` as const;
    const { queryBuilders } = mockPonderModules(
      [
        {
          account: holder,
          voter,
          identityKey: unrelatedIdentityKey,
          commitKey: `0x${"f".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          features: "",
        },
      ],
      [
        [
          { provider: 2, nullifierHash: voterNullifierHash },
          { provider: 2, nullifierHash: holderNullifierHash },
        ],
        [
          { rater: voter, provider: 2, nullifierHash: voterNullifierHash },
          { rater: holder, provider: 2, nullifierHash: holderNullifierHash },
        ],
        [{ settledAt: 777n }],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.excludedVotes).toEqual([
      {
        account: holder,
        identityKey: unrelatedIdentityKey,
        commitKey: `0x${"f".repeat(64)}`,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: ["voter_address_banned", "holder_address_banned"],
        roundOpenTime: null,
      },
    ]);
    const banWhere = serializeExpression(queryBuilders[1]?.where.mock.calls[0]?.[0]);
    expect(banWhere).toContain("raterIdentityBan.active");
    expect(banWhere).toContain("raterIdentityBan.permanent");
    expect(banWhere).toContain("raterIdentityBan.expiresAt");
    expect(serializeExpression(queryBuilders[2]?.where.mock.calls[0]?.[0])).toContain(
      "raterHumanCredential.nullifierHash",
    );
  });

  it("does not count holder-address banned votes against round-vote pagination", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const holder = "0x0000000000000000000000000000000000000002";
    const eligible = "0x0000000000000000000000000000000000000003";
    const holderNullifierHash = `0x${"2".repeat(64)}` as const;
    const excludedIdentityKey = `0x${"a".repeat(64)}` as const;
    const eligibleIdentityKey = `0x${"b".repeat(64)}` as const;
    mockPonderModules(
      [
        {
          account: holder,
          voter,
          identityKey: excludedIdentityKey,
          commitKey: `0x${"c".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          features: "",
        },
        {
          account: eligible,
          voter: eligible,
          identityKey: eligibleIdentityKey,
          commitKey: `0x${"d".repeat(64)}`,
          isUp: false,
          stake: 15000000n,
          epochIndex: 1,
          revealWeight: 15000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 2,
          features: "",
        },
      ],
      [
        [{ provider: 2, nullifierHash: holderNullifierHash }],
        [{ rater: holder, provider: 2, nullifierHash: holderNullifierHash }],
        [{ settledAt: 777n }],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2&limit=1&offset=0",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.excludedVotes).toEqual([
      {
        account: holder,
        identityKey: excludedIdentityKey,
        commitKey: `0x${"c".repeat(64)}`,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: ["holder_address_banned"],
        roundOpenTime: null,
      },
    ]);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      account: eligible,
      commitKey: `0x${"d".repeat(64)}`,
      identityKey: eligibleIdentityKey,
      payoutEligible: true,
    });
  });

  it("treats target audience as informational for correlation payouts", async () => {
    const cooldown = 7 * 24 * 60 * 60;
    mockPonderModules(
      [
        {
          account: "0x0000000000000000000000000000000000000001",
          voter: "0x0000000000000000000000000000000000000001",
          identityKey: `0x${"a".repeat(64)}`,
          commitKey: `0x${"b".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
          profileSelfReport: JSON.stringify({
            v: 2,
            languages: ["de"],
            roles: ["engineer"],
          }),
          profileUpdatedAt: 100n,
          roundStartTime: BigInt(100 + cooldown),
          targetAudience: JSON.stringify({
            languages: ["de"],
            roles: ["engineer"],
          }),
        },
        {
          account: "0x0000000000000000000000000000000000000002",
          voter: "0x0000000000000000000000000000000000000002",
          identityKey: `0x${"c".repeat(64)}`,
          commitKey: `0x${"d".repeat(64)}`,
          isUp: false,
          stake: 15000000n,
          epochIndex: 1,
          revealWeight: null,
          baseWeight: 10000n,
          verifiedHuman: false,
          historicalVoteCount: 3,
          profileSelfReport: JSON.stringify({
            v: 2,
            languages: ["de"],
            roles: ["engineer"],
          }),
          profileUpdatedAt: BigInt(100 + cooldown),
          roundStartTime: BigInt(100 + cooldown),
          targetAudience: JSON.stringify({
            languages: ["de"],
            roles: ["engineer"],
          }),
        },
        {
          account: "0x0000000000000000000000000000000000000003",
          voter: "0x0000000000000000000000000000000000000003",
          identityKey: `0x${"e".repeat(64)}`,
          commitKey: `0x${"f".repeat(64)}`,
          isUp: false,
          stake: 15000000n,
          epochIndex: 1,
          revealWeight: null,
          baseWeight: 10000n,
          verifiedHuman: false,
          historicalVoteCount: 3,
          profileSelfReport: JSON.stringify({
            v: 2,
            languages: ["en"],
            roles: ["operator"],
          }),
          profileUpdatedAt: 100n,
          roundStartTime: BigInt(100 + cooldown),
          targetAudience: JSON.stringify({
            languages: ["de"],
            roles: ["engineer"],
          }),
        },
      ],
      [[], [{ settledAt: 777n }], []],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(3);
    expect(
      body.items.map((item: { account: string; payoutEligible: boolean }) => ({
        account: item.account,
        payoutEligible: item.payoutEligible,
      })),
    ).toEqual([
      {
        account: "0x0000000000000000000000000000000000000001",
        payoutEligible: true,
      },
      {
        account: "0x0000000000000000000000000000000000000002",
        payoutEligible: true,
      },
      {
        account: "0x0000000000000000000000000000000000000003",
        payoutEligible: true,
      },
    ]);
    for (const item of body.items) {
      expect(item).not.toHaveProperty("targetAudience");
      expect(item).not.toHaveProperty("profileSelfReport");
    }
    expect(body.excludedVotes).toEqual([]);
  });

  it("computes the trailing base rate from prior settled round pools", async () => {
    mockPonderModules(
      [],
      [
        [{ settledAt: 777n }],
        [
          { upPool: 600n, downPool: 400n },
          { upPool: 150n, downPool: 50n },
        ],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // sum(upPool) * 10000 / sum(upPool + downPool) = 750 * 10000 / 1200 = 6250
    expect(body.roundContext).toEqual({
      trailingBaseRateUpBps: 6250,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: null,
        questionMetadataUri: null,
        resultSpecHash: null,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 2,
    });
  });

  it("clamps the trailing base rate to [500, 9500]", async () => {
    mockPonderModules(
      [],
      [
        [{ settledAt: 777n }],
        [{ upPool: 999n, downPool: 1n }],
        [],
        [{ settledAt: 777n }],
        [{ upPool: 1n, downPool: 999n }],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const highResponse = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );
    expect(highResponse.status).toBe(200);
    const highBody = await highResponse.json();
    // raw 9990 bps clamps down to 9500
    expect(highBody.roundContext).toEqual({
      trailingBaseRateUpBps: 9500,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: null,
        questionMetadataUri: null,
        resultSpecHash: null,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 1,
    });

    const lowResponse = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );
    expect(lowResponse.status).toBe(200);
    const lowBody = await lowResponse.json();
    // raw 10 bps clamps up to 500
    expect(lowBody.roundContext).toEqual({
      trailingBaseRateUpBps: 500,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: null,
        questionMetadataUri: null,
        resultSpecHash: null,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 1,
    });
  });

  it("falls back to a neutral base rate when the window is empty or pools sum to zero", async () => {
    mockPonderModules(
      [],
      [
        [{ settledAt: 777n }],
        [],
        [],
        [{ settledAt: 777n }],
        [{ upPool: 0n, downPool: 0n }],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const emptyResponse = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );
    expect(emptyResponse.status).toBe(200);
    const emptyBody = await emptyResponse.json();
    expect(emptyBody.roundContext).toEqual({
      trailingBaseRateUpBps: 5000,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: null,
        questionMetadataUri: null,
        resultSpecHash: null,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 0,
    });

    const zeroSumResponse = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );
    expect(zeroSumResponse.status).toBe(200);
    const zeroSumBody = await zeroSumResponse.json();
    expect(zeroSumBody.roundContext).toEqual({
      trailingBaseRateUpBps: 5000,
      baseRateWindowRounds: 100,
      questionMetadataRef: {
        questionMetadataHash: null,
        questionMetadataUri: null,
        resultSpecHash: null,
        targetAudienceHash: null,
      },
      settledRoundsInWindow: 1,
    });
  });

  it("excludes rounds settled after the requested round from the base-rate window", async () => {
    const { queryBuilders } = mockPonderModules(
      [],
      [[{ settledAt: 777n }], [{ upPool: 100n, downPool: 100n }]],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=7&contentId=9&roundId=2",
    );
    expect(response.status).toBe(200);

    // The requested round's own (settledAt, contentId, roundId) tuple is looked up first.
    const lookupBuilder = queryBuilders[1]!;
    const lookupWhere = serializeExpression(
      lookupBuilder.where.mock.calls[0]?.[0],
    );
    expect(lookupWhere).toContain("round.contentId");
    expect(lookupWhere).toContain("round.roundId");
    expect(lookupWhere).toContain("round.state");

    // The window only admits rounds with a strictly smaller (settledAt, contentId, roundId)
    // tuple, so rounds settled after the requested round (greater tuple) are excluded.
    const windowBuilder = queryBuilders[2]!;
    const windowWhere = serializeExpression(
      windowBuilder.where.mock.calls[0]?.[0],
    );
    expect(windowWhere).toContain("round.state");
    expect(windowWhere).toContain("round.settledAt");
    expect(windowWhere).toContain(") < (");
    expect(windowWhere).toContain("777");
    expect(windowWhere).toContain("9");
    expect(windowWhere).toContain("2");
    const orderByArgs = windowBuilder.orderBy.mock.calls[0] ?? [];
    expect(serializeExpression(orderByArgs[0])).toContain("round.settledAt");
    expect(serializeExpression(orderByArgs[1])).toContain("round.contentId");
    expect(serializeExpression(orderByArgs[2])).toContain("round.roundId");
    expect(orderByArgs.map((arg: any) => arg?.kind)).toEqual([
      "desc",
      "desc",
      "desc",
    ]);
    expect(windowBuilder.limit).toHaveBeenCalledWith(100);
  });

  it("validates correlation round-vote identifiers", async () => {
    mockPonderModules([]);
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/round-votes?rewardPoolId=0&contentId=9&roundId=2",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "rewardPoolId, contentId, and roundId must be positive integers",
    });
  });

  it("excludes voter-address banned voters from rating correlation scoring inputs", async () => {
    const voter = "0x0000000000000000000000000000000000000001";
    const nullifierHash = `0x${"2".repeat(64)}` as const;
    const unrelatedIdentityKey = `0x${"a".repeat(64)}` as const;
    const { queryBuilders } = mockPonderModules(
      [
        {
          account: voter,
          voter,
          identityKey: unrelatedIdentityKey,
          commitKey: `0x${"b".repeat(64)}`,
          isUp: true,
          stake: 25000000n,
          epochIndex: 0,
          revealWeight: 25000000n,
          baseWeight: 10000n,
          verifiedHuman: true,
          historicalVoteCount: 0,
        },
      ],
      [
        [
          {
            provider: 2,
            nullifierHash,
          },
        ],
        [
          {
            rater: voter,
            provider: 2,
            nullifierHash,
          },
        ],
        [{ settledAt: 777n }],
        [],
      ],
    );
    const { registerCorrelationRoutes } = await import(
      "../src/api/routes/correlation-routes.js"
    );

    const app = new Hono();
    registerCorrelationRoutes(app);

    const response = await app.request(
      "http://localhost/correlation/rating-round-votes?contentId=9&roundId=2&now=1000",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toEqual([]);
    expect(body.excludedVotes).toEqual([
      {
        account: voter,
        identityKey: unrelatedIdentityKey,
        commitKey: `0x${"b".repeat(64)}`,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: ["voter_address_banned"],
        roundOpenTime: null,
      },
    ]);
    expect(serializeExpression(queryBuilders[1]?.where.mock.calls[0]?.[0])).toContain("raterIdentityBan.active");
  });
});

describe("registerKeeperRoutes", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("rejects malformed keeper work deadlines", async () => {
    mockPonderModules([]);
    const { registerKeeperRoutes } = await import(
      "../src/api/routes/keeper-routes.js"
    );
    const app = new Hono();
    registerKeeperRoutes(app);

    const response = await app.request(
      "http://localhost/keeper/work?now=abc&dormancyPeriod=60",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "now and dormancyPeriod must be non-negative integer seconds",
    });
  });

  it("requires keeper work token in production when PONDER_KEEPER_WORK_TOKEN is unset", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousToken = process.env.PONDER_KEEPER_WORK_TOKEN;
    process.env.NODE_ENV = "production";
    delete process.env.PONDER_KEEPER_WORK_TOKEN;

    try {
      mockPonderModules([]);
      const { registerKeeperRoutes } = await import(
        "../src/api/routes/keeper-routes.js"
      );
      const app = new Hono();
      registerKeeperRoutes(app);

      const response = await app.request(
        "http://localhost/keeper/work?now=100&dormancyPeriod=60&limit=5",
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "PONDER_KEEPER_WORK_TOKEN is required in production.",
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousToken === undefined) {
        delete process.env.PONDER_KEEPER_WORK_TOKEN;
      } else {
        process.env.PONDER_KEEPER_WORK_TOKEN = previousToken;
      }
    }
  });

  it("rejects invalid keeper work bearer tokens in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousToken = process.env.PONDER_KEEPER_WORK_TOKEN;
    process.env.NODE_ENV = "production";
    process.env.PONDER_KEEPER_WORK_TOKEN = "expected-token";

    try {
      mockPonderModules([]);
      const { registerKeeperRoutes } = await import(
        "../src/api/routes/keeper-routes.js"
      );
      const app = new Hono();
      registerKeeperRoutes(app);

      const response = await app.request(
        "http://localhost/keeper/work?now=100&dormancyPeriod=60&limit=5",
        {
          headers: { authorization: "Bearer wrong-token" },
        },
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid keeper work token.",
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousToken === undefined) {
        delete process.env.PONDER_KEEPER_WORK_TOKEN;
      } else {
        process.env.PONDER_KEEPER_WORK_TOKEN = previousToken;
      }
    }
  });

  it("returns keeper work candidates as JSON-safe strings", async () => {
    mockPonderModules(
      [{ contentId: 9n, roundId: 2n, reason: "settle" }],
      [
        [{ contentId: 9n, roundId: 2n, reason: "cleanup" }],
        [{ contentId: 9n, reason: "dormant" }],
        [
          {
            poolId: 3n,
            contentId: 9n,
            roundId: 2n,
            awardDeadline: 90n,
            remainingAmount: 1_000_000n,
            reason: "feedback_bonus_forfeit",
          },
        ],
      ],
    );
    const { registerKeeperRoutes } = await import(
      "../src/api/routes/keeper-routes.js"
    );
    const app = new Hono();
    registerKeeperRoutes(app);

    const response = await app.request(
      "http://localhost/keeper/work?now=100&dormancyPeriod=60&limit=5",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "ponder",
      openRounds: [{ contentId: "9", roundId: "2", reason: "settle" }],
      cleanupRounds: [{ contentId: "9", roundId: "2", reason: "cleanup" }],
      dormantContent: [{ contentId: "9", reason: "dormant" }],
      feedbackBonusForfeits: [
        {
          poolId: "3",
          contentId: "9",
          roundId: "2",
          awardDeadline: "90",
          remainingAmount: "1000000",
          reason: "feedback_bonus_forfeit",
        },
      ],
    });
  });

  it("filters feedback bonus forfeits to expired pools that are not started open rounds", async () => {
    const { queryBuilders } = mockPonderModules([], [[], [], []]);
    const { registerKeeperRoutes } = await import(
      "../src/api/routes/keeper-routes.js"
    );
    const app = new Hono();
    registerKeeperRoutes(app);

    const response = await app.request(
      "http://localhost/keeper/work?now=100&dormancyPeriod=60&feedbackBonusForfeitMinAge=5&limit=5",
    );

    expect(response.status).toBe(200);
    const feedbackBonusBuilder = queryBuilders[3]!;
    expect(feedbackBonusBuilder.leftJoin).toHaveBeenCalled();
    expect(feedbackBonusBuilder.limit).toHaveBeenCalledWith(5);

    const serializedWhere = serializeExpression(
      feedbackBonusBuilder.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("feedbackBonusPool.forfeited");
    expect(serializedWhere).toContain("feedbackBonusPool.remainingAmount");
    expect(serializedWhere).toContain("feedbackBonusPool.awardDeadline");
    expect(serializedWhere).toContain("round.contentId");
    expect(serializedWhere).toContain("round.state");
    expect(serializedWhere).toContain("round.startTime");
    expect(serializedWhere).toContain("<");

    const serializedOrderBy = serializeExpression(
      feedbackBonusBuilder.orderBy.mock.calls[0],
    );
    expect(serializedOrderBy).toContain("feedbackBonusPool.awardDeadline");
    expect(serializedOrderBy).toContain("feedbackBonusPool.id");
  });

  it("uses humanVerifiedCommitCount quorum for reveal_failed keeper hints", async () => {
    const { db, queryBuilders } = mockPonderModules([], [[], [], []]);
    const { registerKeeperRoutes } = await import(
      "../src/api/routes/keeper-routes.js"
    );
    const app = new Hono();
    registerKeeperRoutes(app);

    const response = await app.request(
      "http://localhost/keeper/work?now=100&dormancyPeriod=60&limit=5",
    );

    expect(response.status).toBe(200);
    const serializedSelect = serializeExpression(db.select.mock.calls[0]?.[0]);
    expect(serializedSelect).toContain("round.humanVerifiedCommitCount");
    expect(serializedSelect).toContain("greatest");
    expect(queryBuilders[0]?.from).toHaveBeenCalled();
  });

  it("matches isDormancyBlocked quorum for dormant content candidates", async () => {
    const { queryBuilders } = mockPonderModules([], [[], [], []]);
    const { registerKeeperRoutes } = await import(
      "../src/api/routes/keeper-routes.js"
    );
    const app = new Hono();
    registerKeeperRoutes(app);

    const response = await app.request(
      "http://localhost/keeper/work?now=100&dormancyPeriod=60&limit=5",
    );

    expect(response.status).toBe(200);
    const serializedWhere = serializeExpression(
      queryBuilders[2]?.where.mock.calls[0]?.[0],
    );
    expect(serializedWhere).toContain("round.revealedCount");
    expect(serializedWhere).toContain("round.minVoters");
    expect(serializedWhere).toContain("round.humanVerifiedCommitCount");
    expect(serializedWhere).not.toContain("greatest");
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

  it("matches delegated voter identities in discovery queries", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/discover-signals/0x0000000000000000000000000000000000000001?watched=1,2",
    );

    expect(response.status).toBe(200);

    const serializedWhereCalls = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(
      serializedWhereCalls.some(
        (value) =>
          value.includes("vote.voter") && value.includes("vote.identityHolder"),
      ),
    ).toBe(true);
  });

  it("honors explicit followed addresses in discovery queries", async () => {
    const { queryBuilder } = mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/discover-signals/0x0000000000000000000000000000000000000001?followed=0x0000000000000000000000000000000000000003",
    );

    expect(response.status).toBe(200);

    const serializedWhereCalls = queryBuilder.where.mock.calls.map(([value]) =>
      serializeExpression(value),
    );
    expect(
      serializedWhereCalls.some((value) =>
        value.includes("0x0000000000000000000000000000000000000003"),
      ),
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

  it("redacts gated undisclosed context from featured previews", async () => {
    mockPonderModules(
      [
        {
          id: "42-1",
          contentId: 42n,
          roundId: 1n,
          description: "Sensitive featured copy.",
          title: "Public-safe private context title",
          url: "https://rateloop.ai/api/attachments/details/det_privatecontext3",
          submitter: "0x0000000000000000000000000000000000000001",
          categoryId: 1n,
          voteCount: 3,
          minVoters: 3,
          totalStake: 10n,
          roundStartTime: 100n,
          profileName: "Submitter",
          ...gatedConfidentialityFields(),
        },
      ],
      [[]],
    );
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request("http://localhost/featured-today");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      contextAccess: "gated",
      description: "",
      featuredReason: "Active debate",
      url: "",
    });
    expect(body.items[0]).not.toHaveProperty("gated");
    expect(body.items[0]).not.toHaveProperty("questionMetadata");
  });

  it("rejects malformed discover-signals now timestamps", async () => {
    mockPonderModules([]);
    const { registerDiscoveryRoutes } = await import(
      "../src/api/routes/discovery-routes.js"
    );

    const app = new Hono();
    registerDiscoveryRoutes(app);

    const response = await app.request(
      "http://localhost/discover-signals/0x0000000000000000000000000000000000000001?now=abc",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "now must be a non-negative integer",
    });
  });
});

describe("shared settlement helpers", () => {
  it("uses reveal-failed grace multiplier when the round is reveal-failed eligible", async () => {
    const {
      getEstimatedRevealFailedTime,
      getEstimatedSettlementTime,
      getOpenRoundEstimatedResolutionTime,
    } = await import("../src/api/shared.js");

    const row = {
      startTime: 1_000n,
      epochDuration: 600,
      maxDuration: 1_200,
      minVoters: 3,
      voteCount: 4,
      revealedCount: 1,
      humanVerifiedCommitCount: 3,
      lastCommitRevealableAfter: 1_500n,
      revealGracePeriod: 60n,
    };

    expect(getEstimatedSettlementTime(row.startTime, row.epochDuration, row.revealGracePeriod)).toBe(
      1_660n,
    );
    expect(
      getEstimatedRevealFailedTime(
        row.startTime,
        row.maxDuration,
        row.lastCommitRevealableAfter,
        row.revealGracePeriod,
      ),
    ).toBe(3_640n);
    expect(getOpenRoundEstimatedResolutionTime(row)).toBe(3_640n);
  });
});
