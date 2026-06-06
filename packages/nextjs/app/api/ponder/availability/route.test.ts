import { GET } from "./route";
import assert from "node:assert/strict";
import { test } from "node:test";
import { invalidatePonderCache } from "~~/services/ponder/client";

function getFetchUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

test("ponder availability route reports a healthy indexer", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  globalThis.fetch = (async input => {
    requestedUrl = getFetchUrl(input);
    return new Response("ok", { status: 200 });
  }) as typeof fetch;

  try {
    invalidatePonderCache();

    const response = await GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: true });
    assert.match(requestedUrl, /\/health$/);
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

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { available: false });
  } finally {
    globalThis.fetch = originalFetch;
    invalidatePonderCache();
  }
});
