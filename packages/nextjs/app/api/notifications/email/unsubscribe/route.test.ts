import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { notificationEmailSubscriptions } from "~~/lib/db/schema";
import { buildNotificationEmailUnsubscribeToken } from "~~/lib/notifications/emailUrls";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalDatabaseUrl = env.DATABASE_URL;
const originalDeliverySecret = env.NOTIFICATION_DELIVERY_SECRET;
const originalNextPublicAppUrl = env.NEXT_PUBLIC_APP_URL;
const originalNodeEnv = env.NODE_ENV;
const originalVercelEnv = env.VERCEL_ENV;
const originalVercelProjectProductionUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
const originalVercelUrl = env.VERCEL_URL;

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const EMAIL = "alice@example.com";
const SECRET = "notification-secret";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RouteModule = typeof import("./route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let route: RouteModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function configureEnv() {
  env.APP_URL = "https://www.rateloop.ai";
  env.DATABASE_URL = "memory:";
  env.NODE_ENV = "production";
  env.NOTIFICATION_DELIVERY_SECRET = SECRET;
  delete env.NEXT_PUBLIC_APP_URL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_PROJECT_PRODUCTION_URL;
  delete env.VERCEL_URL;
}

function buildToken() {
  return buildNotificationEmailUnsubscribeToken(
    {
      walletAddress: WALLET,
      email: EMAIL,
    },
    SECRET,
  );
}

function makeRequest(method: "GET" | "POST", token = buildToken()) {
  return new NextRequest(
    `https://www.rateloop.ai/api/notifications/email/unsubscribe?token=${encodeURIComponent(token)}`,
    { method },
  );
}

async function insertSubscription() {
  const now = new Date("2026-07-10T12:00:00.000Z");
  await dbModule.db.insert(notificationEmailSubscriptions).values({
    walletAddress: WALLET,
    email: EMAIL,
    verifiedAt: now,
    verificationToken: null,
    verificationExpiresAt: null,
    roundResolved: true,
    settlingSoonHour: true,
    settlingSoonDay: true,
    followedSubmission: true,
    followedResolution: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function countSubscriptions() {
  const rows = await dbModule.db.select().from(notificationEmailSubscriptions);
  return rows.length;
}

before(async () => {
  configureEnv();
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  route = await import("./route");
});

beforeEach(() => {
  configureEnv();
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NEXT_PUBLIC_APP_URL", originalNextPublicAppUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("NOTIFICATION_DELIVERY_SECRET", originalDeliverySecret);
  restoreEnv("VERCEL_ENV", originalVercelEnv);
  restoreEnv("VERCEL_PROJECT_PRODUCTION_URL", originalVercelProjectProductionUrl);
  restoreEnv("VERCEL_URL", originalVercelUrl);
});

test("email unsubscribe GET renders confirmation without deleting the subscription", async () => {
  await insertSubscription();

  const response = await route.GET(makeRequest("GET"));
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /method="post"/);
  assert.match(html, /Unsubscribe/);
  assert.equal(await countSubscriptions(), 1);
});

test("email unsubscribe POST deletes the subscription and redirects to settings", async () => {
  await insertSubscription();

  const response = await route.POST(makeRequest("POST"));

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://www.rateloop.ai/settings?tab=notifications&email=unsubscribed",
  );
  assert.equal(await countSubscriptions(), 0);
});

test("email unsubscribe POST rejects invalid tokens without deleting the subscription", async () => {
  await insertSubscription();

  const response = await route.POST(makeRequest("POST", "not-a-token"));

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get("location"),
    "https://www.rateloop.ai/settings?tab=notifications&email=invalid_unsubscribe",
  );
  assert.equal(await countSubscriptions(), 1);
});
