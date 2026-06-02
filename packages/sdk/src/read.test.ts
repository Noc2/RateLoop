import assert from "node:assert/strict";
import test from "node:test";
import { createRateLoopClient } from "./client";
import { RateLoopApiError, RateLoopSdkError } from "./errors";
import { createRateLoopReadClient } from "./read";

test("createRateLoopClient exposes a read client with normalized base URL", () => {
  const client = createRateLoopClient({
    apiBaseUrl: "https://api.rateloop.ai///",
  });

  assert.equal(client.config.apiBaseUrl, "https://api.rateloop.ai");
  assert.ok(client.read);
});

test("searchContent forwards query params to the hosted API", async () => {
  let requestedUrl = "";
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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
    contentIds: ["1", 2n],
    status: "1",
    submitters: [
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ],
    sortBy: "highest_rewards",
    limit: 10,
    offset: 20,
  });

  assert.equal(response.total, 0);
  assert.match(requestedUrl, /\/content\?/);
  assert.match(requestedUrl, /contentIds=1%2C2/);
  assert.match(requestedUrl, /status=1/);
  assert.match(
    requestedUrl,
    /submitters=0x1111111111111111111111111111111111111111%2C0x2222222222222222222222222222222222222222/,
  );
  assert.match(requestedUrl, /sortBy=highest_rewards/);
  assert.match(requestedUrl, /limit=10/);
  assert.match(requestedUrl, /offset=20/);
});

test("searchContent forwards relevance sorting", async () => {
  let requestedUrl = "";
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({ items: [], total: 0, limit: 10, offset: 0 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
    timeoutMs: 5_000,
  });

  await read.searchContent({ search: "rbts", sortBy: "relevance" });

  assert.match(requestedUrl, /search=rbts/);
  assert.match(requestedUrl, /sortBy=relevance/);
});

test("getProfiles joins addresses into the expected batch query", async () => {
  let requestedUrl = "";
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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

test("getCategories exposes current category fields", async () => {
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: "1",
              name: "Protocol",
              slug: "protocol",
              createdAt: "123",
              totalVotes: 7,
              totalContent: 3,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    timeoutMs: 5_000,
  });

  const response = await read.getCategories();

  assert.equal(response.items[0]?.slug, "protocol");
  assert.equal(response.items[0]?.totalContent, 3);
});

test("listFrontends exposes current frontend fields", async () => {
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              address: "0x1111111111111111111111111111111111111111",
              operator: "0x2222222222222222222222222222222222222222",
              stakedAmount: "1000",
              eligible: true,
              slashed: false,
              exitAvailableAt: null,
              totalFeesCredited: "50",
              totalFeesClaimed: "10",
              registeredAt: "123",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    timeoutMs: 5_000,
  });

  const response = await read.listFrontends();

  assert.equal(response.items[0]?.operator, "0x2222222222222222222222222222222222222222");
  assert.equal(response.items[0]?.stakedAmount, "1000");
  assert.equal(response.items[0]?.totalFeesCredited, "50");
});

test("getAccuracyLeaderboard can include reputation blocks", async () => {
  let requestedUrl = "";
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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
                humanCredentialStatus: "verified",
                participationLane: "verified_human",
                followerCount: 3,
                followingCount: 2,
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
  assert.match(requestedUrl, /\/accuracy-leaderboard\?/);
  assert.match(requestedUrl, /includeReputation=true/);
  assert.match(requestedUrl, /minSignalVotes=5/);
});

test("getProfile exposes social counts from profile detail", async () => {
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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

test("getRaterParticipationStatus requests the typed participation-status route", async () => {
  let requestedUrl = "";
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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
          raterType: 1,
          raterTypeName: "Human",
          participationLane: "verified_human",
          humanCredential: {
            verified: true,
            revoked: false,
            status: "verified",
            verifiedAt: "999",
            expiresAt: null,
            evidenceHash: null,
          },
          launchRewards: {
            eligible: true,
            qualifyingRatingCount: 6,
            rewardedRatingCount: 4,
            distinctVerifiedAnchorCount: 2,
            distinctAnchorRoundCount: 3,
            launchCap: "100",
            fullLaunchCap: "400",
            capBps: 2500,
            fullCapUnlocked: false,
            launchPaid: "25",
            remainingLaunchCap: "75",
            unlockableLaunchCap: "300",
            remainingRewardSlots: 6,
            cohortIndex: 1,
            latestCreditedAt: "1000",
            latestPaidAt: "1001",
            policy: {
              minQualifyingScoreBps: 7000,
              minDistinctVerifiedAnchors: 2,
            },
          },
          participationPolicy: {
            baseRewardWeightBps: 10000,
            humanVerificationAffectsRewardWeight: false,
            verifiedHumanCountsAsLaunchAnchor: true,
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

  const response = await read.getRaterParticipationStatus(
    "0x1111111111111111111111111111111111111111",
  );

  assert.match(
    requestedUrl,
    /\/rater-participation-status\/0x1111111111111111111111111111111111111111$/,
  );
  assert.equal(response.participationLane, "verified_human");
  assert.equal(response.humanCredential.status, "verified");
  assert.equal(response.launchRewards.remainingLaunchCap, "75");
  assert.equal(response.launchRewards.unlockableLaunchCap, "300");
  assert.equal(response.participationPolicy.baseRewardWeightBps, 10000);
});

test("read client surfaces API errors with status codes", async () => {
  const read = createRateLoopReadClient({
    apiBaseUrl: "https://api.rateloop.ai",
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
      assert.ok(error instanceof RateLoopApiError);
      assert.equal(error.status, 404);
      assert.equal(error.message, "Frontend not found");
      return true;
    },
  );
});

test("read client requires an apiBaseUrl", async () => {
  const read = createRateLoopReadClient({
    apiBaseUrl: undefined,
    fetchImpl: fetch,
    timeoutMs: 5_000,
  });

  await assert.rejects(
    () => read.getStats(),
    (error: unknown) => {
      assert.ok(error instanceof RateLoopSdkError);
      assert.equal(error.message, "apiBaseUrl is required for read operations");
      return true;
    },
  );
});
