import { NextRequest } from "next/server";
import { GET } from "./[address]/route";
import { legacyClaimManifest } from "../../../lib/legacy-claim/manifest";
import assert from "node:assert/strict";
import test from "node:test";

function makeRequest(pathname: string): NextRequest {
  // Use a per-test unique IP so the rate-limit doesn't carry over between tests in this file.
  // The trusted-client-ip header is read from x-forwarded-for (in non-prod, falls back to a
  // fingerprint of the request). Each test below uses a different IP.
  return new NextRequest(`https://curyo.xyz${pathname}`);
}

test("legacy claim route rejects invalid addresses", async () => {
  const response = await GET(makeRequest("/api/legacy-claim/not-an-address"), {
    params: Promise.resolve({ address: "not-an-address" }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid address" });
});

test("legacy claim route returns not_eligible for an address not in the manifest", async () => {
  // The all-zero-but-beef address is not in the populated manifest.
  const response = await GET(makeRequest("/api/legacy-claim/0x000000000000000000000000000000000000bEEF"), {
    params: Promise.resolve({ address: "0x000000000000000000000000000000000000bEEF" }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.status, "not_eligible");
  assert.equal(body.address, "0x000000000000000000000000000000000000bEEF");
  assert.equal(body.merkleRoot, legacyClaimManifest.merkleRoot);
});

test("legacy claim route returns eligible payload (with proof) for a manifest entry", async () => {
  const ELIGIBLE = "0x63cada40e8acf7a1d47229af5be35b78b16035fa";
  const response = await GET(makeRequest(`/api/legacy-claim/${ELIGIBLE}`), {
    params: Promise.resolve({ address: ELIGIBLE }),
  });

  assert.equal(response.status, 200);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.status, "eligible");
  assert.equal(body.address, "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa");
  assert.equal(body.allocation, "2250000000000");
  assert.ok(Array.isArray(body.proof) && (body.proof as unknown[]).length > 0);
  assert.equal(body.merkleRoot, legacyClaimManifest.merkleRoot);
});
