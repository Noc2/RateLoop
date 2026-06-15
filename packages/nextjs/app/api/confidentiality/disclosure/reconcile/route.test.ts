import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalCronSecret = env.CRON_SECRET;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.CRON_SECRET = "cron-secret";
env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type ConfidentialityContextModule = typeof import("~~/lib/confidentiality/context");
type DisclosureReconcileRoute = typeof import("./route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let confidentiality: ConfidentialityContextModule;
let disclosureReconcileRoute: DisclosureReconcileRoute;

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
  rateLimit = await import("~~/utils/rateLimit");
  confidentiality = await import("~~/lib/confidentiality/context");
  disclosureReconcileRoute = await import("./route");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(dbModule.dbClient);
  confidentiality.__setConfidentialitySettledAtLookupForTests(null);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  confidentiality.__setConfidentialitySettledAtLookupForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("CRON_SECRET", originalCronSecret);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("GET reconciles due disclosures with Vercel cron bearer auth", async () => {
  const settledAt = new Date("2026-06-11T12:34:56.000Z");
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: "42",
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
  confidentiality.__setConfidentialitySettledAtLookupForTests(async contentId =>
    contentId === "42" ? settledAt : null,
  );

  const response = await disclosureReconcileRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile?limit=1", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    checked: 1,
    due: 1,
    errors: [],
    ok: true,
    published: 1,
  });
});
