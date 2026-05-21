import { NextRequest } from "next/server";
import { GET } from "./[address]/route";
import assert from "node:assert/strict";
import test from "node:test";

function makeRequest(pathname: string): NextRequest {
  return new NextRequest(`https://curyo.xyz${pathname}`);
}

test("legacy claim route rejects invalid addresses", async () => {
  const response = await GET(makeRequest("/api/legacy-claim/not-an-address"), {
    params: Promise.resolve({ address: "not-an-address" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid address" });
});

test("legacy claim route reports unpublished manifest", async () => {
  const response = await GET(makeRequest("/api/legacy-claim/0x000000000000000000000000000000000000bEEF"), {
    params: Promise.resolve({ address: "0x000000000000000000000000000000000000bEEF" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "not_published",
    merkleRoot: null,
    allocationTotal: "0",
    generatedAt: null,
  });
});
