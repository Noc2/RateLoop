import { NextRequest } from "next/server";
import assert from "node:assert/strict";
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
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type LogRootPublishRoute = typeof import("./route");

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let logRootPublishRoute: LogRootPublishRoute;

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
  logRootPublishRoute = await import("./route");
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

test("GET publishes log-root artifacts with Vercel cron bearer auth", async () => {
  const response = await logRootPublishRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish?epoch=2026-06-11&anchor=false", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
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

test("GET requires an on-chain anchor by default before sealing an epoch", async () => {
  const response = await logRootPublishRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/log-roots/publish?epoch=2026-06-11", {
      headers: new Headers({ authorization: "Bearer cron-secret" }),
    }),
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Failed to publish confidentiality log root" });

  const rows = await dbModule.dbClient.execute("SELECT epoch FROM confidentiality_log_roots");
  assert.equal(rows.rowCount, 0);
});
