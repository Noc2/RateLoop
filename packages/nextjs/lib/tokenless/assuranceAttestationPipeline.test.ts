import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  enqueueAssuranceAttestation,
  getPublicAssuranceAttestationBundle,
  listAssuranceAttestations,
  processAssuranceAttestationJobs,
} from "~~/lib/tokenless/assuranceAttestationPipeline";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const DIGEST = `sha256:${"12".repeat(32)}`;

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function processor(
  options: { keyId?: string; rekorEntryUuid?: string; rekorLogIndex?: string; timestampByte?: number } = {},
) {
  const keys = generateKeyPairSync("ed25519");
  const calls = { rekor: 0, tsa: 0 };
  return {
    calls,
    signer: {
      custody: "managed" as const,
      keyId: options.keyId ?? "kms:rateloop:evidence:1",
      publicKeyDer: keys.publicKey.export({ format: "der", type: "spki" }),
      sign: async (payload: Buffer) => sign(null, payload, keys.privateKey),
    },
    rekor: {
      publish: async () => {
        calls.rekor += 1;
        return {
          entryUuid: options.rekorEntryUuid ?? "rekor-entry-1",
          logIndex: options.rekorLogIndex ?? "42",
          inclusionBundle: { verified: true },
        };
      },
    },
    tsa: {
      timestamp: async () => {
        calls.tsa += 1;
        return { token: Buffer.alloc(64, options.timestampByte ?? 7) };
      },
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(completed => {
    resolve = completed;
  });
  return { promise, resolve };
}

test("digest-only export jobs are idempotent and require Rekor plus RFC 3161 receipts", async () => {
  const { workspaceId } = await createWorkspace({ name: "Attestation export", ownerAddress: OWNER });
  const first = await enqueueAssuranceAttestation({
    workspaceId,
    kind: "audit_export_head",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop-audit-v1",
    boundaryAt: NOW,
    now: NOW,
  });
  assert.equal(first.replay, false);
  assert.equal(
    (
      await enqueueAssuranceAttestation({
        workspaceId,
        kind: "audit_export_head",
        artifactDigest: DIGEST,
        artifactSchemaVersion: "rateloop-audit-v1",
        boundaryAt: NOW,
        now: NOW,
      })
    ).replay,
    true,
  );
  const storedBefore = await dbClient.execute({
    sql: "SELECT statement_json FROM tokenless_assurance_attestation_jobs WHERE job_id=?",
    args: [first.jobId],
  });
  assert.doesNotMatch(String(storedBefore.rows[0].statement_json), new RegExp(workspaceId, "u"));

  const dependencies = processor();
  assert.deepEqual(await processAssuranceAttestationJobs({ ...dependencies, now: NOW, workspaceId }), [
    { jobId: first.jobId, state: "completed" },
  ]);
  assert.deepEqual(dependencies.calls, { rekor: 1, tsa: 1 });
  const listed = await listAssuranceAttestations({ accountAddress: OWNER, workspaceId });
  assert.equal(listed[0]?.state, "completed");
  assert.deepEqual(listed[0]?.rekor, { entryUuid: "rekor-entry-1", logIndex: "42" });
  assert.equal(listed[0]?.rfc3161TimestampPresent, true);
  assert.equal(listed[0]?.publicPath, `/api/public/assurance/attestations/${first.jobId}`);
  const publicBundle = await getPublicAssuranceAttestationBundle(first.jobId);
  assert.equal(publicBundle.schemaVersion, "rateloop.assurance-external-witness.v1");
  assert.equal(publicBundle.artifact.digest, DIGEST);
  assert.equal(publicBundle.dsse.signerKeyId, dependencies.signer.keyId);
  assert.deepEqual(publicBundle.rekor.bundle, { verified: true });
  assert.equal(publicBundle.rfc3161?.messageImprint.algorithm, "sha256");
  assert.equal(publicBundle.rfc3161?.tokenBase64, Buffer.alloc(64, 7).toString("base64"));
  assert.doesNotMatch(JSON.stringify(publicBundle), new RegExp(workspaceId, "u"));
  await assert.rejects(
    () => listAssuranceAttestations({ accountAddress: OUTSIDER, workspaceId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
});

test("decision packets use Rekor without requesting an export-boundary timestamp", async () => {
  const { workspaceId } = await createWorkspace({ name: "Attestation packet", ownerAddress: OWNER });
  const enqueued = await enqueueAssuranceAttestation({
    workspaceId,
    kind: "decision_packet",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
    boundaryAt: NOW,
    now: NOW,
  });
  const dependencies = processor();
  const outcome = await processAssuranceAttestationJobs({ ...dependencies, now: NOW });
  assert.deepEqual(outcome, [{ jobId: enqueued.jobId, state: "completed" }]);
  assert.deepEqual(dependencies.calls, { rekor: 1, tsa: 0 });
  const stored = await dbClient.execute({
    sql: `SELECT dsse_envelope_json,rekor_bundle_json,tsa_token_base64
          FROM tokenless_assurance_attestation_jobs WHERE job_id=?`,
    args: [enqueued.jobId],
  });
  assert.ok(stored.rows[0].dsse_envelope_json);
  assert.ok(stored.rows[0].rekor_bundle_json);
  assert.equal(stored.rows[0].tsa_token_base64, null);
});

test("external failures retain a bounded retry record and unmanaged signers fail closed", async () => {
  const { workspaceId } = await createWorkspace({ name: "Attestation retry", ownerAddress: OWNER });
  const enqueued = await enqueueAssuranceAttestation({
    workspaceId,
    kind: "coverage_export_head",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop.assurance-coverage-export.v1",
    boundaryAt: NOW,
    now: NOW,
  });
  const dependencies = processor();
  const retry = await processAssuranceAttestationJobs({
    ...dependencies,
    rekor: { publish: async () => Promise.reject(new Error("Rekor unavailable with private details")) },
    now: NOW,
  });
  assert.deepEqual(retry, [{ jobId: enqueued.jobId, state: "retry" }]);
  const stored = await dbClient.execute({
    sql: "SELECT state,attempt_count,last_error,next_attempt_at FROM tokenless_assurance_attestation_jobs WHERE job_id=?",
    args: [enqueued.jobId],
  });
  assert.equal(stored.rows[0].state, "retry");
  assert.equal(Number(stored.rows[0].attempt_count), 1);
  assert.match(String(stored.rows[0].last_error), /Rekor unavailable/u);
  await assert.rejects(
    () =>
      processAssuranceAttestationJobs({
        ...dependencies,
        signer: { ...dependencies.signer, custody: "local" } as never,
        now: new Date(NOW.getTime() + 31_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "managed_attestation_signer_required",
  );
});

test("a reclaimed attestation lease fences the stale signer before external publication and state writes", async () => {
  const { workspaceId } = await createWorkspace({ name: "Fenced attestation reclaim", ownerAddress: OWNER });
  const enqueued = await enqueueAssuranceAttestation({
    workspaceId,
    kind: "audit_export_head",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop-audit-v1",
    boundaryAt: NOW,
    now: NOW,
  });
  const stale = processor({
    keyId: "kms:rateloop:evidence:old",
    rekorEntryUuid: "rekor-old",
    rekorLogIndex: "40",
    timestampByte: 4,
  });
  const signerStarted = deferred();
  const releaseSigner = deferred();
  const staleSign = stale.signer.sign;
  stale.signer.sign = async payload => {
    signerStarted.resolve();
    await releaseSigner.promise;
    return staleSign(payload);
  };
  const staleWorker = processAssuranceAttestationJobs({ ...stale, now: NOW, workspaceId });
  await signerStarted.promise;

  const current = processor({
    keyId: "kms:rateloop:evidence:current",
    rekorEntryUuid: "rekor-current",
    rekorLogIndex: "41",
    timestampByte: 5,
  });
  const reclaimed = await processAssuranceAttestationJobs({
    ...current,
    now: new Date(NOW.getTime() + 61_000),
    workspaceId,
  });
  assert.deepEqual(reclaimed, [{ jobId: enqueued.jobId, state: "completed" }]);

  releaseSigner.resolve();
  assert.deepEqual(await staleWorker, []);
  assert.deepEqual(stale.calls, { rekor: 0, tsa: 0 });
  assert.deepEqual(current.calls, { rekor: 1, tsa: 1 });
  const stored = await dbClient.execute({
    sql: `SELECT state,attempt_count,lease_generation,claim_signer_key_id,signer_key_id,
                 rekor_entry_uuid,rekor_log_index,tsa_token_base64,last_error
          FROM tokenless_assurance_attestation_jobs WHERE job_id=?`,
    args: [enqueued.jobId],
  });
  assert.deepEqual(
    [
      stored.rows[0]?.state,
      stored.rows[0]?.attempt_count,
      stored.rows[0]?.lease_generation,
      stored.rows[0]?.claim_signer_key_id,
      stored.rows[0]?.signer_key_id,
      stored.rows[0]?.rekor_entry_uuid,
      stored.rows[0]?.rekor_log_index,
      stored.rows[0]?.last_error,
    ],
    ["completed", 2, 2, null, "kms:rateloop:evidence:current", "rekor-current", "41", null],
  );
  assert.equal(stored.rows[0]?.tsa_token_base64, Buffer.alloc(64, 5).toString("base64"));
});
