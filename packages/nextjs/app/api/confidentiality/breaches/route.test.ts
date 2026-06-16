import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
type ConfidentialityBreachArtifactRoute = typeof import("./[id]/artifact/route");

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
let breachArtifactRoute: ConfidentialityBreachArtifactRoute;

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

function sha256Hash(value: string) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function currentDeploymentScope() {
  const scope = confidentiality.resolveCurrentConfidentialityDeploymentScope();
  assert.ok(scope);
  return scope;
}

async function insertRootedAccess(params: { anchored?: boolean } = {}) {
  const viewedAt = new Date("2026-06-11T14:30:00.000Z");
  const epoch = confidentiality.confidentialityEpochForDate(viewedAt);
  const scope = currentDeploymentScope();
  const [accessLog] = await dbModule.db
    .insert(dbSchema.confidentialContextAccessLogs)
    .values({
      chainId: scope.chainId,
      contentId: CONTENT_ID,
      contentRegistryAddress: scope.contentRegistryAddress,
      deploymentKey: scope.deploymentKey,
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
    anchorChainId: params.anchored === false ? null : 31337,
    anchorContract: params.anchored === false ? null : "0x1111111111111111111111111111111111111111",
    anchorPublishedAt: params.anchored === false ? null : new Date("2026-06-12T00:02:00.000Z"),
    anchorTxHash: params.anchored === false ? null : `0x${"1".repeat(64)}`,
    artifactHash: `0x${"d".repeat(64)}`,
    artifactUrl: "https://rateloop.ai/api/confidentiality/log-roots/2026-06-11/artifact",
    createdAt: new Date("2026-06-12T00:00:00.000Z"),
    epoch,
    merkleRoot: `0x${"e".repeat(64)}`,
    publishedAt: new Date("2026-06-12T00:01:00.000Z"),
  });
  return { accessLog, epoch };
}

before(async () => {
  dbModule = await import("~~/lib/db");
  dbSchema = await import("~~/lib/db/schema");
  dbTestMemory = await import("~~/lib/db/testMemory");
  rateLimit = await import("~~/utils/rateLimit");
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
  confidentiality = await import("~~/lib/confidentiality/context");
  breachesRoute = await import("./route");
  breachArtifactRoute = await import("./[id]/artifact/route");
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
  const { accessLog, epoch } = await insertRootedAccess();

  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: IDENTITY_KEY,
      contentId: CONTENT_ID,
      externalEvidenceHash: EVIDENCE_HASH,
      evidenceUrl: "https://rateloop.ai/confidentiality/evidence/report-1",
      reporter: REPORTER,
      viewToken: VIEW_TOKEN,
    }),
  );

  const body = (await response.json()) as {
    evidenceArtifactUrl: string;
    evidenceHash: string;
    id: number;
    ok: boolean;
  };
  assert.equal(response.status, 201);
  assert.equal(body.id, 1);
  assert.equal(body.ok, true);
  assert.match(body.evidenceHash, /^0x[0-9a-f]{64}$/);
  assert.equal(body.evidenceArtifactUrl, "https://rateloop.ai/api/confidentiality/breaches/1/artifact");

  const rows = await dbModule.dbClient.execute(
    "SELECT access_log_id, epoch, evidence_hash, proof, status FROM confidentiality_breach_reports",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].access_log_id, accessLog.id);
  assert.equal(rows.rows[0].epoch, epoch);
  assert.equal(rows.rows[0].evidence_hash, body.evidenceHash);
  assert.equal(rows.rows[0].evidence_hash, sha256Hash(String(rows.rows[0].proof)));
  assert.equal(rows.rows[0].status, "evidence_artifact_published");
  const proof = JSON.parse(String(rows.rows[0].proof)) as {
    accessLog: { id: number; identityKey: string; leafHash: string; viewToken: string };
    externalEvidence: { hash: string | null; url: string | null };
    logRoot: { anchor: { txHash: string }; epoch: string; artifactHash: string } | null;
    schemaVersion: string;
  };
  assert.equal(proof.schemaVersion, "rateloop.confidentiality-breach-evidence.v1");
  assert.equal(proof.externalEvidence.hash, EVIDENCE_HASH);
  assert.equal(proof.externalEvidence.url, "https://rateloop.ai/confidentiality/evidence/report-1");
  assert.equal(proof.accessLog.id, accessLog.id);
  assert.equal(proof.accessLog.identityKey, IDENTITY_KEY);
  assert.equal(proof.accessLog.viewToken, VIEW_TOKEN);
  assert.match(proof.accessLog.leafHash, /^0x[0-9a-f]{64}$/);
  assert.equal(proof.logRoot?.epoch, epoch);
  assert.equal(proof.logRoot?.anchor.txHash, `0x${"1".repeat(64)}`);

  const artifactResponse = await breachArtifactRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/breaches/1/artifact"),
    { params: Promise.resolve({ id: "1" }) },
  );
  assert.equal(artifactResponse.status, 200);
  assert.equal(artifactResponse.headers.get("x-rateloop-evidence-hash"), body.evidenceHash);
  assert.equal(artifactResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.deepEqual(await artifactResponse.json(), proof);
});

test("breach reports reject caller-supplied evidenceHash values that do not match the artifact", async () => {
  await insertRootedAccess();

  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: IDENTITY_KEY,
      contentId: CONTENT_ID,
      evidenceHash: EVIDENCE_HASH,
      reporter: REPORTER,
      viewToken: VIEW_TOKEN,
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "evidenceHash must match the breach evidence artifact" });
});

test("breach artifact routes reject stored proof bytes that do not match evidenceHash", async () => {
  const now = new Date("2026-06-12T12:00:00.000Z");
  await dbModule.db.insert(dbSchema.confidentialityBreachReports).values({
    accusedIdentityKey: IDENTITY_KEY,
    contentId: CONTENT_ID,
    createdAt: now,
    evidenceHash: EVIDENCE_HASH,
    proof: JSON.stringify({ schemaVersion: "legacy-or-tampered" }),
    reporter: REPORTER,
    status: "reported",
    updatedAt: now,
  });

  const artifactResponse = await breachArtifactRoute.GET(
    new NextRequest("https://rateloop.ai/api/confidentiality/breaches/1/artifact"),
    { params: Promise.resolve({ id: "1" }) },
  );
  assert.equal(artifactResponse.status, 409);
  assert.deepEqual(await artifactResponse.json(), { error: "Breach evidence artifact hash mismatch" });

  const listResponse = await breachesRoute.GET(
    new NextRequest(`https://rateloop.ai/api/confidentiality/breaches?contentId=${CONTENT_ID}`),
  );
  const body = (await listResponse.json()) as { reports: Array<{ evidenceArtifactUrl: string | null }> };
  assert.equal(listResponse.status, 200);
  assert.equal(body.reports[0]?.evidenceArtifactUrl, null);
});

test("breach reports require an anchored log root before publishing evidence", async () => {
  await insertRootedAccess({ anchored: false });

  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: IDENTITY_KEY,
      contentId: CONTENT_ID,
      reporter: REPORTER,
      viewToken: VIEW_TOKEN,
    }),
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "An anchored confidentiality log root is required before filing breach evidence",
  });
});

test("breach reports require a matching view token", async () => {
  const response = await breachesRoute.POST(
    await breachRequest({
      accusedIdentityKey: IDENTITY_KEY,
      contentId: CONTENT_ID,
      reporter: REPORTER,
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "A matching view token is required to file breach evidence" });
});

test("breach reports reject view tokens that do not match the accused confidential access", async () => {
  const scope = currentDeploymentScope();
  await dbModule.db.insert(dbSchema.confidentialContextAccessLogs).values({
    chainId: scope.chainId,
    contentId: CONTENT_ID,
    contentRegistryAddress: scope.contentRegistryAddress,
    deploymentKey: scope.deploymentKey,
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
