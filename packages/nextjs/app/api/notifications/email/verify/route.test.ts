import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;

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

function makeRequest(token: string): NextRequest {
  return new NextRequest(`https://rateloop.ai/api/notifications/email/verify?token=${encodeURIComponent(token)}`, {
    headers: new Headers({
      "x-forwarded-for": "203.0.113.82",
    }),
  });
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
  for (let index = 0; index < 61; index += 1) {
    const response = await route.GET(makeRequest(`vf-${String(index).padStart(3, "0")}-flood-token`));

    if (index < 60) {
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { ok: false, status: "invalid" });
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});
