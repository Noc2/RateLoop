import { GET } from "./route";
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { invalidatePonderCache } from "~~/services/ponder/client";

function getFetchUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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

    const response = await GET();
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

    const response = await GET();
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

    const response = await GET();
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
