import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalAppUrl = env.APP_URL;
const originalCronSecret = env.CRON_SECRET;
const originalDatabaseUrl = env.DATABASE_URL;
const originalLogRootAnchorPrivateKey = env.RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY;
const originalNodeEnv = env.NODE_ENV;

env.APP_URL = "https://rateloop.ai";
env.CRON_SECRET = "cron-secret";
env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type LogRootPublishRoute = typeof import("./route");
type LogRootPublishCronRoute = typeof import("./cron/route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let logRootPublishRoute: LogRootPublishRoute;
let logRootPublishCronRoute: LogRootPublishCronRoute;

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
  logRootPublishRoute = await import("./route");
  logRootPublishCronRoute = await import("./cron/route");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(dbModule.dbClient);
  delete env.RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY;
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("CRON_SECRET", originalCronSecret);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("RATELOOP_CONFIDENTIALITY_LOG_ROOT_ANCHOR_PRIVATE_KEY", originalLogRootAnchorPrivateKey);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("GET is method-not-allowed and does not publish log-root artifacts", async () => {
  const response = logRootPublishRoute.GET();

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.deepEqual(await response.json(), {
    error: "Method not allowed. Use POST to publish confidentiality log roots.",
  });

  const rows = await dbModule.dbClient.execute("SELECT epoch FROM confidentiality_log_roots");
  assert.equal(rows.rowCount, 0);
});

test("POST rate-limits bad log-root job secrets before auth", async () => {
  let response: Response | null = null;
  for (let index = 1; index <= 21; index++) {
    response = await logRootPublishRoute.POST(
      new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish", {
        body: "{}",
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

test("cron adapter rate-limits bad log-root job secrets before auth", async () => {
  let response: Response | null = null;
  for (let index = 1; index <= 21; index++) {
    response = await logRootPublishCronRoute.GET(
      new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish/cron", {
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

test("POST publishes log-root artifacts with Vercel cron bearer auth", async () => {
  const response = await logRootPublishRoute.POST(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish", {
      body: JSON.stringify({ anchor: false, epoch: "2026-06-11" }),
      headers: new Headers({ authorization: "Bearer cron-secret" }),
      method: "POST",
    }),
  );

  const body = (await response.json()) as {
    anchor: { status: string };
    artifactHash: string;
    epoch: string;
    ok: boolean;
  };
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.epoch, "2026-06-11");
  assert.equal(body.anchor.status, "skipped");
  assert.match(body.artifactHash, /^0x[0-9a-f]{64}$/);

  const rows = await dbModule.dbClient.execute(
    "SELECT artifact_hash, artifact_url FROM confidentiality_log_roots WHERE epoch = '2026-06-11'",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].artifact_hash, body.artifactHash);
  assert.equal(rows.rows[0].artifact_url, "https://rateloop.ai/api/confidentiality/log-roots/2026-06-11/artifact");
});

test("POST requires an on-chain anchor by default before sealing an epoch", async () => {
  const response = await logRootPublishRoute.POST(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish", {
      body: JSON.stringify({ epoch: "2026-06-11" }),
      headers: new Headers({ authorization: "Bearer cron-secret" }),
      method: "POST",
    }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to publish confidentiality log root" });

  const rows = await dbModule.dbClient.execute("SELECT epoch FROM confidentiality_log_roots");
  assert.equal(rows.rowCount, 0);
});

test("cron adapter delegates Vercel GET requests to POST publication auth", async () => {
  const unauthorized = await logRootPublishCronRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish/cron"),
  );
  assert.equal(unauthorized.status, 401);

  const response = await logRootPublishCronRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish/cron", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    }),
  );
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to publish confidentiality log root" });

  const rows = await dbModule.dbClient.execute("SELECT epoch FROM confidentiality_log_roots");
  assert.equal(rows.rowCount, 0);
});

test("Vercel cron targets the log-root publish cron adapter", () => {
  const vercelConfig = JSON.parse(readFileSync(new URL("../../../../../vercel.json", import.meta.url), "utf8")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const logRootCrons = (vercelConfig.crons ?? []).filter(cron => cron.path?.includes("log-roots/publish"));

  assert.deepEqual(logRootCrons, [
    {
      path: "/api/confidentiality/log-roots/publish/cron",
      schedule: "7 0 * * *",
    },
  ]);
});
