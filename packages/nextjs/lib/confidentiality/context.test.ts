import { NextRequest } from "next/server";
import type { ConfidentialityTermsPayload } from "./context";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalConfidentialitySecret = env.RATELOOP_CONFIDENTIALITY_SECRET;
const originalAppUrl = env.APP_URL;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";
env.RATELOOP_CONFIDENTIALITY_SECRET = "test-confidentiality-secret";
env.APP_URL = "https://rateloop.ai";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testMemory");
type ConfidentialityContextModule = typeof import("./context");
type SignedReadSessionsModule = typeof import("~~/lib/auth/signedReadSessions");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const CONTENT_ID = "42";
const IDENTITY_KEY = `0x${"a".repeat(64)}` as const;

let dbModule: DbModule;
let dbTestMemory: DbTestMemoryModule;
let confidentiality: ConfidentialityContextModule;
let signedReadSessions: SignedReadSessionsModule;

function restoreEnv(name: keyof NodeJS.ProcessEnv, value: string | undefined) {
  if (value === undefined) {
    delete env[name];
  } else {
    env[name] = value;
  }
}

function termsPayload(): ConfidentialityTermsPayload {
  return {
    contentHash: `0x${"1".repeat(64)}`,
    contentId: CONTENT_ID,
    detailsHash: `0x${"2".repeat(64)}`,
    identityKey: IDENTITY_KEY,
    mediaTupleHash: `0x${"3".repeat(64)}`,
    normalizedAddress: WALLET,
    questionMetadataHash: `0x${"4".repeat(64)}`,
    termsDocHash: confidentiality.CONFIDENTIALITY_TERMS_DOC_HASH,
    termsUri: confidentiality.CONFIDENTIALITY_TERMS_URI,
    termsVersion: confidentiality.CONFIDENTIALITY_TERMS_VERSION,
  };
}

async function clearTables() {
  await dbModule.dbClient.execute("DELETE FROM confidentiality_log_roots");
  await dbModule.dbClient.execute("DELETE FROM confidential_context_access_logs");
  await dbModule.dbClient.execute("DELETE FROM confidentiality_terms_acceptances");
  await dbModule.dbClient.execute("DELETE FROM question_confidentiality");
  await dbModule.dbClient.execute("DELETE FROM signed_read_sessions");
}

function installConfidentialityGate(
  params: {
    banned?: boolean;
    hasActiveBond?: boolean;
    hasActiveHumanCredential?: boolean;
    identityKey?: `0x${string}` | null;
  } = {},
) {
  confidentiality.__setConfidentialityOnchainGateForTests({
    hasActiveBond: async () => params.hasActiveBond ?? true,
    isIdentityKeyBanned: async () => params.banned ?? false,
    resolveViewer: async () => ({
      delegated: false,
      hasActiveHumanCredential: params.hasActiveHumanCredential ?? true,
      holder: WALLET,
      humanNullifier: `0x${"b".repeat(64)}`,
      identityKey: params.identityKey === undefined ? IDENTITY_KEY : params.identityKey,
    }),
  });
}

async function createAcceptedRequest() {
  await confidentiality.recordConfidentialityTermsAcceptance({
    nonce: "nonce-1",
    payload: termsPayload(),
    signature: "0xab",
  });
  const session = await signedReadSessions.issueSignedReadSession(WALLET, "gated_context");
  const cookie = signedReadSessions.getSignedReadSessionCookie("gated_context", session);
  return new NextRequest(`https://rateloop.ai/api/attachments/details/det_contextaccess001?address=${WALLET}`, {
    headers: {
      cookie: `${cookie.name}=${cookie.value}`,
      "x-real-ip": "198.51.100.7",
    },
  });
}

before(async () => {
  dbModule = await import("~~/lib/db");
  dbTestMemory = await import("~~/lib/db/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  confidentiality = await import("./context");
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
});

beforeEach(async () => {
  await clearTables();
  confidentiality.__setConfidentialityOnchainGateForTests(null);
});

after(() => {
  confidentiality.__setConfidentialityOnchainGateForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATELOOP_CONFIDENTIALITY_SECRET", originalConfidentialitySecret);
  restoreEnv("APP_URL", originalAppUrl);
});

test("upserts gated metadata and flips disclosure after settlement", async () => {
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
      contentHash: `0x${"1".repeat(64)}`,
      detailsHash: `0x${"2".repeat(64)}`,
      mediaTupleHash: `0x${"3".repeat(64)}`,
    },
    questionMetadataHash: `0x${"4".repeat(64)}`,
  });

  const gated = await confidentiality.getQuestionConfidentiality(CONTENT_ID);
  assert.equal(gated?.gated, true);
  assert.equal(gated?.publishedAt, null);
  assert.equal(gated?.questionMetadataHash, `0x${"4".repeat(64)}`);

  const settledAt = new Date("2026-06-11T12:00:00.000Z");
  assert.deepEqual(
    await confidentiality.publishConfidentialContextAfterSettlement({ contentIds: [CONTENT_ID], settledAt }),
    { published: 1 },
  );

  const disclosed = await confidentiality.getQuestionConfidentiality(CONTENT_ID);
  assert.equal(disclosed?.publishedAt?.toISOString(), settledAt.toISOString());
  assert.equal(confidentiality.isConfidentialityCurrentlyGated(disclosed), false);
});

test("confidentiality terms acceptance requires the current document hash", async () => {
  await confidentiality.recordConfidentialityTermsAcceptance({
    nonce: "nonce-hash",
    payload: termsPayload(),
    signature: "0xab",
  });

  assert.equal(
    await confidentiality.hasConfidentialityTermsAcceptance({
      contentId: CONTENT_ID,
      walletAddress: WALLET,
    }),
    true,
  );
  assert.equal(
    await confidentiality.hasConfidentialityTermsAcceptance({
      contentId: CONTENT_ID,
      termsDocHash: "stale-document-hash",
      walletAddress: WALLET,
    }),
    false,
  );
});

test("authorizes accepted signed sessions and logs gated context access", async () => {
  installConfidentialityGate();
  const resourceId = "det_contextaccess001";
  const request = await createAcceptedRequest();

  const authorization = await confidentiality.authorizeGatedContextRequest(request, CONTENT_ID);
  assert.equal(authorization.ok, true);
  if (!authorization.ok) return;
  assert.equal(authorization.identityKey, IDENTITY_KEY);

  const viewToken = confidentiality.createConfidentialViewToken({
    contentId: CONTENT_ID,
    identityKey: authorization.identityKey,
    resourceId,
    walletAddress: authorization.walletAddress,
  });
  await confidentiality.logConfidentialContextAccess({
    contentId: CONTENT_ID,
    identityKey: authorization.identityKey,
    request,
    resourceId,
    resourceKind: "details",
    viewToken,
    walletAddress: authorization.walletAddress,
  });

  const accessRows = await dbModule.dbClient.execute(
    "SELECT content_id, identity_key, ip_hash, resource_kind FROM confidential_context_access_logs",
  );
  assert.equal(accessRows.rowCount, 1);
  assert.equal(accessRows.rows[0].content_id, CONTENT_ID);
  assert.equal(accessRows.rows[0].identity_key, IDENTITY_KEY);
  assert.equal(accessRows.rows[0].resource_kind, "details");
  assert.ok(accessRows.rows[0].ip_hash);

  const root = await confidentiality.publishConfidentialityLogRoot({
    epoch: confidentiality.confidentialityEpochForDate(new Date()),
    now: new Date(),
  });
  assert.equal(root.accessCount, 1);
  assert.equal(root.acceptanceCount, 1);
  assert.equal(root.anchor.status, "skipped");
  assert.equal(root.artifactUrl, `https://rateloop.ai/api/confidentiality/log-roots/${root.epoch}/artifact`);
  assert.match(root.artifactHash, /^0x[0-9a-f]{64}$/);
  assert.match(root.merkleRoot, /^0x[0-9a-f]{64}$/);

  const rootRows = await dbModule.dbClient.execute({
    sql: "SELECT artifact_hash, artifact_json, artifact_url, anchor_tx_hash FROM confidentiality_log_roots WHERE epoch = ?",
    args: [root.epoch],
  });
  assert.equal(rootRows.rowCount, 1);
  assert.equal(rootRows.rows[0].artifact_hash, root.artifactHash);
  assert.equal(rootRows.rows[0].artifact_url, root.artifactUrl);
  assert.equal(rootRows.rows[0].anchor_tx_hash, null);
  const artifact = JSON.parse(String(rootRows.rows[0].artifact_json));
  assert.equal(artifact.schemaVersion, "rateloop.confidentiality-log-root.v1");
  assert.equal(artifact.merkleRoot, root.merkleRoot);
  assert.equal(artifact.acceptanceCount, 1);
  assert.equal(artifact.accessCount, 1);
  assert.equal(artifact.leaves.length, 2);
});

test("rejects gated reads without an active human credential identity", async () => {
  installConfidentialityGate({ hasActiveHumanCredential: false, identityKey: null });
  const authorization = await confidentiality.authorizeGatedContextRequest(await createAcceptedRequest(), CONTENT_ID);

  assert.deepEqual(authorization, {
    ok: false,
    status: 403,
    error: "Active human credential required",
  });
});

test("rejects gated reads for banned identities", async () => {
  installConfidentialityGate({ banned: true });
  const authorization = await confidentiality.authorizeGatedContextRequest(await createAcceptedRequest(), CONTENT_ID);

  assert.deepEqual(authorization, {
    ok: false,
    status: 403,
    error: "Confidentiality access revoked",
  });
});

test("checks nonzero confidentiality bonds against the escrow gate", async () => {
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        bond: { amount: "5000000", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });

  installConfidentialityGate({ hasActiveBond: true });
  const allowed = await confidentiality.authorizeGatedContextRequest(await createAcceptedRequest(), CONTENT_ID);
  assert.equal(allowed.ok, true);
  if (!allowed.ok) return;
  assert.equal(allowed.identityKey, IDENTITY_KEY);

  installConfidentialityGate({ hasActiveBond: false });
  const denied = await confidentiality.authorizeGatedContextRequest(await createAcceptedRequest(), CONTENT_ID);
  assert.deepEqual(denied, {
    ok: false,
    status: 403,
    error: "Active confidentiality bond required",
  });
});

test("confidentiality terms challenge message shows the focused terms metadata", () => {
  const payload = termsPayload();
  const message = confidentiality.buildConfidentialityTermsChallengeMessage({
    address: payload.normalizedAddress,
    expiresAt: new Date("2026-06-12T12:00:00.000Z"),
    nonce: "nonce-terms",
    payloadHash: confidentiality.hashConfidentialityTermsPayload(payload),
    termsDocHash: payload.termsDocHash,
    termsUri: payload.termsUri,
    termsVersion: payload.termsVersion,
  });

  assert.match(message, new RegExp(`Terms URI: ${payload.termsUri}`));
  assert.match(message, new RegExp(`Terms Version: ${payload.termsVersion}`));
  assert.match(message, new RegExp(`Terms Hash: ${payload.termsDocHash}`));
  assert.match(message, /Terms: These are protocol-facing access terms/);
  assert.match(message, new RegExp(confidentiality.CONFIDENTIALITY_TERMS_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(message, /\/legal\/terms#confidential-context/);
});
