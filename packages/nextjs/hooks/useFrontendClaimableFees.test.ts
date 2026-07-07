import { fetchClaimableFrontendFeePage } from "./useFrontendClaimableFees";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("fetchClaimableFrontendFeePage returns degraded unavailable pages", async () => {
  let requestedUrl = "";
  globalThis.fetch = (async input => {
    requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return new Response(
      JSON.stringify({
        error: "Claimable frontend fee lookup unavailable",
        items: [],
        hasMore: false,
        nextOffset: 7,
        scannedRounds: 0,
        totalRounds: 0,
        degraded: true,
      }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const page = await fetchClaimableFrontendFeePage("0x63cada40E8AcF7A1d47229af5Be35b78b16035fa", 8453, 10, 7);

  assert.equal(
    requestedUrl,
    "/api/frontend/claimable-fees?frontend=0x63cada40E8AcF7A1d47229af5Be35b78b16035fa&chainId=8453&limit=10&offset=7",
  );
  assert.deepEqual(page, {
    error: "Claimable frontend fee lookup unavailable",
    items: [],
    hasMore: false,
    nextOffset: 7,
    scannedRounds: 0,
    totalRounds: 0,
    degraded: true,
  });
});

test("fetchClaimableFrontendFeePage still throws ordinary error responses", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "Unsupported chainId" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  await assert.rejects(
    () => fetchClaimableFrontendFeePage("0x63cada40E8AcF7A1d47229af5Be35b78b16035fa", 999999, 10, 0),
    /Unsupported chainId/,
  );
});
