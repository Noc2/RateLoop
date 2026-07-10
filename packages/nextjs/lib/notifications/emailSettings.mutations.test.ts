import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { notificationEmailSubscriptions } from "~~/lib/db/schema";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type EmailSettingsModule = typeof import("~~/lib/notifications/emailSettings");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let emailSettings: EmailSettingsModule;

async function insertSubscription(options: { email: string; expiresAt?: Date; token?: string }) {
  const now = new Date();
  await dbModule.db.insert(notificationEmailSubscriptions).values({
    walletAddress: WALLET,
    email: options.email,
    verifiedAt: null,
    verificationToken: options.token ?? null,
    verificationExpiresAt: options.expiresAt ?? null,
    roundResolved: true,
    settlingSoonHour: true,
    settlingSoonDay: true,
    followedSubmission: true,
    followedResolution: true,
    createdAt: now,
    updatedAt: now,
  });
}

before(async () => {
  env.DATABASE_URL = "memory:";
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  emailSettings = await import("~~/lib/notifications/emailSettings");
});

beforeEach(() => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
  if (originalDatabaseUrl === undefined) {
    delete env.DATABASE_URL;
  } else {
    env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("email verification only mutates the row bound to a current token", async () => {
  await insertSubscription({
    email: "new@example.com",
    expiresAt: new Date(Date.now() + 60_000),
    token: "new-token",
  });

  assert.deepEqual(await emailSettings.verifyEmailNotificationToken("old-token"), { ok: false });

  const [beforeVerification] = await dbModule.db.select().from(notificationEmailSubscriptions);
  assert.equal(beforeVerification?.verifiedAt, null);
  assert.equal(beforeVerification?.verificationToken, "new-token");

  assert.deepEqual(await emailSettings.verifyEmailNotificationToken("new-token"), {
    ok: true,
    walletAddress: WALLET,
    email: "new@example.com",
  });

  const [afterVerification] = await dbModule.db.select().from(notificationEmailSubscriptions);
  assert.ok(afterVerification?.verifiedAt);
  assert.equal(afterVerification?.verificationToken, null);
});

test("email verification rejects expired tokens without mutating the row", async () => {
  await insertSubscription({
    email: "expired@example.com",
    expiresAt: new Date(Date.now() - 1_000),
    token: "expired-token",
  });

  assert.deepEqual(await emailSettings.verifyEmailNotificationToken("expired-token"), { ok: false });
  const [row] = await dbModule.db.select().from(notificationEmailSubscriptions);
  assert.equal(row?.verifiedAt, null);
  assert.equal(row?.verificationToken, "expired-token");
});

test("email unsubscribe only deletes the row bound to the signed email", async () => {
  await insertSubscription({ email: "new@example.com" });

  assert.deepEqual(await emailSettings.unsubscribeEmailNotificationSubscription(WALLET, "old@example.com"), {
    ok: false,
  });
  assert.equal((await dbModule.db.select().from(notificationEmailSubscriptions)).length, 1);

  assert.deepEqual(await emailSettings.unsubscribeEmailNotificationSubscription(WALLET, "new@example.com"), {
    ok: true,
  });
  assert.equal((await dbModule.db.select().from(notificationEmailSubscriptions)).length, 0);
});
