import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  buildGrcEvidenceBundle,
  createWorkspaceGrcConnector,
  listWorkspaceGrcConnectors,
  pauseWorkspaceGrcConnector,
  processDueGrcReconciliations,
  updateWorkspaceGrcConnector,
} from "~~/lib/tokenless/assuranceGrcConnectors";
import {
  type GrcEvidenceBundle,
  type GrcProviderAdapter,
  createDrataGrcAdapter,
  createVantaGrcAdapter,
} from "~~/lib/tokenless/assuranceGrcProviders";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";
const PACKET_DIGEST = `sha256:${"a".repeat(64)}`;
const REFERENCE = "vault://rateloop/grc/workspace-a/vanta-primary";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function connectorBody(provider: "drata" | "vanta" = "vanta") {
  return {
    provider,
    displayName: `${provider} assurance evidence`,
    credentialReference: REFERENCE,
    providerConfig:
      provider === "vanta" ? { documentId: "rateloop-assurance" } : { connectionId: "42", resourceId: "7" },
    controlMappings: [
      {
        mappingId: "human-oversight",
        controlId: "ISO-42001-A.9.3",
        scopeId: "scope-support",
        minimumCoverageBps: 2_500,
        requireSignedPacket: true,
      },
    ],
    status: "enabled",
  };
}

function evidenceBundle(): GrcEvidenceBundle {
  return buildGrcEvidenceBundle({
    workspaceId: "ws_private_tenant",
    windowStart: new Date("2026-07-14T00:00:00.000Z"),
    windowEnd: new Date("2026-07-15T00:00:00.000Z"),
    generatedAt: new Date("2026-07-15T00:05:00.000Z"),
    mappings: connectorBody().controlMappings,
    source: {
      coverage: [{ scopeId: "scope-support", opportunityCount: 10, reviewedCount: 4 }],
      packets: [
        {
          packetId: "packet_opaque_1",
          scopeId: "scope-support",
          packetDigest: PACKET_DIGEST,
          signatureAlgorithm: "Ed25519",
          signingKeyId: "evidence-2026-07",
          generatedAt: new Date("2026-07-14T09:00:00.000Z"),
          signedPacket: {
            payload: { schemaVersion: "rateloop.assurance-evidence.v3", packetId: "packet_opaque_1" },
            signing: { algorithm: "Ed25519", keyId: "evidence-2026-07", publicKey: "public-key-pin" },
            packetDigest: PACKET_DIGEST,
            signature: "signature-value",
          },
        },
      ],
    },
  });
}

test("normalized GRC evidence is deterministic, control-mapped, and omits raw tenant and review content", () => {
  const bundle = evidenceBundle();
  const repeated = evidenceBundle();
  assert.deepEqual(bundle, repeated);
  assert.equal(bundle.coverageTests[0]?.status, "passing");
  assert.equal(bundle.coverageTests[0]?.coverageBps, 4_000);
  assert.equal(bundle.coverageTests[0]?.signedPacketCount, 1);
  assert.deepEqual(bundle.documentEvidence[0]?.controlIds, ["ISO-42001-A.9.3"]);
  assert.equal(bundle.documentEvidence[0]?.packetDigest, PACKET_DIGEST);
  assert.equal(bundle.documentEvidence[0]?.signedPacket.packetDigest, PACKET_DIGEST);
  const encoded = JSON.stringify(bundle);
  assert.doesNotMatch(encoded, /ws_private_tenant|scope-support/u);
  assert.doesNotMatch(encoded, /question|answer|rawRationale|ciphertext|credential|token|secret/iu);
  assert.match(bundle.bundleDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("Drata uses a stable complete custom-connection session and skips an already-active retry", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createDrataGrcAdapter(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const idempotencyKey = "nightly-idempotency-key";
  const session = `rl_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 40)}`;
  await adapter.deliver({
    bundle: evidenceBundle(),
    credential: "drata-token-never-persisted",
    idempotencyKey,
    providerConfig: { connectionId: "42", resourceId: "7" },
  });
  assert.equal(calls.length, 3);
  const upload = calls.find(call => call.url.endsWith(`/sessions/${session}`));
  assert.ok(upload);
  const body = JSON.parse(String(upload.init?.body)) as { data: Array<{ recordType: string }> };
  assert.deepEqual(body.data.map(record => record.recordType).sort(), [
    "oversight_coverage_test",
    "signed_packet_document_evidence",
  ]);
  assert.ok(calls.some(call => call.url.endsWith(`/sessions/${session}/actions`)));

  calls.length = 0;
  const activeAdapter = createDrataGrcAdapter(async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [{ sessionId: session, status: "ACTIVE" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const delivered = await activeAdapter.deliver({
    bundle: evidenceBundle(),
    credential: "drata-token-never-persisted",
    idempotencyKey,
    providerConfig: { connectionId: "42", resourceId: "7" },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/public\/v2\/custom-connections\/42\/resources\/7\/sessions$/u);
  assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, "Bearer drata-token-never-persisted");
  assert.match(delivered.externalReference, new RegExp(`${session}$`, "u"));
});

test("Vanta uploads one stable JSON document, submits it, and recognizes a prior upload on retry", async () => {
  const bundle = evidenceBundle();
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createVantaGrcAdapter(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("?pageSize=")) {
      return new Response(JSON.stringify({ results: { data: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).endsWith("/uploads")) {
      assert.ok(init?.body instanceof FormData);
      const file = init.body.get("file");
      assert.ok(file instanceof Blob);
      assert.equal(file.type, "application/json");
      return new Response(JSON.stringify({ id: "upload-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 200 });
  });
  const first = await adapter.deliver({
    bundle,
    credential: "vanta-token-never-persisted",
    idempotencyKey: "vanta-nightly-1",
    providerConfig: { documentId: "rateloop-assurance" },
  });
  assert.equal(calls.length, 3);
  assert.equal(first.externalReference, "vanta:document:rateloop-assurance:upload:upload-1");

  const fileName = `rateloop-assurance-${bundle.bundleId}.json`;
  const retryCalls: string[] = [];
  const retryAdapter = createVantaGrcAdapter(async url => {
    retryCalls.push(String(url));
    return new Response(JSON.stringify({ results: { data: [{ id: "upload-1", fileName }] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await retryAdapter.deliver({
    bundle,
    credential: "vanta-token-never-persisted",
    idempotencyKey: "vanta-nightly-1",
    providerConfig: { documentId: "rateloop-assurance" },
  });
  assert.equal(retryCalls.length, 1);
});

test("provider network failures are retryable and never echo credentials", async () => {
  const adapter = createVantaGrcAdapter(async () => {
    throw new TypeError("socket failed with vanta-token-never-persisted");
  });
  await assert.rejects(
    () =>
      adapter.deliver({
        bundle: evidenceBundle(),
        credential: "vanta-token-never-persisted",
        idempotencyKey: "vanta-nightly-network-error",
        providerConfig: { documentId: "rateloop-assurance" },
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "vanta_grc_delivery_failed" &&
      error.retryable &&
      !error.message.includes("vanta-token-never-persisted"),
  );
});

test("workspace managers configure isolated connectors without returning credential references", async () => {
  const first = await createWorkspace({ name: "First GRC tenant", ownerAddress: OWNER_A });
  const second = await createWorkspace({ name: "Second GRC tenant", ownerAddress: OWNER_B });
  await assert.rejects(
    () =>
      createWorkspaceGrcConnector({
        accountAddress: OWNER_A,
        workspaceId: first.workspaceId,
        body: { ...connectorBody(), credentialReference: "vanta-plaintext-token" },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_grc_connector",
  );
  const created = await createWorkspaceGrcConnector({
    accountAddress: OWNER_A,
    workspaceId: first.workspaceId,
    body: connectorBody(),
    now: new Date("2026-07-15T11:00:00.000Z"),
  });
  assert.equal(created.provider, "vanta");
  assert.equal(created.credentialConfigured, true);
  assert.equal("credentialReference" in created, false);
  assert.match(created.credentialReferenceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    (await listWorkspaceGrcConnectors({ accountAddress: OWNER_B, workspaceId: second.workspaceId })).length,
    0,
  );
  await assert.rejects(
    () => listWorkspaceGrcConnectors({ accountAddress: OWNER_B, workspaceId: first.workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  const stored = await dbClient.execute({
    sql: `SELECT credential_reference, provider_config_json FROM tokenless_assurance_grc_connectors
          WHERE connector_id = ?`,
    args: [created.connectorId],
  });
  assert.equal(stored.rows[0]?.credential_reference, REFERENCE);
  assert.doesNotMatch(String(stored.rows[0]?.provider_config_json), /token|secret|authorization/iu);

  const update = connectorBody();
  delete (update as Partial<typeof update>).credentialReference;
  update.displayName = "Vanta assurance status";
  const updated = await updateWorkspaceGrcConnector({
    accountAddress: OWNER_A,
    workspaceId: first.workspaceId,
    connectorId: created.connectorId,
    body: update,
    now: new Date("2026-07-15T12:00:00.000Z"),
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.credentialReferenceDigest, created.credentialReferenceDigest);
  await assert.rejects(
    () =>
      pauseWorkspaceGrcConnector({
        accountAddress: OWNER_B,
        workspaceId: first.workspaceId,
        connectorId: created.connectorId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await pauseWorkspaceGrcConnector({
    accountAddress: OWNER_A,
    workspaceId: first.workspaceId,
    connectorId: created.connectorId,
  });
  assert.equal(
    (await listWorkspaceGrcConnectors({ accountAddress: OWNER_A, workspaceId: first.workspaceId }))[0]?.status,
    "paused",
  );
});

test("nightly reconciliation retries safely and persists one digest-bound receipt", async () => {
  const workspace = await createWorkspace({ name: "Nightly GRC", ownerAddress: OWNER_A });
  const created = await createWorkspaceGrcConnector({
    accountAddress: OWNER_A,
    workspaceId: workspace.workspaceId,
    body: connectorBody(),
    now: new Date("2026-07-14T11:00:00.000Z"),
  });
  const dueAt = new Date("2026-07-15T00:00:00.000Z");
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_grc_connectors SET next_reconcile_at = ? WHERE connector_id = ?",
    args: [dueAt, created.connectorId],
  });
  const seenIdempotencyKeys: string[] = [];
  let attempts = 0;
  const adapter: GrcProviderAdapter = {
    provider: "vanta",
    async deliver(input) {
      attempts += 1;
      seenIdempotencyKeys.push(input.idempotencyKey);
      if (attempts === 1) {
        throw new TokenlessServiceError("temporary", 503, "vanta_grc_delivery_failed", true);
      }
      return { externalReference: "vanta:document:rateloop-assurance:upload:stable", recordCount: 2 };
    },
  };
  const source = async () => ({
    coverage: [{ scopeId: "scope-support", opportunityCount: 5, reviewedCount: 2 }],
    packets: [
      {
        packetId: "packet-nightly",
        scopeId: "scope-support",
        packetDigest: PACKET_DIGEST,
        signatureAlgorithm: "Ed25519",
        signingKeyId: "evidence-2026-07",
        generatedAt: new Date("2026-07-14T08:00:00.000Z"),
        signedPacket: {
          payload: { schemaVersion: "rateloop.assurance-evidence.v3", packetId: "packet-nightly" },
          signing: { algorithm: "Ed25519", keyId: "evidence-2026-07", publicKey: "public-key-pin" },
          packetDigest: PACKET_DIGEST,
          signature: "signature-value",
        },
      },
    ],
  });
  const first = await processDueGrcReconciliations({
    now: new Date("2026-07-15T00:05:00.000Z"),
    source,
    credentialResolver: async () => "runtime-only-token",
    adapters: { vanta: adapter },
  });
  assert.deepEqual(first, { enqueued: 1, claimed: 1, succeeded: 0, retry: 1, failed: 0 });
  const second = await processDueGrcReconciliations({
    now: new Date("2026-07-15T00:06:01.000Z"),
    source,
    credentialResolver: async () => "runtime-only-token",
    adapters: { vanta: adapter },
  });
  assert.deepEqual(second, { enqueued: 0, claimed: 1, succeeded: 1, retry: 0, failed: 0 });
  assert.equal(attempts, 2);
  assert.equal(seenIdempotencyKeys[0], seenIdempotencyKeys[1]);
  const receipts = await dbClient.execute({
    sql: `SELECT state, request_digest, external_reference, record_count
          FROM tokenless_assurance_grc_delivery_receipts WHERE connector_id = ?`,
    args: [created.connectorId],
  });
  assert.equal(receipts.rows.length, 1);
  assert.equal(receipts.rows[0]?.state, "delivered");
  assert.match(String(receipts.rows[0]?.request_digest), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(receipts.rows[0]?.record_count, 2);
  const jobs = await dbClient.execute({
    sql: `SELECT state, attempt_count, credential_reference, provider_config_json, control_mappings_json
          FROM tokenless_assurance_grc_reconciliation_jobs WHERE connector_id = ?`,
    args: [created.connectorId],
  });
  assert.deepEqual(
    jobs.rows.map(row => [row.state, row.attempt_count]),
    [["succeeded", 2]],
  );
  assert.doesNotMatch(JSON.stringify(jobs.rows), /runtime-only-token/u);
});
