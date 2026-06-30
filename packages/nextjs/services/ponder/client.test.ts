import {
  PonderMetadataSyncRequiredError,
  PonderQuestionMetadataSyncError,
  __getPonderAvailabilityCacheSizeForTests,
  __setSupportedPonderDeploymentKeysForTests,
  assertPonderQuestionMetadataSyncComplete,
  fetchPonderJson,
  getPonderAvailabilityStatus,
  invalidatePonderCache,
  isPonderAvailable,
  isPonderMetadataSyncRequiredError,
  normalizeSupportedPonderDeploymentKey,
  ponderApi,
  resolvePonderUrl,
  shouldBypassPonderAvailabilityPreflightForConfig,
} from "./client";
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveContentDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const TEST_PONDER_DEPLOYMENT = resolveProtocolDeploymentScope(31337);
const BASE_SEPOLIA_PONDER_DEPLOYMENT = resolveProtocolDeploymentScope(84532);

function isPonderPreflightUrl(url: string) {
  return /\/(?:health|deployment)$/.test(url);
}

function healthyPonderPreflightResponseForDeployment(
  url: string,
  deployment: NonNullable<ReturnType<typeof resolveProtocolDeploymentScope>>,
): Response | null {
  if (url.endsWith("/health")) {
    return new Response("ok", { status: 200 });
  }
  if (url.endsWith("/deployment")) {
    return new Response(
      JSON.stringify({
        configured: true,
        chainId: deployment.chainId,
        contentRegistryAddress: deployment.contentRegistryAddress,
        feedbackRegistryAddress: deployment.feedbackRegistryAddress,
        deploymentKey: deployment.deploymentKey,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  return null;
}

function healthyPonderPreflightResponse(url: string): Response | null {
  assert.ok(TEST_PONDER_DEPLOYMENT);
  return healthyPonderPreflightResponseForDeployment(url, TEST_PONDER_DEPLOYMENT);
}

test("resolvePonderUrl uses the local default outside production", () => {
  assert.equal(resolvePonderUrl(undefined, false), "http://localhost:42069");
});

test("resolvePonderUrl allows missing config in production until runtime use", () => {
  assert.equal(resolvePonderUrl(undefined, true), null);
});

test("resolvePonderUrl normalizes valid production URLs", () => {
  assert.equal(resolvePonderUrl("https://ponder.rateloop.ai/", true), "https://ponder.rateloop.ai");
});

test("resolvePonderUrl rejects remote plaintext HTTP in production", () => {
  assert.throws(
    () => resolvePonderUrl("http://ponder.rateloop.ai/", true),
    /NEXT_PUBLIC_PONDER_URL must be a valid URL/,
  );
});

test("resolvePonderUrl rejects invalid production URLs", () => {
  assert.throws(() => resolvePonderUrl("not-a-url", true), /NEXT_PUBLIC_PONDER_URL must be a valid URL/);
});

test("resolvePonderUrl disables localhost URLs in production without crashing module evaluation", () => {
  assert.equal(resolvePonderUrl("http://localhost:42069", true), null);
});

test("resolvePonderUrl can allow localhost URLs for local production-style E2E", () => {
  assert.equal(resolvePonderUrl("http://localhost:42069", true, true), "http://localhost:42069");
});

test("shouldBypassPonderAvailabilityPreflightForConfig only bypasses local E2E loopback URLs", () => {
  assert.equal(
    shouldBypassPonderAvailabilityPreflightForConfig({
      localE2EProductionBuild: true,
      ponderUrl: "http://127.0.0.1:42069",
    }),
    true,
  );
  assert.equal(
    shouldBypassPonderAvailabilityPreflightForConfig({
      localE2EProductionBuild: true,
      ponderUrl: "http://localhost:42069",
    }),
    true,
  );
  assert.equal(
    shouldBypassPonderAvailabilityPreflightForConfig({
      localE2EProductionBuild: true,
      ponderUrl: "https://ponder.example.com",
    }),
    false,
  );
  assert.equal(
    shouldBypassPonderAvailabilityPreflightForConfig({
      localE2EProductionBuild: false,
      ponderUrl: "http://127.0.0.1:42069",
    }),
    false,
  );
  assert.equal(
    shouldBypassPonderAvailabilityPreflightForConfig({
      localE2EProductionBuild: true,
      ponderUrl: null,
    }),
    false,
  );
});

test("ponderApi rejects explicit unconfigured chain ids instead of falling back to the default deployment", async () => {
  await assert.rejects(
    () => ponderApi.getContent(undefined, { chainId: 999_999 }),
    /Ponder deployment is not configured for chain 999999/,
  );
});

test("isPonderAvailable proxies browser health checks through Next", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let requestedUrl = "";
  let requestedCache: RequestCache | undefined;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:3000" } },
  });

  globalThis.fetch = (async (input, init) => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedCache = init?.cache;
    return new Response(JSON.stringify({ available: false }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    assert.equal(await isPonderAvailable(), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    invalidatePonderCache();
  }

  assert.equal(requestedUrl, "/api/ponder/availability");
  assert.equal(requestedCache, "no-store");
});

test("isPonderAvailable includes explicit deployment keys in browser health checks", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const deploymentKey = BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://localhost:3000" } },
  });

  globalThis.fetch = (async input => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new Response(JSON.stringify({ available: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    assert.equal(await isPonderAvailable(deploymentKey), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
    invalidatePonderCache();
  }

  assert.equal(requestedUrl, `/api/ponder/availability?deploymentKey=${encodeURIComponent(deploymentKey)}`);
});

test("normalizeSupportedPonderDeploymentKey only accepts known deployment keys", () => {
  assert.ok(TEST_PONDER_DEPLOYMENT);
  assert.equal(
    normalizeSupportedPonderDeploymentKey(TEST_PONDER_DEPLOYMENT.deploymentKey.toUpperCase()),
    TEST_PONDER_DEPLOYMENT.deploymentKey,
  );
  assert.equal(
    normalizeSupportedPonderDeploymentKey(
      "999999:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000002",
    ),
    null,
  );
});

test("getPonderAvailabilityStatus rejects unsupported explicit deployment keys without probing", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const status = await getPonderAvailabilityStatus(
      "999999:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000002",
    );

    assert.equal(status.available, false);
    assert.equal(status.reason, "deployment_unconfigured");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }
});

test("getPonderAvailabilityStatus bounds availability cache entries", async () => {
  const originalFetch = globalThis.fetch;
  const fakeDeploymentKeys = Array.from(
    { length: 40 },
    (_, index) =>
      `31337:0x${(index + 1).toString(16).padStart(40, "0")}:0x${(index + 101).toString(16).padStart(40, "0")}`,
  );
  let currentDeploymentKey = fakeDeploymentKeys[0] ?? "";

  __setSupportedPonderDeploymentKeysForTests(fakeDeploymentKeys);
  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/health")) {
      return new Response("ok", { status: 200 });
    }
    if (url.endsWith("/deployment")) {
      return new Response(JSON.stringify({ configured: true, deploymentKey: currentDeploymentKey }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    for (const deploymentKey of fakeDeploymentKeys) {
      currentDeploymentKey = deploymentKey;
      const status = await getPonderAvailabilityStatus(deploymentKey);
      assert.equal(status.available, true);
    }

    assert.equal(__getPonderAvailabilityCacheSizeForTests(), 32);
  } finally {
    __setSupportedPonderDeploymentKeysForTests(null);
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }
});

test("isPonderAvailable retries transient deployment probe failures", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  let deploymentCalls = 0;

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);

    if (url.endsWith("/health")) {
      return new Response("ok", { status: 200 });
    }

    if (url.endsWith("/deployment")) {
      deploymentCalls += 1;
      if (deploymentCalls === 1) {
        return new Response("rate limited", { status: 429 });
      }
      return healthyPonderPreflightResponse(url) ?? new Response("missing", { status: 404 });
    }

    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    assert.equal(await isPonderAvailable(), true);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.equal(deploymentCalls, 2);
});

test("getPonderAvailabilityStatus keeps last-known-good deployment status on transient probe failures", async () => {
  const originalFetch = globalThis.fetch;
  let forceTransientDeploymentFailure = false;
  let deploymentCallsAfterFailure = 0;

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/health")) {
      return new Response("ok", { status: 200 });
    }

    if (url.endsWith("/deployment")) {
      if (forceTransientDeploymentFailure) {
        deploymentCallsAfterFailure += 1;
        return new Response("temporarily unavailable", { status: 503 });
      }
      return healthyPonderPreflightResponse(url) ?? new Response("missing", { status: 404 });
    }

    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const healthyStatus = await getPonderAvailabilityStatus();
    assert.equal(healthyStatus.available, true);

    forceTransientDeploymentFailure = true;
    invalidatePonderCache();

    const fallbackStatus = await getPonderAvailabilityStatus();
    assert.equal(fallbackStatus.available, true);
    assert.equal(fallbackStatus.ponderDeploymentKey, healthyStatus.ponderDeploymentKey);
    assert.equal(deploymentCallsAfterFailure, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }
});

test("fetchPonderJson returns parsed json responses", async () => {
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

  const result = await fetchPonderJson<{ ok: boolean }>(
    "https://ponder.rateloop.ai/content",
    1000,
    async () => response,
  );

  assert.deepEqual(result, { ok: true });
});

test("fetchPonderJson surfaces request timeouts clearly", async () => {
  const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });

  await assert.rejects(
    () =>
      fetchPonderJson("https://ponder.rateloop.ai/content", 1234, async () => {
        throw abortError;
      }),
    /Ponder request timed out after 1234ms/,
  );
});

test("fetchPonderJson wraps fetch failures", async () => {
  await assert.rejects(
    () =>
      fetchPonderJson("https://ponder.rateloop.ai/content", 1000, async () => {
        throw new Error("socket hang up");
      }),
    /Ponder request failed: socket hang up/,
  );
});

test("fetchPonderJson retries rate-limited responses using Retry-After", async () => {
  const sleeps: number[] = [];
  let calls = 0;

  const result = await fetchPonderJson<{ ok: boolean }>(
    "https://ponder.rateloop.ai/content",
    1000,
    async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "2" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    {
      queue: false,
      sleep: async ms => {
        sleeps.push(ms);
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
});

test("fetchPonderJson stops retrying rate limits after the configured attempts", async () => {
  let calls = 0;

  await assert.rejects(
    () =>
      fetchPonderJson(
        "https://ponder.rateloop.ai/content",
        1000,
        async () => {
          calls += 1;
          return new Response("rate limited", { status: 429 });
        },
        {
          maxAttempts: 2,
          queue: false,
          sleep: async () => {},
        },
      ),
    /Ponder request failed: 429/,
  );

  assert.equal(calls, 2);
});

test("fetchPonderJson dedupes in-flight identical requests", async () => {
  let calls = 0;
  let resolveFetch: (response: Response) => void = () => {};
  const fetchPromise = new Promise<Response>(resolve => {
    resolveFetch = resolve;
  });
  const fetchImpl = async () => {
    calls += 1;
    return fetchPromise;
  };

  const first = fetchPonderJson<{ ok: boolean }>("https://ponder.rateloop.ai/content", 1000, fetchImpl, {
    queue: false,
  });
  const second = fetchPonderJson<{ ok: boolean }>("https://ponder.rateloop.ai/content", 1000, fetchImpl, {
    queue: false,
  });

  resolveFetch(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.equal(calls, 1);
});

test("ponderApi.syncQuestionMetadata preflights deployment and sends the expected key", async () => {
  const originalFetch = globalThis.fetch;
  const expectedDeploymentKey = TEST_PONDER_DEPLOYMENT?.deploymentKey;
  assert.equal(typeof expectedDeploymentKey, "string");
  const requestedUrls: string[] = [];
  let postedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;
    postedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ updated: 1, skipped: 0, errors: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const result = await ponderApi.syncQuestionMetadata([
      {
        contentId: "42",
        questionMetadata: { schemaVersion: "rateloop.question.v3", title: "Question" },
        questionMetadataHash: `0x${"2".repeat(64)}`,
        questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: null,
      },
    ]);

    assert.equal(result.updated, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  assert.match(requestedUrls[2] ?? "", /\/question-metadata$/);
  const postedDeploymentKey = (postedBody as Record<string, unknown> | null)?.deploymentKey;
  assert.equal(postedDeploymentKey, expectedDeploymentKey);
});

test("ponderApi.syncQuestionMetadata retries transient POST failures", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  let metadataAttempts = 0;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;

    metadataAttempts += 1;
    assert.ok(init?.body);
    if (metadataAttempts === 1) {
      return new Response(JSON.stringify({ error: "metadata sync temporarily unavailable" }), {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      });
    }

    return new Response(JSON.stringify({ updated: 1, skipped: 0, errors: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const result = await ponderApi.syncQuestionMetadata([
      {
        contentId: "42",
        questionMetadata: { schemaVersion: "rateloop.question.v3", title: "Question" },
        questionMetadataHash: `0x${"2".repeat(64)}`,
        questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: null,
      },
    ]);

    assert.equal(result.updated, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  assert.equal(requestedUrls.filter(url => /\/question-metadata$/.test(url)).length, 2);
});

test("ponderApi.syncQuestionMetadata retries rows skipped before indexing catches up", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  let metadataAttempts = 0;

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;

    metadataAttempts += 1;
    return new Response(
      JSON.stringify(
        metadataAttempts === 1
          ? { requested: 1, updated: 0, skipped: 1, errors: [] }
          : { requested: 1, updated: 1, skipped: 0, errors: [] },
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const result = await ponderApi.syncQuestionMetadata([
      {
        contentId: "42",
        questionMetadata: { schemaVersion: "rateloop.question.v3", title: "Question" },
        questionMetadataHash: `0x${"2".repeat(64)}`,
        questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
        resultSpecHash: `0x${"3".repeat(64)}`,
        targetAudience: null,
      },
    ]);

    assert.equal(result.updated, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  assert.equal(requestedUrls.filter(url => /\/question-metadata$/.test(url)).length, 2);
});

test("ponderApi.syncQuestionMetadata marks production auth failures as required config", async () => {
  const originalFetch = globalThis.fetch;
  const mutableEnv = process.env as Record<string, string | undefined>;
  const originalNodeEnv = mutableEnv.NODE_ENV;
  const originalMetadataSyncToken = mutableEnv.PONDER_METADATA_SYNC_TOKEN;
  const requestedUrls: string[] = [];
  let authorizationHeader: string | undefined;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;
    authorizationHeader =
      init?.headers && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string | undefined>).Authorization
        : undefined;
    return new Response(JSON.stringify({ error: "Invalid metadata sync token." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  mutableEnv.NODE_ENV = "production";
  mutableEnv.PONDER_METADATA_SYNC_TOKEN = "test-token";

  try {
    invalidatePonderCache();

    await assert.rejects(
      () =>
        ponderApi.syncQuestionMetadata([
          {
            contentId: "42",
            questionMetadata: { schemaVersion: "rateloop.question.v3", title: "Question" },
            questionMetadataHash: `0x${"2".repeat(64)}`,
            questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
            resultSpecHash: `0x${"3".repeat(64)}`,
            targetAudience: null,
          },
        ]),
      isPonderMetadataSyncRequiredError,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = originalNodeEnv;
    }
    if (originalMetadataSyncToken === undefined) {
      delete mutableEnv.PONDER_METADATA_SYNC_TOKEN;
    } else {
      mutableEnv.PONDER_METADATA_SYNC_TOKEN = originalMetadataSyncToken;
    }
    invalidatePonderCache();
  }

  assert.ok(requestedUrls.some(url => /\/question-metadata$/.test(url)));
  assert.equal(authorizationHeader, "Bearer test-token");
  assert.equal(isPonderMetadataSyncRequiredError(new PonderMetadataSyncRequiredError("required")), true);
});

test("assertPonderQuestionMetadataSyncComplete rejects skipped metadata rows", () => {
  assert.doesNotThrow(() =>
    assertPonderQuestionMetadataSyncComplete({ errors: [], requested: 1, skipped: 0, updated: 1 }),
  );

  assert.throws(
    () => assertPonderQuestionMetadataSyncComplete({ errors: [], requested: 1, skipped: 1, updated: 0 }),
    (error: unknown) =>
      error instanceof PonderQuestionMetadataSyncError &&
      /requested=1, updated=0, skipped=1, errors=0/.test(error.message),
  );
});

test("ponderApi.syncQuestionMetadata can preflight an explicit deployment key", async () => {
  const originalFetch = globalThis.fetch;
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const expectedDeploymentKey = BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey;
  const requestedUrls: string[] = [];
  let postedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponseForDeployment(url, BASE_SEPOLIA_PONDER_DEPLOYMENT);
    if (preflightResponse) return preflightResponse;
    postedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ updated: 1, skipped: 0, errors: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const result = await ponderApi.syncQuestionMetadata(
      [
        {
          contentId: "42",
          questionMetadata: { schemaVersion: "rateloop.question.v3", title: "Question" },
          questionMetadataHash: `0x${"2".repeat(64)}`,
          questionMetadataUri: `https://rateloop.ai/question-metadata/0x${"2".repeat(64)}`,
          resultSpecHash: `0x${"3".repeat(64)}`,
          targetAudience: null,
        },
      ],
      { deploymentKey: expectedDeploymentKey },
    );

    assert.equal(result.updated, 1);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  assert.match(requestedUrls[2] ?? "", /\/question-metadata$/);
  const postedDeploymentKey = (postedBody as Record<string, unknown> | null)?.deploymentKey;
  assert.equal(postedDeploymentKey, expectedDeploymentKey);
});

test("ponderApi.getAllTokenHolders can preflight an explicit deployment key", async () => {
  const originalFetch = globalThis.fetch;
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const expectedDeploymentKey = BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponseForDeployment(url, BASE_SEPOLIA_PONDER_DEPLOYMENT);
    if (preflightResponse) return preflightResponse;

    return new Response(
      JSON.stringify({
        items: [{ address: "0x1234567890abcdef1234567890abcdef12345678", firstSeenAt: "1000" }],
        limit: 200,
        offset: 0,
        total: 1,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const result = await ponderApi.getAllTokenHolders({ deploymentKey: expectedDeploymentKey });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.address, "0x1234567890abcdef1234567890abcdef12345678");
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  assert.match(requestedUrls[2] ?? "", /\/token-holders\?/);
});

test("ponderApi.getContent can preflight and stamp an explicit chain deployment", async () => {
  const originalFetch = globalThis.fetch;
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const contentDeployment = resolveContentDeploymentScope(BASE_SEPOLIA_PONDER_DEPLOYMENT.chainId);
  assert.ok(contentDeployment);
  const expectedDeploymentKey = BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponseForDeployment(url, BASE_SEPOLIA_PONDER_DEPLOYMENT);
    if (preflightResponse) return preflightResponse;

    return new Response(
      JSON.stringify({
        items: [{ id: "42", question: "Scoped question" }],
        limit: 50,
        offset: 0,
        total: 1,
        hasMore: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const result = await ponderApi.getContent(undefined, {
      chainId: BASE_SEPOLIA_PONDER_DEPLOYMENT.chainId,
      deploymentKey: expectedDeploymentKey,
    });

    assert.equal(result.items[0]?.chainId, BASE_SEPOLIA_PONDER_DEPLOYMENT.chainId);
    assert.equal(result.items[0]?.contentRegistryAddress, contentDeployment.contentRegistryAddress);
    assert.equal(result.items[0]?.deploymentKey, contentDeployment.deploymentKey);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  assert.match(requestedUrls[2] ?? "", /\/content$/);
});

test("protocol data reads preflight an explicit deployment key", async () => {
  const originalFetch = globalThis.fetch;
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const expectedDeploymentKey = BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponseForDeployment(url, BASE_SEPOLIA_PONDER_DEPLOYMENT);
    if (preflightResponse) return preflightResponse;

    if (url.includes("/vote-cooldowns")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/voting-stakes")) {
      return new Response(JSON.stringify({ activeStake: "0", activeCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/voter-streak")) {
      return new Response(
        JSON.stringify({
          bestDailyStreak: 0,
          currentDailyStreak: 0,
          lastActiveDate: null,
          lastMilestoneDay: 0,
          milestones: [],
          nextMilestone: null,
          nextMilestoneBaseBonus: null,
          totalActiveDays: 0,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        items: [],
        total: 0,
        settledTotal: 0,
        limit: 25,
        offset: 0,
        hasMore: false,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });

    const options = {
      chainId: BASE_SEPOLIA_PONDER_DEPLOYMENT.chainId,
      deploymentKey: expectedDeploymentKey,
    };
    await ponderApi.getVotes({ voter: "0x1234567890abcdef1234567890abcdef12345678" }, options);
    await ponderApi.getContentFeedback({ contentId: "42" }, options);
    await ponderApi.getFeedbackBonusPools({ contentId: "42" }, options);
    await ponderApi.getFeedbackBonusAwards({ contentId: "42" }, options);
    await ponderApi.getVoteCooldowns({ contentIds: "42" }, options);
    await ponderApi.getQuestionRewardClaimCandidates("0x1234567890abcdef1234567890abcdef12345678", undefined, options);
    await ponderApi.getQuestionBundleRewardClaimCandidates(
      "0x1234567890abcdef1234567890abcdef12345678",
      undefined,
      options,
    );
    await ponderApi.getVotingStakes("0x1234567890abcdef1234567890abcdef12345678", options);
    await ponderApi.getVoterStreak("0x1234567890abcdef1234567890abcdef12345678", options);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  assert.match(requestedUrls[0] ?? "", /\/health$/);
  assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  const dataUrls = requestedUrls.filter(url => !isPonderPreflightUrl(url));
  assert.deepEqual(
    dataUrls.map(url => new URL(url).pathname),
    [
      "/votes",
      "/content-feedback",
      "/feedback-bonus-pools",
      "/feedback-bonus-awards",
      "/vote-cooldowns",
      "/question-reward-claim-candidates",
      "/question-bundle-claim-candidates",
      "/voting-stakes",
      "/voter-streak",
    ],
  );
});

test("ponderApi.getContentWindow respects hasMore when search totals are omitted", async () => {
  const originalGetContent = ponderApi.getContent;
  let callCount = 0;
  const seenOptions: unknown[] = [];

  ponderApi.getContent = async (_params, options) => {
    callCount += 1;
    seenOptions.push(options);

    if (callCount === 1) {
      return {
        items: Array.from({ length: 200 }, (_, index) => ({ id: String(index + 1) })) as any,
        total: null,
        limit: 200,
        offset: 0,
        hasMore: true,
      };
    }

    return {
      items: Array.from({ length: 50 }, (_, index) => ({ id: String(index + 201) })) as any,
      total: null,
      limit: 50,
      offset: 200,
      hasMore: true,
    };
  };

  try {
    const response = await ponderApi.getContentWindow(
      { limit: "250", search: "rateloop" },
      { chainId: 84532, deploymentKey: "84532:content:feedback" },
    );

    assert.equal(response.items.length, 250);
    assert.equal(response.total, null);
    assert.equal(response.hasMore, true);
    assert.deepEqual(seenOptions, [
      { chainId: 84532, deploymentKey: "84532:content:feedback" },
      { chainId: 84532, deploymentKey: "84532:content:feedback" },
    ]);
  } finally {
    ponderApi.getContent = originalGetContent;
  }
});

test("ponderApi.getAllRounds paginates every round for a content item when called without object binding", async () => {
  const originalGetRounds = ponderApi.getRounds;
  const offsets: string[] = [];
  const submitters: Array<string | undefined> = [];

  ponderApi.getRounds = async params => {
    offsets.push(params?.offset ?? "0");
    submitters.push(params?.submitter);
    const offset = Number(params?.offset ?? 0);
    const length = offset === 0 ? 200 : 25;

    return {
      items: Array.from({ length }, (_, index) => ({ roundId: String(offset + index + 1) })) as any,
      total: 225,
      limit: 200,
      offset,
    };
  };

  try {
    const getAllRounds = ponderApi.getAllRounds;
    const rounds = await getAllRounds({
      contentId: "7",
      state: "2",
      submitter: "0x0000000000000000000000000000000000000001",
    });

    assert.equal(rounds.length, 225);
    assert.deepEqual(offsets, ["0", "200"]);
    assert.deepEqual(submitters, [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001",
    ]);
  } finally {
    ponderApi.getRounds = originalGetRounds;
  }
});

test("ponderApi.getAllSubmitterSettledRounds paginates a dedicated submitter endpoint", async () => {
  const originalGetSubmitterSettledRounds = ponderApi.getSubmitterSettledRounds;
  const offsets: string[] = [];
  const submitters: string[] = [];

  ponderApi.getSubmitterSettledRounds = async (submitter, params) => {
    submitters.push(submitter);
    offsets.push(params?.offset ?? "0");
    const offset = Number(params?.offset ?? 0);
    const length = offset === 0 ? 200 : 1;

    return {
      items: Array.from({ length }, (_, index) => ({
        contentId: String(offset + index + 1),
        roundId: "1",
      })),
      total: 201,
      limit: 200,
      offset,
    };
  };

  try {
    const rounds = await ponderApi.getAllSubmitterSettledRounds("0x0000000000000000000000000000000000000001");

    assert.equal(rounds.length, 201);
    assert.deepEqual(offsets, ["0", "200"]);
    assert.deepEqual(submitters, [
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000001",
    ]);
  } finally {
    ponderApi.getSubmitterSettledRounds = originalGetSubmitterSettledRounds;
  }
});

test("ponderApi follow helpers target the public follow routes", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;
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
  }) as typeof fetch;

  try {
    const follows = await ponderApi.getFollows("0x1111111111111111111111111111111111111111", {
      limit: "10",
      offset: "5",
    });
    const followers = await ponderApi.getFollowers("0x1111111111111111111111111111111111111111", {
      limit: "10",
      offset: "5",
    });

    assert.equal(follows.followingCount, 2);
    assert.equal(followers.followerCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  const dataUrls = requestedUrls.filter(url => !isPonderPreflightUrl(url));
  assert.match(dataUrls[0] ?? "", /\/follows\/0x1111111111111111111111111111111111111111\?limit=10&offset=5$/);
  assert.match(dataUrls[1] ?? "", /\/followers\/0x1111111111111111111111111111111111111111\?limit=10&offset=5$/);
});

test("ponderApi.getAllFollows paginates the full public follow set", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;

    if (url.includes("offset=0")) {
      return new Response(
        JSON.stringify({
          items: Array.from({ length: 200 }, (_, index) => ({
            walletAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
            createdAt: `2026-01-01T00:00:${String(index).padStart(2, "0")}Z`,
          })),
          count: 205,
          followerCount: 9,
          followingCount: 205,
          limit: 200,
          offset: 0,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        items: Array.from({ length: 5 }, (_, index) => ({
          walletAddress: `0x${(index + 201).toString(16).padStart(40, "0")}`,
          createdAt: `2026-01-01T00:03:${String(index).padStart(2, "0")}Z`,
        })),
        count: 205,
        followerCount: 9,
        followingCount: 205,
        limit: 200,
        offset: 200,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  try {
    const follows = await ponderApi.getAllFollows("0x1111111111111111111111111111111111111111");
    assert.equal(follows.items.length, 205);
    assert.equal(follows.followingCount, 205);
    assert.equal(follows.offset, 0);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  const dataUrls = requestedUrls.filter(url => !isPonderPreflightUrl(url));
  assert.match(dataUrls[0] ?? "", /\/follows\/0x1111111111111111111111111111111111111111\?limit=200&offset=0$/);
  assert.match(dataUrls[1] ?? "", /\/follows\/0x1111111111111111111111111111111111111111\?limit=200&offset=200$/);
});

test("ponder scoped reads preflight explicit deployment keys", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  assert.ok(BASE_SEPOLIA_PONDER_DEPLOYMENT);
  const deploymentOptions = {
    chainId: BASE_SEPOLIA_PONDER_DEPLOYMENT.chainId,
    deploymentKey: BASE_SEPOLIA_PONDER_DEPLOYMENT.deploymentKey,
  };

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requestedUrls.push(url);
    const preflightResponse = healthyPonderPreflightResponseForDeployment(url, BASE_SEPOLIA_PONDER_DEPLOYMENT);
    if (preflightResponse) return preflightResponse;

    if (url.includes("/category-popularity")) {
      return new Response(JSON.stringify({ "1": 3 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/categories")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/accuracy-leaderboard")) {
      return new Response(JSON.stringify({ items: [], window: "30d", startsAt: null, endsAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/earnings-leaderboard")) {
      return new Response(JSON.stringify({ items: [], window: "30d", startsAt: null, endsAt: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/profiles")) {
      return new Response(JSON.stringify({ "0x1111111111111111111111111111111111111111": { name: "Alice" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/profile/")) {
      return new Response(JSON.stringify({ profile: null, summary: {}, social: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/follows/") || url.includes("/followers/")) {
      return new Response(
        JSON.stringify({
          items: [],
          count: 0,
          followerCount: 0,
          followingCount: 0,
          limit: 200,
          offset: 0,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.includes("/discover-signals/")) {
      return new Response(JSON.stringify({ settlingSoon: [], followedSubmissions: [], followedResolutions: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/frontend/")) {
      return new Response(JSON.stringify({ frontend: { operator: "0x1111111111111111111111111111111111111111" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/voter-accuracy/")) {
      return new Response(JSON.stringify({ stats: null, categories: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/rater-participation-status/")) {
      return new Response(JSON.stringify({ launchRewards: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;

  try {
    invalidatePonderCache({ clearLastKnownGood: true });
    await ponderApi.getCategories(deploymentOptions);
    await ponderApi.getCategoryPopularity(deploymentOptions);
    await ponderApi.getProfiles(["0x1111111111111111111111111111111111111111"], deploymentOptions);
    await ponderApi.getProfile("0x1111111111111111111111111111111111111111", deploymentOptions);
    await ponderApi.getFollows("0x1111111111111111111111111111111111111111", { limit: "5" }, deploymentOptions);
    await ponderApi.getAllFollows("0x1111111111111111111111111111111111111111", deploymentOptions);
    await ponderApi.getFollowers("0x1111111111111111111111111111111111111111", { limit: "5" }, deploymentOptions);
    await ponderApi.getDiscoverSignals(
      "0x1111111111111111111111111111111111111111",
      { watched: "1", followed: "0x2222222222222222222222222222222222222222" },
      deploymentOptions,
    );
    await ponderApi.getFrontend("0x1111111111111111111111111111111111111111", deploymentOptions);
    await ponderApi.getAccuracyLeaderboard({ includeReputation: "1" }, deploymentOptions);
    await ponderApi.getEarningsLeaderboard({ asset: "all", source: "all" }, deploymentOptions);
    await ponderApi.getVoterAccuracy("0x1111111111111111111111111111111111111111", deploymentOptions);
    await ponderApi.getRaterParticipationStatus("0x1111111111111111111111111111111111111111", deploymentOptions);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache({ clearLastKnownGood: true });
  }

  const dataUrls = requestedUrls.filter(url => !isPonderPreflightUrl(url));
  assert.ok(dataUrls.some(url => url.includes("/categories")));
  assert.ok(dataUrls.some(url => url.includes("/category-popularity")));
  assert.ok(dataUrls.some(url => url.includes("/profiles?addresses=")));
  assert.ok(dataUrls.some(url => url.includes("/profile/0x1111111111111111111111111111111111111111")));
  assert.ok(dataUrls.some(url => url.includes("/follows/0x1111111111111111111111111111111111111111")));
  assert.ok(dataUrls.some(url => url.includes("/followers/0x1111111111111111111111111111111111111111")));
  assert.ok(dataUrls.some(url => url.includes("/discover-signals/0x1111111111111111111111111111111111111111")));
  assert.ok(dataUrls.some(url => url.includes("/frontend/0x1111111111111111111111111111111111111111")));
  assert.ok(dataUrls.some(url => url.includes("/accuracy-leaderboard?includeReputation=1")));
  assert.ok(dataUrls.some(url => url.includes("/earnings-leaderboard?asset=all&source=all")));
  assert.ok(dataUrls.some(url => url.includes("/voter-accuracy/0x1111111111111111111111111111111111111111")));
  assert.ok(
    dataUrls.some(url => url.includes("/rater-participation-status/0x1111111111111111111111111111111111111111")),
  );
});

test("ponderApi.getAccuracyLeaderboard forwards includeReputation", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async input => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const preflightResponse = healthyPonderPreflightResponse(requestedUrl);
    if (preflightResponse) return preflightResponse;
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
  }) as typeof fetch;

  try {
    const response = await ponderApi.getAccuracyLeaderboard({
      includeReputation: "1",
      minSignalVotes: "5",
      raterType: "ai",
    });

    assert.equal(response.items[0]?.reputation?.followerCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }

  assert.match(requestedUrl, /\/accuracy-leaderboard\?/);
  assert.match(requestedUrl, /includeReputation=1/);
  assert.match(requestedUrl, /minSignalVotes=5/);
  assert.match(requestedUrl, /raterType=ai/);
});

test("ponderApi.getProfile exposes social counts from profile detail", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;

    return new Response(
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
    );
  }) as typeof fetch;

  try {
    const response = await ponderApi.getProfile("0x1111111111111111111111111111111111111111");
    assert.deepEqual(response.social, {
      followerCount: 3,
      followingCount: 2,
    });
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponderApi.getRaterParticipationStatus exposes expanded reputation blocks", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async input => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const preflightResponse = healthyPonderPreflightResponse(url);
    if (preflightResponse) return preflightResponse;

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
        participationLane: "open",
        humanCredential: {
          verified: false,
          revoked: false,
          status: "missing",
          verifiedAt: null,
          expiresAt: null,
          evidenceHash: null,
        },
        confidentialitySanction: {
          active: true,
          reason: "verified leak",
          scope: "surplus earning and gated-context access checks",
          expiresAt: null,
          evidenceHash: "0x1234",
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
  }) as typeof fetch;

  try {
    const response = await ponderApi.getRaterParticipationStatus("0x1111111111111111111111111111111111111111");

    assert.equal(response.participationLane, "open");
    assert.equal(response.humanCredential.status, "missing");
    assert.equal(response.confidentialitySanction?.active, true);
    assert.equal(response.confidentialitySanction?.reason, "verified leak");
    assert.equal(response.launchRewards.remainingLaunchCap, "75");
    assert.equal(response.launchRewards.unlockableLaunchCap, "300");
    assert.equal(response.participationPolicy.baseRewardWeightBps, 10000);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});
