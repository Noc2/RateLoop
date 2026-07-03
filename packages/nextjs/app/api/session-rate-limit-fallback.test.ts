import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;

const TEST_ADDRESS = "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa";
const TEST_CHAIN_ID = 84532;
const TEST_IP = "203.0.113.77";

env.DATABASE_URL = "memory:";
env.NODE_ENV = "production";
env.NEXT_PUBLIC_TARGET_NETWORKS = String(TEST_CHAIN_ID);
env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";

type RateLimitModule = typeof import("../../utils/rateLimit");
type FreeTransactionsModule = typeof import("../../lib/thirdweb/freeTransactions");
type WatchlistSessionRoute = typeof import("./watchlist/content/session/route");
type NotificationPreferencesSessionRoute = typeof import("./notifications/preferences/session/route");
type NotificationEmailSessionRoute = typeof import("./notifications/email/session/route");
type FreeTransactionSessionRoute = typeof import("./transactions/free/session/route");
type FeedbackChallengeRoute = typeof import("./feedback/challenge/route");
type FeedbackRoute = typeof import("./feedback/route");
type FeedbackCountsRoute = typeof import("./feedback/counts/route");

let rateLimit: RateLimitModule;
let freeTransactions: FreeTransactionsModule;
let watchlistSessionRoute: WatchlistSessionRoute;
let notificationPreferencesSessionRoute: NotificationPreferencesSessionRoute;
let notificationEmailSessionRoute: NotificationEmailSessionRoute;
let freeTransactionSessionRoute: FreeTransactionSessionRoute;
let feedbackChallengeRoute: FeedbackChallengeRoute;
let feedbackRoute: FeedbackRoute;
let feedbackCountsRoute: FeedbackCountsRoute;

function makeRequest(pathname: string) {
  return new NextRequest(`https://rateloop.ai${pathname}`, {
    headers: new Headers({
      "x-forwarded-for": TEST_IP,
    }),
  });
}

before(async () => {
  rateLimit = await import("../../utils/rateLimit");
  freeTransactions = await import("../../lib/thirdweb/freeTransactions");
  watchlistSessionRoute = await import("./watchlist/content/session/route");
  notificationPreferencesSessionRoute = await import("./notifications/preferences/session/route");
  notificationEmailSessionRoute = await import("./notifications/email/session/route");
  freeTransactionSessionRoute = await import("./transactions/free/session/route");
  feedbackChallengeRoute = await import("./feedback/challenge/route");
  feedbackRoute = await import("./feedback/route");
  feedbackCountsRoute = await import("./feedback/counts/route");
});

beforeEach(() => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.NEXT_PUBLIC_TARGET_NETWORKS = String(TEST_CHAIN_ID);
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";

  rateLimit.__setRateLimitStoreForTests({
    execute: async () => {
      throw new Error("database offline");
    },
  });
  freeTransactions.__setFreeTransactionTestOverridesForTests(null);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  freeTransactions.__setFreeTransactionTestOverridesForTests(null);

  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalNodeEnv === undefined) {
    delete env.NODE_ENV;
  } else {
    env.NODE_ENV = originalNodeEnv;
  }

  if (originalTargetNetworks === undefined) {
    delete env.NEXT_PUBLIC_TARGET_NETWORKS;
  } else {
    env.NEXT_PUBLIC_TARGET_NETWORKS = originalTargetNetworks;
  }

  if (originalTrustedHeaders === undefined) {
    delete env.RATE_LIMIT_TRUSTED_IP_HEADERS;
  } else {
    env.RATE_LIMIT_TRUSTED_IP_HEADERS = originalTrustedHeaders;
  }
});

test("watchlist session route fails open when the rate limit store is unavailable", async () => {
  const response = await watchlistSessionRoute.GET(
    makeRequest(`/api/watchlist/content/session?address=${encodeURIComponent(TEST_ADDRESS)}&chainId=${TEST_CHAIN_ID}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    hasSession: false,
    hasReadSession: false,
    hasWriteSession: false,
  });
});

test("notification preferences session route fails open when the rate limit store is unavailable", async () => {
  const response = await notificationPreferencesSessionRoute.GET(
    makeRequest(`/api/notifications/preferences/session?address=${encodeURIComponent(TEST_ADDRESS)}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hasSession: false });
});

test("notification email session route fails open when the rate limit store is unavailable", async () => {
  const response = await notificationEmailSessionRoute.GET(
    makeRequest(`/api/notifications/email/session?address=${encodeURIComponent(TEST_ADDRESS)}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { hasSession: false });
});

test("free transaction session route fails closed when the rate limit store is unavailable", async () => {
  const response = await freeTransactionSessionRoute.GET(
    makeRequest(`/api/transactions/free/session?address=${encodeURIComponent(TEST_ADDRESS)}&chainId=${TEST_CHAIN_ID}`),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
});

test("feedback submit route fails closed when the rate limit store is unavailable", async () => {
  const response = await feedbackRoute.POST(
    new NextRequest("https://rateloop.ai/api/feedback", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-forwarded-for": TEST_IP,
      }),
      body: JSON.stringify({ address: TEST_ADDRESS }),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "service_unavailable");
});

test("feedback challenge route fails closed when rate limit store is unavailable (WS-6)", async () => {
  // WS-6 (2026-05-21 repo audit): the feedback challenge route now sets
  // `allowOnStoreUnavailable: false`. When the rate-limit store (DB) is down, the route
  // surfaces a 503 instead of proceeding to input validation. The downstream
  // `issueSignedActionChallenge` would write to the same store anyway, so silently letting
  // unbounded challenge-creation traffic through during the outage masked a real outage
  // without any operational benefit.
  const response = await feedbackChallengeRoute.POST(
    new NextRequest("https://rateloop.ai/api/feedback/challenge", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        "x-forwarded-for": TEST_IP,
      }),
      body: JSON.stringify({}),
    }),
  );

  assert.equal(response.status, 503);
});

test("feedback counts route continues past rate limit store outages", async () => {
  const response = await feedbackCountsRoute.GET(makeRequest("/api/feedback/counts"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { counts: {} });
});
