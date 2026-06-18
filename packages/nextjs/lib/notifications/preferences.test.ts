import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type PreferencesModule = typeof import("~~/lib/notifications/preferences");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let preferencesModule: PreferencesModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testMemory");
  preferencesModule = await import("~~/lib/notifications/preferences");
});

beforeEach(() => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
});

after(() => {
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("notification preference defaults include confidentiality preferences", async () => {
  const preferences = await preferencesModule.getNotificationPreferences(WALLET);

  assert.equal(preferences.contextNowPublic, true);
  assert.equal(preferences.breachReported, true);
  assert.equal(preferences.cohortBreachAnnouncement, true);
});

test("notification preferences persist confidentiality preferences", async () => {
  const saved = await preferencesModule.upsertNotificationPreferences(WALLET, {
    normalizedAddress: WALLET,
    roundResolved: false,
    settlingSoonHour: true,
    settlingSoonDay: false,
    followedSubmission: true,
    followedResolution: false,
    contextNowPublic: false,
    breachReported: true,
    cohortBreachAnnouncement: false,
  });

  assert.equal(saved.contextNowPublic, false);
  assert.equal(saved.breachReported, true);
  assert.equal(saved.cohortBreachAnnouncement, false);

  const loaded = await preferencesModule.getNotificationPreferences(WALLET);
  assert.equal(loaded.contextNowPublic, false);
  assert.equal(loaded.breachReported, true);
  assert.equal(loaded.cohortBreachAnnouncement, false);
});
