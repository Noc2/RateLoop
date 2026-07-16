import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  enqueueAssuranceAttestation,
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

function processor() {
  const keys = generateKeyPairSync("ed25519");
  const calls = { rekor: 0, tsa: 0 };
  return {
    calls,
    signer: {
      custody: "managed" as const,
      keyId: "kms:rateloop:evidence:1",
      publicKeyDer: keys.publicKey.export({ format: "der", type: "spki" }),
      sign: async (payload: Buffer) => sign(null, payload, keys.privateKey),
    },
    rekor: {
      publish: async () => {
        calls.rekor += 1;
        return { entryUuid: "rekor-entry-1", logIndex: "42", inclusionBundle: { verified: true } };
      },
    },
    tsa: {
      timestamp: async () => {
        calls.tsa += 1;
        return { token: Buffer.alloc(64, 7) };
      },
    },
  };
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
