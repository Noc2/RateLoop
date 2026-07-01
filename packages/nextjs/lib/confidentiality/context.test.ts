import { NextRequest } from "next/server";
import type { ConfidentialityTermsPayload } from "./context";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

const env = process.env as Record<string, string | undefined>;
const originalDatabaseUrl = env.DATABASE_URL;
const originalNodeEnv = env.NODE_ENV;
const originalConfidentialitySecret = env.RATELOOP_CONFIDENTIALITY_SECRET;
const originalAccessRecorderPrivateKey = env.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY;
const originalAppUrl = env.APP_URL;
const originalFrontendCode = env.NEXT_PUBLIC_FRONTEND_CODE;
const originalTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;

env.DATABASE_URL = "memory:";
env.NODE_ENV = "test";
env.RATELOOP_CONFIDENTIALITY_SECRET = "test-confidentiality-secret";
env.APP_URL = "https://rateloop.ai";
env.NEXT_PUBLIC_FRONTEND_CODE = "0x3333333333333333333333333333333333333333";

type DbModule = typeof import("~~/lib/db");
type DbTestMemoryModule = typeof import("~~/lib/db/testing/testMemory");
type ConfidentialityContextModule = typeof import("./context");
type SignedReadSessionsModule = typeof import("~~/lib/auth/signedReadSessions");

const WALLET = "0x1234567890abcdef1234567890abcdef12345678" as const;
const CONTENT_ID = "42";
const IDENTITY_KEY = `0x${"a".repeat(64)}` as const;
const FRONTEND_ADDRESS = env.NEXT_PUBLIC_FRONTEND_CODE as `0x${string}`;

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
  const deploymentScope = confidentiality.resolveCurrentConfidentialityDeploymentScope();
  assert.ok(deploymentScope);
  return {
    contentHash: `0x${"1".repeat(64)}`,
    contentId: CONTENT_ID,
    deploymentKey: deploymentScope.deploymentKey,
    detailsHash: `0x${"2".repeat(64)}`,
    frontendAddress: FRONTEND_ADDRESS,
    identityKey: IDENTITY_KEY,
    mediaTupleHash: `0x${"3".repeat(64)}`,
    normalizedAddress: WALLET,
    questionMetadataHash: `0x${"4".repeat(64)}`,
    termsDocHash: confidentiality.CONFIDENTIALITY_TERMS_DOC_HASH,
    termsUri: confidentiality.CONFIDENTIALITY_TERMS_URI,
    termsVersion: confidentiality.CONFIDENTIALITY_TERMS_VERSION,
  };
}

async function ensureGatedConfidentiality() {
  if (await confidentiality.getQuestionConfidentiality(CONTENT_ID)) return;
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
}

async function serverTermsPayload() {
  await ensureGatedConfidentiality();
  const serverPayload = await confidentiality.buildServerConfidentialityTermsPayload({
    address: WALLET,
    contentHash: `0x${"9".repeat(64)}`,
    contentId: CONTENT_ID,
    detailsHash: `0x${"8".repeat(64)}`,
    mediaTupleHash: `0x${"7".repeat(64)}`,
    questionMetadataHash: `0x${"6".repeat(64)}`,
  });
  if (!serverPayload.ok) throw new Error(serverPayload.error);
  return serverPayload.payload;
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
  const payload = await serverTermsPayload();
  await confidentiality.recordConfidentialityTermsAcceptance({
    nonce: "nonce-1",
    payload,
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
  dbTestMemory = await import("~~/lib/db/testing/testMemory");
  dbModule.__setDatabaseResourcesForTests(dbTestMemory.createMemoryDatabaseResources());
  confidentiality = await import("./context");
  signedReadSessions = await import("~~/lib/auth/signedReadSessions");
});

beforeEach(async () => {
  await clearTables();
  confidentiality.__setConfidentialityOnchainGateForTests(null);
  confidentiality.__setConfidentialitySettledAtLookupForTests(null);
  delete env.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY;
});

after(() => {
  confidentiality.__setConfidentialityOnchainGateForTests(null);
  confidentiality.__setConfidentialitySettledAtLookupForTests(null);
  dbModule.__setDatabaseResourcesForTests(null);
  restoreEnv("DATABASE_URL", originalDatabaseUrl);
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("RATELOOP_CONFIDENTIALITY_SECRET", originalConfidentialitySecret);
  restoreEnv("RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY", originalAccessRecorderPrivateKey);
  restoreEnv("APP_URL", originalAppUrl);
  restoreEnv("NEXT_PUBLIC_FRONTEND_CODE", originalFrontendCode);
  restoreEnv("NEXT_PUBLIC_TARGET_NETWORKS", originalTargetNetworks);
});

test("resolves explicit confidentiality deployment scopes when multiple target networks are configured", () => {
  const previousTargetNetworks = env.NEXT_PUBLIC_TARGET_NETWORKS;
  env.NEXT_PUBLIC_TARGET_NETWORKS = "8453,84532";
  try {
    assert.equal(confidentiality.resolveCurrentConfidentialityDeploymentScope(), null);

    const baseScope = confidentiality.resolveConfidentialityDeploymentScope({ chainId: 8453 });
    assert.equal(baseScope?.chainId, 8453);
    assert.match(baseScope?.deploymentKey ?? "", /^8453:/);

    const baseScopeByKey = confidentiality.resolveConfidentialityDeploymentScope({
      deploymentKey: baseScope?.deploymentKey,
    });
    assert.deepEqual(baseScopeByKey, baseScope);

    const sepoliaScope = confidentiality.resolveConfidentialityDeploymentScope({ chainId: "84532" } as any);
    assert.equal(sepoliaScope?.chainId, 84532);
    assert.match(sepoliaScope?.deploymentKey ?? "", /^84532:/);
  } finally {
    restoreEnv("NEXT_PUBLIC_TARGET_NETWORKS", previousTargetNetworks);
  }
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

test("resolves legacy unscoped confidentiality rows without leaking gated context", async () => {
  await dbModule.dbClient.execute(`
    INSERT INTO question_confidentiality (
      deployment_key,
      chain_id,
      content_registry_address,
      frontend_address,
      content_id,
      gated,
      bond_asset,
      bond_amount,
      disclosure_policy,
      published_at,
      question_metadata_hash,
      content_hash,
      details_hash,
      media_tuple_hash,
      created_at,
      updated_at
    ) VALUES (
      NULL,
      NULL,
      NULL,
      '0x0000000000000000000000000000000000000000',
      '${CONTENT_ID}',
      TRUE,
      'USDC',
      '0',
      'private_forever',
      NULL,
      '0x${"4".repeat(64)}',
      '0x${"1".repeat(64)}',
      '0x${"2".repeat(64)}',
      '0x${"3".repeat(64)}',
      NOW(),
      NOW()
    )
  `);

  const gated = await confidentiality.getQuestionConfidentiality(CONTENT_ID);
  assert.equal(gated?.gated, true);
  assert.equal(gated?.deploymentKey, null);
  assert.equal(gated?.frontendAddress, "0x0000000000000000000000000000000000000000");

  const serverPayload = await confidentiality.buildServerConfidentialityTermsPayload({
    address: WALLET,
    contentId: CONTENT_ID,
  });
  assert.equal(serverPayload.ok, true);
  if (!serverPayload.ok) return;
  assert.equal(
    serverPayload.payload.deploymentKey,
    confidentiality.resolveCurrentConfidentialityDeploymentScope()?.deploymentKey,
  );
  assert.equal(serverPayload.payload.frontendAddress, FRONTEND_ADDRESS);
});

test("defaults omitted gated disclosure policy to private forever", async () => {
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        visibility: "gated",
      },
    },
  });

  const gated = await confidentiality.getQuestionConfidentiality(CONTENT_ID);
  assert.equal(gated?.gated, true);
  assert.equal(gated?.disclosurePolicy, "private_forever");
});

test("reconciles due gated disclosure rows after settlement", async () => {
  const settledAt = new Date("2026-06-11T12:34:56.000Z");
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: "43",
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "private_forever",
        visibility: "gated",
      },
    },
  });
  confidentiality.__setConfidentialitySettledAtLookupForTests(async contentId =>
    contentId === CONTENT_ID ? settledAt : null,
  );

  assert.deepEqual(await confidentiality.reconcileDueConfidentialDisclosure({ limit: 10 }), {
    checked: 1,
    due: 1,
    errors: [],
    published: 1,
  });

  const disclosed = await confidentiality.getQuestionConfidentiality(CONTENT_ID);
  const privateForever = await confidentiality.getQuestionConfidentiality("43");
  assert.equal(disclosed?.publishedAt?.toISOString(), settledAt.toISOString());
  assert.equal(privateForever?.publishedAt, null);
});

test("due disclosure reconciliation scans past older unsettled rows", async () => {
  const settledAt = new Date("2026-06-11T12:34:56.000Z");
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: "43",
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: "44",
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
    },
  });
  await dbModule.dbClient.execute(
    "UPDATE question_confidentiality SET created_at = '2026-06-01T00:00:00.000Z' WHERE content_id = '43'",
  );
  await dbModule.dbClient.execute(
    "UPDATE question_confidentiality SET created_at = '2026-06-02T00:00:00.000Z' WHERE content_id = '44'",
  );
  confidentiality.__setConfidentialitySettledAtLookupForTests(async contentId =>
    contentId === "44" ? settledAt : null,
  );

  assert.deepEqual(await confidentiality.reconcileDueConfidentialDisclosure({ limit: 1 }), {
    checked: 2,
    due: 1,
    errors: [],
    published: 1,
  });
  assert.equal(
    (await confidentiality.getQuestionConfidentiality("44"))?.publishedAt?.toISOString(),
    settledAt.toISOString(),
  );
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

test("server-bound terms payload ignores caller-supplied content commitments", async () => {
  const payload = await serverTermsPayload();
  assert.equal(payload.identityKey, null);
  assert.equal(payload.contentHash, `0x${"1".repeat(64)}`);
  assert.equal(payload.detailsHash, `0x${"2".repeat(64)}`);
  assert.equal(payload.mediaTupleHash, `0x${"3".repeat(64)}`);
  assert.equal(payload.questionMetadataHash, `0x${"4".repeat(64)}`);

  await confidentiality.recordConfidentialityTermsAcceptance({
    nonce: "nonce-server-bound",
    payload,
    signature: "0xab",
  });

  const rows = await dbModule.dbClient.execute(
    "SELECT payload_hash, question_metadata_hash, content_hash, details_hash, media_tuple_hash, identity_key FROM confidentiality_terms_acceptances",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].payload_hash, confidentiality.hashConfidentialityTermsPayload(payload));
  assert.equal(rows.rows[0].question_metadata_hash, payload.questionMetadataHash);
  assert.equal(rows.rows[0].content_hash, payload.contentHash);
  assert.equal(rows.rows[0].details_hash, payload.detailsHash);
  assert.equal(rows.rows[0].media_tuple_hash, payload.mediaTupleHash);
  assert.equal(rows.rows[0].identity_key, null);
});

test("gated context signed read sessions are short lived", async () => {
  const issuedAt = Date.now();
  const session = await signedReadSessions.issueSignedReadSession(WALLET, "gated_context");
  const ttlMs = session.expiresAt.getTime() - issuedAt;

  assert.ok(ttlMs <= signedReadSessions.GATED_CONTEXT_SIGNED_READ_SESSION_TTL_MS + 2_000);
  assert.ok(ttlMs > signedReadSessions.GATED_CONTEXT_SIGNED_READ_SESSION_TTL_MS - 2_000);
});

test("owner context signed read sessions are short lived", async () => {
  const issuedAt = Date.now();
  const session = await signedReadSessions.issueSignedReadSession(WALLET, "owner_context");
  const ttlMs = session.expiresAt.getTime() - issuedAt;

  assert.ok(ttlMs <= signedReadSessions.OWNER_CONTEXT_SIGNED_READ_SESSION_TTL_MS + 2_000);
  assert.ok(ttlMs > signedReadSessions.OWNER_CONTEXT_SIGNED_READ_SESSION_TTL_MS - 2_000);
});

test("authorizes owners with owner context sessions without gated terms", async () => {
  await ensureGatedConfidentiality();
  const deploymentScope = confidentiality.resolveCurrentConfidentialityDeploymentScope();
  assert.ok(deploymentScope);
  const session = await signedReadSessions.issueSignedReadSession(WALLET, "owner_context");
  const cookie = signedReadSessions.getSignedReadSessionCookie("owner_context", session);
  const request = new NextRequest(
    `https://rateloop.ai/api/attachments/details/det_contextaccess001?address=${WALLET}`,
    {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    },
  );

  const authorization = await confidentiality.authorizeGatedContextRequest(request, CONTENT_ID, {
    ownerWalletAddress: WALLET,
  });
  assert.deepEqual(authorization, {
    ok: true,
    deploymentKey: deploymentScope.deploymentKey,
    frontendAddress: FRONTEND_ADDRESS,
    identityKey: null,
    walletAddress: WALLET,
  });
});

test("does not authorize owner bypass from a gated context session without terms", async () => {
  await ensureGatedConfidentiality();
  const session = await signedReadSessions.issueSignedReadSession(WALLET, "gated_context");
  const cookie = signedReadSessions.getSignedReadSessionCookie("gated_context", session);
  const request = new NextRequest(
    `https://rateloop.ai/api/attachments/details/det_contextaccess001?address=${WALLET}`,
    {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    },
  );

  const authorization = await confidentiality.authorizeGatedContextRequest(request, CONTENT_ID, {
    ownerWalletAddress: WALLET,
  });
  assert.deepEqual(authorization, {
    ok: false,
    status: 403,
    error: "Confidentiality terms acceptance required",
  });
});

test("rejects gated reads when an acceptance no longer matches current content commitments", async () => {
  installConfidentialityGate();
  await createAcceptedRequest();
  await confidentiality.upsertQuestionConfidentialityFromMetadata({
    contentId: CONTENT_ID,
    metadata: {
      confidentiality: {
        bond: { amount: "0", asset: "USDC" },
        disclosurePolicy: "after_settlement",
        visibility: "gated",
      },
      contentHash: `0x${"1".repeat(64)}`,
      detailsHash: `0x${"9".repeat(64)}`,
      mediaTupleHash: `0x${"3".repeat(64)}`,
    },
    questionMetadataHash: `0x${"4".repeat(64)}`,
  });

  const session = await signedReadSessions.issueSignedReadSession(WALLET, "gated_context");
  const cookie = signedReadSessions.getSignedReadSessionCookie("gated_context", session);
  const request = new NextRequest(
    `https://rateloop.ai/api/attachments/details/det_contextaccess001?address=${WALLET}`,
    {
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    },
  );

  const authorization = await confidentiality.authorizeGatedContextRequest(request, CONTENT_ID);
  assert.deepEqual(authorization, {
    ok: false,
    status: 403,
    error: "Confidentiality terms acceptance required",
  });
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
    deploymentKey: authorization.deploymentKey,
    frontendAddress: authorization.frontendAddress,
    identityKey: authorization.identityKey,
    resourceId,
    walletAddress: authorization.walletAddress,
  });
  await confidentiality.logConfidentialContextAccess({
    contentId: CONTENT_ID,
    deploymentKey: authorization.deploymentKey,
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

  const deploymentScope = confidentiality.resolveCurrentConfidentialityDeploymentScope();
  assert.ok(deploymentScope);
  await dbModule.dbClient.execute({
    sql: `
      INSERT INTO confidential_context_access_logs (
        deployment_key, frontend_address, chain_id, content_registry_address,
        identity_key, wallet_address, content_id, resource_id, resource_kind, view_token, viewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      "999:0x9999999999999999999999999999999999999999",
      FRONTEND_ADDRESS,
      999,
      "0x9999999999999999999999999999999999999999",
      IDENTITY_KEY,
      WALLET,
      CONTENT_ID,
      "det_foreign001",
      "details",
      "c".repeat(64),
      new Date().toISOString(),
    ],
  });

  const root = await confidentiality.publishConfidentialityLogRoot({
    epoch: confidentiality.confidentialityEpochForDate(new Date()),
    now: new Date(),
  });
  assert.equal(root.accessCount, 1);
  assert.equal(root.acceptanceCount, 1);
  assert.equal(root.anchor.status, "skipped");
  assert.equal(root.chainId, deploymentScope.chainId);
  assert.equal(root.contentRegistryAddress, deploymentScope.contentRegistryAddress);
  assert.equal(root.deploymentKey, deploymentScope.deploymentKey);
  assert.equal(root.frontendAddress, FRONTEND_ADDRESS);
  assert.equal(
    root.artifactUrl,
    `https://rateloop.ai/api/confidentiality/log-roots/${root.epoch}/artifact?deploymentKey=${encodeURIComponent(
      deploymentScope.deploymentKey,
    )}&frontendAddress=${FRONTEND_ADDRESS}`,
  );
  assert.match(root.artifactHash, /^0x[0-9a-f]{64}$/);
  assert.match(root.merkleRoot, /^0x[0-9a-f]{64}$/);

  const rootRows = await dbModule.dbClient.execute({
    sql: `
      SELECT artifact_hash, artifact_json, artifact_url, anchor_tx_hash, deployment_key, frontend_address
        FROM confidentiality_log_roots
       WHERE deployment_key = ? AND frontend_address = ? AND epoch = ?
    `,
    args: [deploymentScope.deploymentKey, FRONTEND_ADDRESS, root.epoch],
  });
  assert.equal(rootRows.rowCount, 1);
  assert.equal(rootRows.rows[0].artifact_hash, root.artifactHash);
  assert.equal(rootRows.rows[0].artifact_url, root.artifactUrl);
  assert.equal(rootRows.rows[0].anchor_tx_hash, null);
  assert.equal(rootRows.rows[0].deployment_key, deploymentScope.deploymentKey);
  assert.equal(rootRows.rows[0].frontend_address, FRONTEND_ADDRESS);
  const artifact = JSON.parse(String(rootRows.rows[0].artifact_json));
  assert.equal(artifact.schemaVersion, "rateloop.confidentiality-log-root.v3");
  assert.equal(artifact.deploymentKey, deploymentScope.deploymentKey);
  assert.equal(artifact.frontendAddress, FRONTEND_ADDRESS);
  assert.equal(artifact.chainId, deploymentScope.chainId);
  assert.equal(artifact.contentRegistryAddress, deploymentScope.contentRegistryAddress);
  assert.equal(artifact.merkleRoot, root.merkleRoot);
  assert.equal(artifact.acceptanceCount, 1);
  assert.equal(artifact.accessCount, 1);
  assert.equal(artifact.leaves.length, 2);

  const retry = await confidentiality.publishConfidentialityLogRoot({
    epoch: root.epoch,
    now: new Date(),
  });
  assert.equal(retry.anchor.status, "already_published");
  assert.equal(retry.artifactHash, root.artifactHash);

  await dbModule.dbClient.execute({
    sql: `
      INSERT INTO confidential_context_access_logs (
        deployment_key, frontend_address, chain_id, content_registry_address,
        identity_key, wallet_address, content_id, resource_id, resource_kind, view_token, viewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      deploymentScope.deploymentKey,
      FRONTEND_ADDRESS,
      deploymentScope.chainId,
      deploymentScope.contentRegistryAddress,
      IDENTITY_KEY,
      WALLET,
      CONTENT_ID,
      "det_contextaccess002",
      "details",
      "b".repeat(64),
      new Date().toISOString(),
    ],
  });
  await assert.rejects(
    () =>
      confidentiality.publishConfidentialityLogRoot({
        epoch: root.epoch,
        now: new Date(),
      }),
    /already sealed/,
  );
});

test("persists log-root artifacts when on-chain anchoring fails", async () => {
  env.RATELOOP_CONFIDENTIALITY_ACCESS_RECORDER_PRIVATE_KEY = "not-a-private-key";

  const root = await confidentiality.publishConfidentialityLogRoot({
    epoch: "2026-06-11",
    now: new Date("2026-06-12T00:00:00.000Z"),
  });

  assert.equal(root.anchor.status, "failed");
  const rows = await dbModule.dbClient.execute(
    "SELECT artifact_hash, merkle_root, anchor_tx_hash, frontend_address FROM confidentiality_log_roots WHERE epoch = '2026-06-11'",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].artifact_hash, root.artifactHash);
  assert.equal(rows.rows[0].merkle_root, root.merkleRoot);
  assert.equal(rows.rows[0].anchor_tx_hash, null);
  assert.equal(rows.rows[0].frontend_address, FRONTEND_ADDRESS);
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
