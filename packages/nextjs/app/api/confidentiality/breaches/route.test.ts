import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";

type DbModule = typeof import("~~/lib/db");
type DbSchemaModule = typeof import("~~/lib/db/schema");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type RateLimitModule = typeof import("~~/utils/rateLimit");
type SignedReadSessionsModule = typeof import("~~/lib/auth/signedReadSessions");
type ConfidentialityContextModule = typeof import("~~/lib/confidentiality/context");
type ConfidentialityBreachesRoute = typeof import("./route");

const REPORTER = "0x1234567890abcdef1234567890abcdef12345678" as const;
const ACCUSED_WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;
const CONTENT_ID = "42";
const IDENTITY_KEY = `0x${"a".repeat(64)}`;
const EVIDENCE_HASH = `0x${"b".repeat(64)}`;
const VIEW_TOKEN = "c".repeat(64);

let dbModule: DbModule;
let dbSchema: DbSchemaModule;
let dbTestMemory: DbTestMemoryModule;
let rateLimit: RateLimitModule;
let signedReadSessions: SignedReadSessionsModule;
let confidentiality: ConfidentialityContextModule;
let breachesRoute: ConfidentialityBreachesRoute;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

async function issueReporterCookie() {
  const session = await signedReadSessions.issueSignedReadSession(REPORTER, "gated_context");
  const cookie = signedReadSessions.getSignedReadSessionCookie("gated_context", session);
  return `${cookie.name}=${cookie.value}`;
}

async function breachRequest(body: Record<string, unknown>) {
  return new NextRequest("https://rateloop.ai/api/confidentiality/breaches", {
    body: JSON.stringify(body),
    headers: new Headers({
      "content-type": "application/json",
      cookie: await issueReporterCookie(),
      "x-real-ip": "198.51.100.7",
    }),
    method: "POST",
  });
}

before(async () => {
  dbModule = await import("~~/lib/db");
  dbSchema = await import("~~/lib/db/schema");
  dbTestMemory = await import("~~/lib/db/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
  confidentiality = await import("~~/lib/confidentiality/context");
  breachesRoute = await import("./route");
});

beforeEach(async () => {
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  rateLimit.__setRateLimitStoreForTests(dbModule.dbClient);
});

after(() => {
  rateLimit.__setRateLimitStoreForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
});

test("breach reports bind a matching view token to access-log and log-root evidence", async () => {
  const viewedAt = new Date("2026-06-11T14:30:00.000Z");
  const epoch = confidentiality.confidentialityEpochForDate(viewedAt);
  const [accessLog] = await dbModule.db
    .insert(dbSchema.confidentialContextAccessLogs)
    .values({
      contentId: CONTENT_ID,
      identityKey: IDENTITY_KEY,
      resourceId: "det_private001",
      resourceKind: "details",
      viewedAt,
      viewToken: VIEW_TOKEN,
      walletAddress: ACCUSED_WALLET,
    })
    .returning({ id: dbSchema.confidentialContextAccessLogs.id });
  await dbModule.db.insert(dbSchema.confidentialityLogRoots).values({
    accessCount: 1,
    acceptanceCount: 0,
    artifactHash: `0x${"d".repeat(64)}`,
    artifactUrl: "https://rateloop.ai/api/confidentiality/log-roots/2026-06-11/artifact",
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    epoch,
    merkleRoot: `0x${"e".repeat(64)}`,
    publishedAt: new Date("2026-06-12T00:01:00.000Z"),
  });

  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: IDENTITY_KEY,
      contentId: CONTENT_ID,
      evidenceHash: EVIDENCE_HASH,
      reporter: REPORTER,
      viewToken: VIEW_TOKEN,
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: 1, ok: true });

  const rows = await dbModule.dbClient.execute(
    "SELECT access_log_id, epoch, proof, status FROM confidentiality_breach_reports",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].access_log_id, accessLog.id);
  assert.equal(rows.rows[0].epoch, epoch);
  assert.equal(rows.rows[0].status, "access_rooted");
  const proof = JSON.parse(String(rows.rows[0].proof)) as {
    accessLog: { id: number; identityKey: string };
    logRoot: { epoch: string; artifactHash: string } | null;
    schemaVersion: string;
    viewToken: string;
  };
  assert.equal(proof.schemaVersion, "rateloop.confidentiality-breach-proof.v1");
  assert.equal(proof.accessLog.id, accessLog.id);
  assert.equal(proof.accessLog.identityKey, IDENTITY_KEY);
  assert.equal(proof.logRoot?.epoch, epoch);
  assert.equal(proof.viewToken, VIEW_TOKEN);
});

test("breach reports reject view tokens that do not match the accused confidential access", async () => {
  await dbModule.db.insert(dbSchema.confidentialContextAccessLogs).values({
    contentId: CONTENT_ID,
    identityKey: IDENTITY_KEY,
    resourceId: "det_private001",
    resourceKind: "details",
    viewedAt: new Date("2026-06-11T14:30:00.000Z"),
    viewToken: VIEW_TOKEN,
    walletAddress: ACCUSED_WALLET,
  });

  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: `0x${"f".repeat(64)}`,
      contentId: CONTENT_ID,
      evidenceHash: EVIDENCE_HASH,
      reporter: REPORTER,
      viewToken: VIEW_TOKEN,
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "View token does not match a confidential access log" });
});
