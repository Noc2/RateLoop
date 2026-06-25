import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalTrustedHeaders = env.RATE_LIMIT_TRUSTED_IP_HEADERS;

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("../../app/api/attachments/images/[attachmentId]/status/route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let route: RouteModule;

function makeRequest(attachmentId: string): NextRequest {
  return new NextRequest(`https://rateloop.ai/api/attachments/images/${attachmentId}/status`, {
    headers: new Headers({
      "x-forwarded-for": "203.0.113.81",
    }),
  });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";

  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("../../app/api/attachments/images/[attachmentId]/status/route");
});

beforeEach(() => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.RATE_LIMIT_TRUSTED_IP_HEADERS = "x-forwarded-for";
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(null);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);

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

  if (originalTrustedHeaders === undefined) {
    delete env.RATE_LIMIT_TRUSTED_IP_HEADERS;
  } else {
    env.RATE_LIMIT_TRUSTED_IP_HEADERS = originalTrustedHeaders;
  }
});

test("image attachment status route throttles varied ids before lookup", async () => {
  for (let index = 0; index < 121; index += 1) {
    const attachmentId = `att_statusfloodcase${String(index).padStart(4, "0")}`;
    const response = await route.GET(makeRequest(attachmentId), {
      params: Promise.resolve({ attachmentId }),
    });

    if (index < 120) {
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, "Attachment not found.");
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});
