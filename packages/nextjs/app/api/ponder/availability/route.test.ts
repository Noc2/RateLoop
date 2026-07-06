import { NextRequest } from "next/server";
import { GET } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { invalidatePonderCache } from "~~/services/ponder/client";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

beforeEach(() => {
  __setRateLimitStoreForTests(createMemoryDatabaseResources().client);
});

afterEach(() => {
  __setRateLimitStoreForTests(null);
  invalidatePonderCache();
});

function getFetchUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function makeAvailabilityRequest(url: string) {
  return new NextRequest(url);
}

test("ponder availability route reports a healthy indexer", async () => {
  const originalFetch = globalThis.fetch;
  const deployment = resolveProtocolDeploymentScope(31337);
  assert.ok(deployment);
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const requestedUrl = getFetchUrl(input);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          configured: true,
          chainId: deployment.chainId,
          contentRegistryAddress: deployment.contentRegistryAddress,
          feedbackRegistryAddress: deployment.feedbackRegistryAddress,
          deploymentKey: deployment.deploymentKey,
          databaseSchema: "rateloop_ponder_test",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const response = await GET(makeAvailabilityRequest("http://localhost/api/ponder/availability"));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.available, true);
    assert.equal(body.expectedDeploymentKey, deployment.deploymentKey);
    assert.equal(body.ponderDeploymentKey, deployment.deploymentKey);
    assert.match(requestedUrls[0] ?? "", /\/health$/);
    assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponder availability route ignores explicit deployment keys", async () => {
  const originalFetch = globalThis.fetch;
  const deployment = resolveProtocolDeploymentScope(31337);
  assert.ok(deployment);
  const requestedUrls: string[] = [];

  globalThis.fetch = (async input => {
    const requestedUrl = getFetchUrl(input);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          configured: true,
          chainId: deployment.chainId,
          contentRegistryAddress: deployment.contentRegistryAddress,
          feedbackRegistryAddress: deployment.feedbackRegistryAddress,
          deploymentKey: deployment.deploymentKey,
          databaseSchema: "rateloop_ponder_test",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const response = await GET(
      makeAvailabilityRequest(
        `http://localhost/api/ponder/availability?deploymentKey=${encodeURIComponent(deployment.deploymentKey)}`,
      ),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.available, true);
    assert.equal(body.expectedDeploymentKey, deployment.deploymentKey);
    assert.equal(body.ponderDeploymentKey, deployment.deploymentKey);
    assert.match(requestedUrls[0] ?? "", /\/health$/);
    assert.match(requestedUrls[1] ?? "", /\/deployment$/);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponder availability route reports an offline indexer", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("connection refused");
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const response = await GET(makeAvailabilityRequest("http://localhost/api/ponder/availability"));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.available, false);
    assert.equal(body.reason, "health_check_failed");
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponder availability route rejects deployment mismatches", async () => {
  const originalFetch = globalThis.fetch;
  const deployment = resolveProtocolDeploymentScope(31337);
  assert.ok(deployment);

  globalThis.fetch = (async input => {
    const requestedUrl = getFetchUrl(input);
    if (requestedUrl.endsWith("/deployment")) {
      return new Response(
        JSON.stringify({
          configured: true,
          chainId: deployment.chainId,
          contentRegistryAddress: deployment.contentRegistryAddress,
          feedbackRegistryAddress: deployment.feedbackRegistryAddress,
          deploymentKey: `${deployment.deploymentKey}:stale`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const response = await GET(makeAvailabilityRequest("http://localhost/api/ponder/availability"));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.available, false);
    assert.equal(body.reason, "deployment_mismatch");
    assert.equal(body.expectedDeploymentKey, deployment.deploymentKey);
    assert.equal(body.ponderDeploymentKey, `${deployment.deploymentKey}:stale`);
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponder availability route ignores unsupported deployment keys", async () => {
  const originalFetch = globalThis.fetch;
  const deployment = resolveProtocolDeploymentScope(31337);
  assert.ok(deployment);
  const requestedUrls: string[] = [];
  globalThis.fetch = (async input => {
    const requestedUrl = getFetchUrl(input);
    requestedUrls.push(requestedUrl);
    if (requestedUrl.endsWith("/deployment")) {
      return new Response(JSON.stringify({ configured: true, deploymentKey: deployment.deploymentKey }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    invalidatePonderCache();
    const response = await GET(
      makeAvailabilityRequest(
        "http://localhost/api/ponder/availability?deploymentKey=999999:0x0000000000000000000000000000000000000001:0x0000000000000000000000000000000000000002",
      ),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.expectedDeploymentKey, deployment.deploymentKey);
    assert.deepEqual(
      requestedUrls.map(url => new URL(url).pathname),
      ["/health", "/deployment"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});

test("ponder availability route rate limits repeated probes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("ok", { status: 200 })) as typeof fetch;
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await GET(
        makeAvailabilityRequest("http://localhost/api/ponder/availability?deploymentKey=unsupported"),
      );
      assert.equal(response.status, 200);
    }

    const limited = await GET(
      makeAvailabilityRequest("http://localhost/api/ponder/availability?deploymentKey=unsupported"),
    );
    assert.equal(limited.status, 429);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
