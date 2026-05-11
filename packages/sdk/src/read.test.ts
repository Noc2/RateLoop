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
      return new Response(JSON.stringify({ items: [], total: 0, limit: 10, offset: 20 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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

test("getRaterRewardStatus requests the typed reward-status route", async () => {
  let requestedUrl = "";
  const read = createCuryoReadClient({
    apiBaseUrl: "https://api.curyo.xyz",
    fetchImpl: async (input: URL | RequestInfo) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
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
          rewardPolicy: {
            baseMultiplierBps: 10000,
            humanCredentialMultiplierBps: 10000,
            agentTierMultiplierBps: 11500,
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

  const response = await read.getRaterRewardStatus("0x1111111111111111111111111111111111111111");

  assert.match(requestedUrl, /\/rater-reward-status\/0x1111111111111111111111111111111111111111$/);
  assert.equal(response.aiDeclaration.tierName, "A1Verified");
  assert.equal(response.rewardPolicy.verifiedAgentsCanAnchorLaunchRewards, false);
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
