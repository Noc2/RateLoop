import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("./route");

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalSweepSecret = env.RATELOOP_QUESTION_DETAILS_SWEEP_SECRET;

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

function sweepRequest(token = "wrong-secret") {
  return new NextRequest("https://rateloop.ai/api/attachments/details/sweep", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "user-agent": "question-details-sweep-test",
    }),
    method: "POST",
  });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("./route");
});

beforeEach(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.RATELOOP_QUESTION_DETAILS_SWEEP_SECRET = "sweep-secret";
  const resources = dbTestMemory.createMemoryDatabaseResources();
  dbModule.__setDatabaseResourcesForTests(resources);
  rateLimit.__setRateLimitStoreForTests(resources.client);
  await resources.client.execute("DELETE FROM api_rate_limits");
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATELOOP_QUESTION_DETAILS_SWEEP_SECRET", originalSweepSecret);
});

test("question details sweep uses bearer auth and rate limits unauthorized guesses", async () => {
  const allowed = await route.POST(sweepRequest("sweep-secret"));
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { deleted: 0, scanned: 0 });

  for (let index = 0; index < 31; index += 1) {
    const response = await route.POST(sweepRequest(`wrong-secret-${index}`));

    if (index < 29) {
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized." });
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});
