import { NextRequest } from "next/server";
import { GET as claim } from "./claim/route";
import { GET as earnings } from "./earnings/route";
import { GET as reveal } from "./reveal/route";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("self-reveal and claim status routes are authenticated and never accept recovery preimages", () => {
  for (const path of ["./reveal/route.ts", "./claim/route.ts"]) {
    const route = source(path);
    assert.match(route, /requireBrowserSession/u);
    assert.match(route, /getRaterSettlementSnapshot/u);
    assert.match(route, /private, no-store/u);
    assert.doesNotMatch(route, /export async function POST/u);
    assert.doesNotMatch(route, /request\.json/u);
  }
});

test("the earnings ledger is account-bound and private", () => {
  const route = source("./earnings/route.ts");
  assert.match(route, /requireBrowserSession/u);
  assert.match(route, /listReviewerEarnings/u);
  assert.match(route, /private, no-store/u);
});

test("reveal, claim, and earnings handlers enforce a browser session and return private responses", async () => {
  const unauthenticated = await Promise.all([
    reveal(new NextRequest(`${ORIGIN}/api/rater/reveal?roundId=1&voteKey=0x${"1".repeat(40)}`)),
    claim(new NextRequest(`${ORIGIN}/api/rater/claim?roundId=1&voteKey=0x${"1".repeat(40)}`)),
    earnings(new NextRequest(`${ORIGIN}/api/rater/earnings`)),
  ]);
  assert.deepEqual(
    unauthenticated.map(response => response.status),
    [401, 401, 401],
  );
  assert.ok(unauthenticated.every(response => response.headers.get("cache-control") === NO_STORE));

  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: "better_settlement_route_test",
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const browserRequest = (path: string) =>
    new NextRequest(`${ORIGIN}${path}`, { headers: { cookie: `${AUTH_SESSION_COOKIE}=${session.token}` } });

  const malformedReveal = await reveal(browserRequest("/api/rater/reveal"));
  const malformedClaim = await claim(browserRequest("/api/rater/claim"));
  assert.equal(malformedReveal.status, 400);
  assert.equal(malformedClaim.status, 400);
  assert.equal((await malformedReveal.json()).code, "invalid_settlement_lookup");
  assert.equal((await malformedClaim.json()).code, "invalid_settlement_lookup");

  const emptyEarnings = await earnings(browserRequest("/api/rater/earnings"));
  assert.equal(emptyEarnings.status, 200);
  assert.equal(emptyEarnings.headers.get("cache-control"), NO_STORE);
  assert.deepEqual(await emptyEarnings.json(), {
    schemaVersion: "rateloop.reviewer-earnings.v1",
    totals: { earnedAtomic: "0", claimedAtomic: "0", claimableAtomic: "0" },
    items: [],
  });
});
