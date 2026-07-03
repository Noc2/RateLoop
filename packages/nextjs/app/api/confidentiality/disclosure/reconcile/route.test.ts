import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalCronSecret = env.CRON_SECRET;
const originalDatabaseUrl = env.DATABASE_URL;
const originalFrontendCode = env.NEXT_PUBLIC_FRONTEND_CODE;
const originalNodeEnv = env.NODE_ENV;

env.CRON_SECRET = "cron-secret";
env.DATABASE_URL = "memory:";
env.NEXT_PUBLIC_FRONTEND_CODE = "0x3333333333333333333333333333333333333333";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
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
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
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
  restoreEnv("NEXT_PUBLIC_FRONTEND_CODE", originalFrontendCode);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("GET rate-limits bad disclosure reconciliation secrets before auth", async () => {
  let response: Response | null = null;
  for (let index = 1; index <= 21; index++) {
    response = await disclosureReconcileRoute.GET(
      new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile", {
        headers: new Headers({ authorization: "Bearer bad-secret" }),
      }),
    );
    if (index <= 20) {
      assert.equal(response.status, 401);
    }
  }

  assert.equal(response?.status, 429);
  assert.equal((await response?.json())?.code, "rate_limit_exceeded");
});

test("POST rate-limits bad disclosure reconciliation secrets before auth", async () => {
  let response: Response | null = null;
  for (let index = 1; index <= 21; index++) {
    response = await disclosureReconcileRoute.POST(
      new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile", {
        body: JSON.stringify({ contentIds: ["42"] }),
        headers: new Headers({
          authorization: "Bearer bad-secret",
          "content-type": "application/json",
        }),
        method: "POST",
      }),
    );
    if (index <= 20) {
      assert.equal(response.status, 401);
    }
  }

  assert.equal(response?.status, 429);
  assert.equal((await response?.json())?.code, "rate_limit_exceeded");
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

test("GET rejects malformed disclosure reconciliation limits", async () => {
  const invalidLimit = await disclosureReconcileRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile?limit=1junk", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    }),
  );
  assert.equal(invalidLimit.status, 400);
  assert.deepEqual(await invalidLimit.json(), { error: "limit must be a positive integer." });

  const invalidScanLimit = await disclosureReconcileRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/disclosure/reconcile?scanLimit=1junk", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    }),
  );
  assert.equal(invalidScanLimit.status, 400);
  assert.deepEqual(await invalidScanLimit.json(), { error: "scanLimit must be a positive integer." });
});
