import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type RouteModule = typeof import("./route");

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalCronSecret = env.CRON_SECRET;
const originalDeliverySecret = env.NOTIFICATION_DELIVERY_SECRET;
const originalNodeEnv = env.NODE_ENV;

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

function deliveryRequest(token = "wrong-secret") {
  return new NextRequest("https://rateloop.ai/api/notifications/email/deliver", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "user-agent": "notification-delivery-test",
    }),
    method: "POST",
  });
}

function cronRequest(token = "cron-secret") {
  return new NextRequest("https://rateloop.ai/api/notifications/email/deliver", {
    headers: new Headers({
      authorization: `Bearer ${token}`,
      "user-agent": "vercel-cron/1.0",
    }),
    method: "GET",
  });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.NOTIFICATION_DELIVERY_SECRET = "delivery-secret";
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  route = await import("./route");
});

beforeEach(async () => {
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "test";
  env.NOTIFICATION_DELIVERY_SECRET = "delivery-secret";
  delete env.CRON_SECRET;
  const resources = dbTestMemory.createMemoryDatabaseResources();
  dbModule.__setDatabaseResourcesForTests(resources);
  rateLimit.__setRateLimitStoreForTests(resources.client);
  await resources.client.execute("DELETE FROM api_rate_limits");
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("CRON_SECRET", originalCronSecret);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("NOTIFICATION_DELIVERY_SECRET", originalDeliverySecret);
});

test("notification delivery route rate limits unauthorized guesses before delivery work", async () => {
  for (let index = 0; index < 31; index += 1) {
    const response = await route.POST(deliveryRequest(`wrong-secret-${index}`));

    if (index < 30) {
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    } else {
      assert.equal(response.status, 429);
      assert.equal((await response.json()).code, "rate_limit_exceeded");
    }
  }
});

test("notification delivery route accepts Vercel cron GET bearer auth", async () => {
  env.CRON_SECRET = "cron-secret";

  const response = await route.GET(cronRequest());

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Notification delivery is not configured" });
});

test("notification delivery route rejects unauthorized Vercel cron GET requests", async () => {
  env.CRON_SECRET = "cron-secret";

  const response = await route.GET(cronRequest("wrong-secret"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
});

test("Vercel cron schedules notification email delivery", () => {
  const vercelConfig = JSON.parse(readFileSync(new URL("../../../../../vercel.json", import.meta.url), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.deepEqual(
    (vercelConfig.crons ?? []).filter(cron => cron.path === "/api/notifications/email/deliver"),
    [{ path: "/api/notifications/email/deliver", schedule: "11 * * * *" }],
  );
});
