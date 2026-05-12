import assert from "node:assert/strict";
import test from "node:test";
import { createCuryoClient } from "./client";
import { CuryoApiError, CuryoSdkError } from "./errors";
import { createCuryoReadClient } from "./read";

test("createCuryoClient exposes a read client with normalized base URL", () => {
  const client = createCuryoClient({
    apiBaseUrl: "https://api.curyo.xyz///",
  });

  assert.equal(client.config.apiBaseUrl, "https://api.curyo.xyz");
  assert.ok(client.read);
});

test("searchContent forwards query params to the hosted API", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({ items: [], total: 0, limit: 10, offset: 20 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  const response = await read.searchContent({
    status: "1",
    sortBy: "most_votes",
    limit: 10,
    offset: 20,
  });

  assert.equal(response.total, 0);
  assert.match(requestedUrl, /\/content\?/);
  assert.match(requestedUrl, /status=1/);
  assert.match(requestedUrl, /sortBy=most_votes/);
  assert.match(requestedUrl, /limit=10/);
  assert.match(requestedUrl, /offset=20/);
});

test("getProfiles joins addresses into the expected batch query", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    timeoutMs: 5_000,
  });

  await read.getProfiles([
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ]);

  assert.match(
    requestedUrl,
    /addresses=0x1111111111111111111111111111111111111111%2C0x2222222222222222222222222222222222222222/,
  );
});

test("getFollows and getFollowers request the public follow routes", async () => {
  const requestedUrls: string[] = [];
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [],
          count: 0,
          followerCount: 3,
          followingCount: 2,
          limit: 10,
          offset: 5,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  const follows = await read.getFollows(
    "0x1111111111111111111111111111111111111111",
    { limit: 10, offset: 5 },
  );
  const followers = await read.getFollowers(
    "0x1111111111111111111111111111111111111111",
    { limit: 10, offset: 5 },
  );

  assert.equal(follows.followingCount, 2);
  assert.equal(followers.followerCount, 3);
  assert.match(
    requestedUrls[0] ?? "",
    /\/follows\/0x1111111111111111111111111111111111111111\?limit=10&offset=5$/,
  );
  assert.match(
    requestedUrls[1] ?? "",
    /\/followers\/0x1111111111111111111111111111111111111111\?limit=10&offset=5$/,
  );
});

test("getAccuracyLeaderboard can include reputation blocks", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          items: [
            {
              voter: "0x1111111111111111111111111111111111111111",
              totalSettledVotes: 10,
              totalWins: 7,
              totalLosses: 3,
              totalStakeWon: "12",
              totalStakeLost: "4",
              profileName: "Ada",
              winRate: 0.7,
              reputation: {
                raterType: 1,
                raterTypeName: "Human",
                credentialStatus: "verified",
                clusterId: "cluster-1",
                discountBps: 2500,
                independenceMultiplierBps: 7500,
                clusterChallengeStatus: "open",
                clusterChallengeStatusCode: 1,
                activeTrustAttestationCount: 4,
                followerCount: 3,
                followingCount: 2,
                aiTier: 0,
                aiTierName: "A0",
              },
            },
          ],
          window: "all",
          startsAt: null,
          endsAt: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  const response = await read.getAccuracyLeaderboard({
    includeReputation: true,
    minSignalVotes: 5,
  });

  assert.equal(response.items[0]?.reputation?.followerCount, 3);
  assert.equal(response.items[0]?.reputation?.aiTierName, "A0");
  assert.match(requestedUrl, /\/accuracy-leaderboard\?/);
  assert.match(requestedUrl, /includeReputation=true/);
  assert.match(requestedUrl, /minSignalVotes=5/);
});

test("getProfile exposes social counts from profile detail", async () => {
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          profile: null,
          summary: {
            totalVotes: 7,
            totalContent: 5,
            totalRewardsClaimed: "42",
          },
          social: {
            followerCount: 3,
            followingCount: 2,
          },
          recentVotes: [],
          recentRewards: [],
          recentSubmissions: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    timeoutMs: 5_000,
  });

  const response = await read.getProfile(
    "0x1111111111111111111111111111111111111111",
  );

  assert.deepEqual(response.social, {
    followerCount: 3,
    followingCount: 2,
  });
});

test("getRaterRewardStatus requests the typed reward-status route", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          asOf: {
            chainTimestamp: "1000",
            wallTimestamp: "1000",
            indexedBlockNumber: null,
          },
          rater: "0x1111111111111111111111111111111111111111",
          raterType: 2,
          raterTypeName: "AI",
          selfCredential: {
            verified: false,
            legacy: false,
            revoked: false,
            status: "missing",
            verifiedAt: null,
            expiresAt: null,
            multiplierBps: 10000,
            evidenceHash: null,
          },
          aiDeclaration: {
            declared: true,
            active: true,
            inactiveReason: "none",
            operator: "0x2222222222222222222222222222222222222222",
            version: 1,
            effectiveEpoch: "1",
            expiresAtEpoch: "0",
            effectiveAt: "1",
            expiresAt: null,
            declaredTier: 2,
            declaredTierName: "A1Verified",
            effectiveTier: 2,
            effectiveTierName: "A1Verified",
            tier: 2,
            tierName: "A1Verified",
            tierMultiplierBps: 11500,
            behaviorChanged: false,
            probePending: false,
            probeStatus: "passed",
            declarationHash: null,
            modelClass: 1,
            modelId: null,
            provider: null,
            promptTemplateHash: null,
            retrievalConfigHash: null,
            toolingHash: null,
            disclosure: 1,
            declaredAt: "1000",
            retiredAt: null,
            lastProbeResultHash: null,
            latestProbe: null,
          },
          challengeStatus: {
            openCount: 0,
            latestChallengeId: null,
            latestStatus: 0,
            latestResolvedAt: null,
            latestOperatorSlash: "0",
            latestChallengerReward: "0",
          },
          independence: {
            clusterId: "cluster-1",
            discountBps: 2500,
            independenceMultiplierBps: 7500,
            scorerEpoch: "42",
            updatedAt: "1000",
            algorithmHash: null,
            modelVersionHash: null,
            scoreRoot: null,
            evidenceHash: null,
            challengeWindowEndsAt: null,
            scoreKey: null,
            openChallengeCount: 1,
            latestChallengeId: "7",
            latestChallengeStatus: 1,
            latestChallengeStatusName: "open",
            latestChallengeOpenedAt: "1000",
            latestChallengeResolvedAt: null,
            latestChallengeResolutionHash: null,
          },
          trust: {
            activeSeed: null,
            activeInboundAttestationCount: 4,
            activeInboundTrustBudgetTotal: "400",
            latestInboundAttestations: [],
          },
          launchRewards: {
            eligible: true,
            qualifyingRatingCount: 6,
            rewardedRatingCount: 4,
            distinctVerifiedAnchorCount: 2,
            distinctAnchorRoundCount: 3,
            launchCap: "100",
            launchPaid: "25",
            remainingLaunchCap: "75",
            remainingRewardSlots: 6,
            cohortIndex: 1,
            latestCreditedAt: "1000",
            latestPaidAt: "1001",
            policy: {
              minQualifyingScoreBps: 7000,
              minDistinctVerifiedAnchors: 2,
            },
          },
          rewardPolicy: {
            baseMultiplierBps: 10000,
            clusterDiscountBps: 2500,
            independenceMultiplierBps: 7500,
            humanCredentialMultiplierBps: 10000,
            agentTierMultiplierBps: 11500,
            effectiveRewardWeightBps: 9000,
            combinedMultiplierBps: 11500,
            combinedMultiplierCapBps: 12500,
            verifiedAgentsCanAnchorLaunchRewards: false,
            verifiedAgentSignupBonusEligible: false,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  const response = await read.getRaterRewardStatus(
    "0x1111111111111111111111111111111111111111",
  );

  assert.match(
    requestedUrl,
    /\/rater-reward-status\/0x1111111111111111111111111111111111111111$/,
  );
  assert.equal(response.aiDeclaration.tierName, "A1Verified");
  assert.equal(response.independence.latestChallengeStatusName, "open");
  assert.equal(response.trust.activeInboundTrustBudgetTotal, "400");
  assert.equal(response.launchRewards.remainingLaunchCap, "75");
  assert.equal(
    response.rewardPolicy.verifiedAgentsCanAnchorLaunchRewards,
    false,
  );
  assert.equal(response.rewardPolicy.effectiveRewardWeightBps, 9000);
});

test("AI rater read helpers request declaration productization routes", async () => {
  const requestedUrls: string[] = [];
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ items: [], limit: 10, offset: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    timeoutMs: 5_000,
  });

  await read.listAiRaterDeclarations({
    operator: "0x2222222222222222222222222222222222222222",
    tier: 2,
    probePending: false,
    limit: 10,
  });
  await read.getAiRaterDeclaration(
    "0x1111111111111111111111111111111111111111",
  );
  await read.getAiRaterDeclarationHistory(
    "0x1111111111111111111111111111111111111111",
    { version: 3, limit: 5, offset: 10 },
  );
  await read.getAiRaterProbeResults(
    "0x1111111111111111111111111111111111111111",
    { passed: true },
  );
  await read.getAiRaterDriftFlags("0x1111111111111111111111111111111111111111");
  await read.getAiRaterDeclarationChallenges(
    "0x1111111111111111111111111111111111111111",
    { status: 1 },
  );

  assert.match(
    requestedUrls[0] ?? "",
    /\/ai-rater-declarations\?operator=0x2222222222222222222222222222222222222222&tier=2&probePending=false&limit=10$/,
  );
  assert.match(
    requestedUrls[1] ?? "",
    /\/ai-rater-declarations\/0x1111111111111111111111111111111111111111$/,
  );
  assert.match(
    requestedUrls[2] ?? "",
    /\/ai-rater-declarations\/0x1111111111111111111111111111111111111111\/history\?version=3&limit=5&offset=10$/,
  );
  assert.match(
    requestedUrls[3] ?? "",
    /\/ai-rater-declarations\/0x1111111111111111111111111111111111111111\/probes\?passed=true$/,
  );
  assert.match(
    requestedUrls[4] ?? "",
    /\/ai-rater-declarations\/0x1111111111111111111111111111111111111111\/drift-flags$/,
  );
  assert.match(
    requestedUrls[5] ?? "",
    /\/ai-rater-declarations\/0x1111111111111111111111111111111111111111\/challenges\?status=1$/,
  );
});

test("getAiRaterOperatorBond requests the operator bond route", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          bond: {
            operator: "0x2222222222222222222222222222222222222222",
            totalBond: "0",
            bondAsset: "USDC",
            bondDecimals: 6,
            updatedAt: null,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  const response = await read.getAiRaterOperatorBond(
    "0x2222222222222222222222222222222222222222",
  );

  assert.match(
    requestedUrl,
    /\/ai-rater-operators\/0x2222222222222222222222222222222222222222\/bond$/,
  );
  assert.equal(response.bond.totalBond, "0");
  assert.equal(response.bond.bondAsset, "USDC");
  assert.equal(response.bond.bondDecimals, 6);
});

test("read client surfaces API errors with status codes", async () => {
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "Frontend not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    timeoutMs: 5_000,
  });

  await assert.rejects(
    () => read.getFrontend("0x3333333333333333333333333333333333333333"),
    (error: unknown) => {
      assert.ok(error instanceof CuryoApiError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "Frontend not found");
      return true;
    },
  );
});

test("read client requires an apiBaseUrl", async () => {
  const read = createCuryoReadClient({
    apiBaseUrl: undefined,
    fetchImpl: fetch,
    timeoutMs: 5_000,
  });

  await assert.rejects(
    () => read.getStats(),
    (error: unknown) => {
      assert.ok(error instanceof CuryoSdkError);
      assert.equal(error.message, "apiBaseUrl is required for read operations");
      return true;
    },
  );
});
