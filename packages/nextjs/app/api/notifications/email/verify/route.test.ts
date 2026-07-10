import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { notificationEmailSubscriptions } from "~~/lib/db/schema";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;
const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("./route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let route: RouteModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function makeRequest(token: string, method: "GET" | "POST" = "GET"): NextRequest {
  return new NextRequest(`https://rateloop.ai/api/notifications/email/verify?token=${encodeURIComponent(token)}`, {
    headers: new Headers({
      "x-forwarded-for": "203.0.113.82",
    }),
    method,
  });
}

async function insertPendingSubscription(token = "verification-token") {
  const now = new Date();
  await dbModule.db.insert(notificationEmailSubscriptions).values({
    walletAddress: WALLET,
    email: "alice@example.com",
    verifiedAt: null,
    verificationToken: token,
    verificationExpiresAt: new Date(now.getTime() + 60_000),
    roundResolved: true,
    settlingSoonHour: true,
    settlingSoonDay: true,
    followedSubmission: true,
    followedResolution: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function withFixedRateLimitWindow<T>(run: () => Promise<T>) {
  const originalDateNow = Date.now;
  Date.now = () => new Date("2026-06-11T12:10:00.000Z").getTime();
  try {
    return await run();
  } finally {
    Date.now = originalDateNow;
  }
}

before(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";
  delete env.APP_URL;
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;

  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("./route");
});

beforeEach(() => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";
  delete env.APP_URL;
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(null);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATE_LIMIT_TRUSTED_IP_HEADERS", originalTrustedHeaders);
  restoreEnv("VERCEL_ENV", originalVercelEnv);
  restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

test("email verification route throttles varied tokens before token lookup", async () => {
  await withFixedRateLimitWindow(async () => {
    for (let index = 0; index < 61; index += 1) {
      const response = await route.POST(makeRequest(`vf-${String(index).padStart(3, "0")}-flood-token`, "POST"));

      if (index < 60) {
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { ok: false, status: "invalid" });
      } else {
        assert.equal(response.status, 429);
        assert.equal((await response.json()).code, "rate_limit_exceeded");
      }
    }
  });
});

test("email verification GET requires confirmation without consuming the token", async () => {
  await insertPendingSubscription();

  const response = await route.GET(makeRequest("verification-token"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(html, /method="post"/);

  const [row] = await dbModule.db.select().from(notificationEmailSubscriptions);
  assert.equal(row?.verifiedAt, null);
  assert.equal(row?.verificationToken, "verification-token");
});

test("email verification POST consumes the token after confirmation", async () => {
  env.APP_URL = "https://www.rateloop.ai";
  await insertPendingSubscription();

  const response = await route.POST(makeRequest("verification-token", "POST"));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "https://www.rateloop.ai/settings?tab=notifications&email=verified");
  const [row] = await dbModule.db.select().from(notificationEmailSubscriptions);
  assert.ok(row?.verifiedAt);
  assert.equal(row?.verificationToken, null);
});
