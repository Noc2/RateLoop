import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { rootCertificates } from "node:tls";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { enqueueAssuranceAttestation } from "~~/lib/tokenless/assuranceAttestationPipeline";
import {
  __assuranceAttestationRuntimeTestUtils,
  __setAssuranceAttestationRuntimeForTests,
  processDueAssuranceAttestations,
} from "~~/lib/tokenless/assuranceAttestationRuntime";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { validateTokenlessProductionReadiness } from "~~/scripts/check-tokenless-production-readiness.mjs";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const DIGEST = `sha256:${"34".repeat(32)}`;
function managedAttestationConfiguration() {
  const signer = generateKeyPairSync("ed25519");
  const publicKeyDer = signer.publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
  const rekor = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: signer.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_ATTESTATION_SIGNING_KEY_ID: keyId,
    TOKENLESS_ATTESTATION_REKOR_URL: "https://rekor.example.test",
    TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM: rekor.publicKey.export({ format: "pem", type: "spki" }).toString(),
    TOKENLESS_ATTESTATION_VERIFICATION_KEYS: JSON.stringify([
      {
        algorithm: "Ed25519",
        keyId,
        publicKey: publicKeyDer.toString("base64url"),
        status: "current",
      },
    ]),
  };
}
const CORE_CONFIGURATION = managedAttestationConfiguration();

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setAssuranceAttestationRuntimeForTests(null);
});

afterEach(() => {
  __setAssuranceAttestationRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function queuedJob(
  input: {
    kind?: "decision_packet" | "audit_export_head" | "coverage_export_head";
    digest?: string;
  } = {},
) {
  const kind = input.kind ?? "decision_packet";
  const { workspaceId } = await createWorkspace({ name: "Scheduled attestation", ownerAddress: OWNER });
  return enqueueAssuranceAttestation({
    workspaceId,
    kind,
    artifactDigest: input.digest ?? DIGEST,
    artifactSchemaVersion:
      kind === "decision_packet" ? "rateloop.human-assurance.evidence.v3" : "rateloop.assurance-export.v1",
    boundaryAt: NOW,
    now: NOW,
  });
}

function managedWitnesses(input: { timestamping?: boolean } = {}) {
  const keys = generateKeyPairSync("ed25519");
  const calls = { rekor: 0, tsa: 0 };
  const runtime: NonNullable<Parameters<typeof __setAssuranceAttestationRuntimeForTests>[0]> = {
    signer: {
      custody: "managed",
      keyId: "kms:rateloop:scheduled:1",
      publicKeyDer: keys.publicKey.export({ format: "der", type: "spki" }),
      sign: async payload => sign(null, payload, keys.privateKey),
    },
    rekor: {
      publish: async () => {
        calls.rekor += 1;
        return { entryUuid: "scheduled-rekor-entry", logIndex: "9", inclusionBundle: { proof: true } };
      },
    },
  };
  if (input.timestamping !== false) {
    runtime.tsa = {
      timestamp: async () => {
        calls.tsa += 1;
        return { token: Buffer.alloc(64, 1) };
      },
    };
  }
  return { calls, runtime };
}

test("scheduled attestation processing stays pending and reports unavailable when managed adapters are absent", async () => {
  const enqueued = await queuedJob();
  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: false,
    due: 1,
    completed: 0,
    retry: 0,
    dead: 0,
    unavailable: 1,
  });
  const stored = await dbClient.execute({
    sql: "SELECT state,attempt_count,last_error FROM tokenless_assurance_attestation_jobs WHERE job_id=?",
    args: [enqueued.jobId],
  });
  assert.deepEqual(stored.rows[0], { attempt_count: 0, last_error: null, state: "pending" });
});

test("core managed witnesses process decision packets without TSA configuration", async () => {
  await queuedJob();
  const witnesses = managedWitnesses({ timestamping: false });
  __setAssuranceAttestationRuntimeForTests(witnesses.runtime);
  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: true,
    due: 1,
    completed: 1,
    retry: 0,
    dead: 0,
    unavailable: 0,
  });
  assert.deepEqual(witnesses.calls, { rekor: 1, tsa: 0 });
});

test("core managed witnesses stay configured after decision work drains without TSA", async () => {
  await queuedJob();
  const witnesses = managedWitnesses({ timestamping: false });
  __setAssuranceAttestationRuntimeForTests(witnesses.runtime);

  assert.equal((await processDueAssuranceAttestations({ now: NOW, env: {} })).completed, 1);
  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: true,
    due: 0,
    completed: 0,
    retry: 0,
    dead: 0,
    unavailable: 0,
  });
  assert.deepEqual(witnesses.calls, { rekor: 1, tsa: 0 });
});

test("missing TSA processes decision packets but leaves export heads pending and degraded", async () => {
  const decision = await queuedJob();
  const auditExport = await queuedJob({ kind: "audit_export_head", digest: `sha256:${"56".repeat(32)}` });
  const witnesses = managedWitnesses({ timestamping: false });
  __setAssuranceAttestationRuntimeForTests(witnesses.runtime);

  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: false,
    due: 2,
    completed: 1,
    retry: 0,
    dead: 0,
    unavailable: 1,
  });
  assert.deepEqual(witnesses.calls, { rekor: 1, tsa: 0 });
  const stored = await dbClient.execute({
    sql: `SELECT job_id,state,attempt_count,last_error FROM tokenless_assurance_attestation_jobs
          WHERE job_id IN (?,?) ORDER BY job_id`,
    args: [decision.jobId, auditExport.jobId],
  });
  const byJob = new Map(stored.rows.map(row => [String(row.job_id), row]));
  assert.deepEqual(byJob.get(decision.jobId), {
    attempt_count: 1,
    job_id: decision.jobId,
    last_error: null,
    state: "completed",
  });
  assert.deepEqual(byJob.get(auditExport.jobId), {
    attempt_count: 0,
    job_id: auditExport.jobId,
    last_error: null,
    state: "pending",
  });
});

test("full managed witness configuration preserves export timestamping", async () => {
  await queuedJob({ kind: "coverage_export_head" });
  const witnesses = managedWitnesses();
  __setAssuranceAttestationRuntimeForTests(witnesses.runtime);

  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: true,
    due: 1,
    completed: 1,
    retry: 0,
    dead: 0,
    unavailable: 0,
  });
  assert.deepEqual(witnesses.calls, { rekor: 1, tsa: 1 });
});

test("public-prefixed platform attestation secrets never count as configured", async () => {
  await queuedJob();
  assert.equal(
    (
      await processDueAssuranceAttestations({
        now: NOW,
        env: { NEXT_PUBLIC_TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: "do-not-use" },
      })
    ).unavailable,
    1,
  );
});

test("partial TSA configuration fails closed before claiming otherwise eligible work", async () => {
  const enqueued = await queuedJob();
  assert.deepEqual(
    await processDueAssuranceAttestations({
      now: NOW,
      env: {
        ...CORE_CONFIGURATION,
        TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
      },
    }),
    { configured: false, due: 1, completed: 0, retry: 0, dead: 0, unavailable: 1 },
  );
  const stored = await dbClient.execute({
    sql: "SELECT state,attempt_count,last_error FROM tokenless_assurance_attestation_jobs WHERE job_id=?",
    args: [enqueued.jobId],
  });
  assert.deepEqual(stored.rows[0], { attempt_count: 0, last_error: null, state: "pending" });
});

test("platform attestation runtime stays optional and rejects partial configuration", () => {
  assert.deepEqual(__assuranceAttestationRuntimeTestUtils.configurationState({}), {
    configured: false,
    timestampingConfigured: false,
    error: null,
  });
  assert.deepEqual(
    __assuranceAttestationRuntimeTestUtils.configurationState({
      TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: "partial",
    }),
    {
      configured: false,
      timestampingConfigured: false,
      error: "Managed attestation runtime configuration is incomplete.",
    },
  );
  assert.deepEqual(__assuranceAttestationRuntimeTestUtils.configurationState(CORE_CONFIGURATION), {
    configured: true,
    timestampingConfigured: false,
    error: null,
  });
  assert.deepEqual(
    __assuranceAttestationRuntimeTestUtils.configurationState({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
    }),
    {
      configured: false,
      timestampingConfigured: false,
      error: "Managed attestation runtime configuration is incomplete.",
    },
  );
  assert.deepEqual(
    __assuranceAttestationRuntimeTestUtils.configurationState({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
      TOKENLESS_ATTESTATION_TSA_CA_PEM: rootCertificates[0],
    }),
    { configured: true, timestampingConfigured: true, error: null },
  );
});

test("the hosted gate and runtime share the managed attestation configuration invariant", async () => {
  const hosted = {
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
  };
  const readiness = (env: Record<string, string>) =>
    validateTokenlessProductionReadiness({ env, activeRegistry: {} }).join("\n");

  assert.equal(__assuranceAttestationRuntimeTestUtils.configurationState(hosted).configured, false);
  assert.match(
    readiness(hosted),
    /Managed attestation signing, Rekor trust, and the published verification key are required/u,
  );

  const configured = { ...hosted, ...CORE_CONFIGURATION };
  assert.deepEqual(__assuranceAttestationRuntimeTestUtils.configurationState(configured), {
    configured: true,
    timestampingConfigured: false,
    error: null,
  });
  await assert.doesNotReject(__assuranceAttestationRuntimeTestUtils.buildRuntime(configured));
  assert.doesNotMatch(readiness(configured), /Managed attestation (?:signing|runtime)/u);

  const partialTsa = { ...configured, TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161" };
  assert.match(__assuranceAttestationRuntimeTestUtils.configurationState(partialTsa).error ?? "", /incomplete/u);
  assert.match(readiness(partialTsa), /Managed attestation runtime configuration is incomplete/u);
});

test("platform attestation runtime builds from a sealed Ed25519 secret and public trust anchors", async () => {
  const signerKeys = generateKeyPairSync("ed25519");
  const publicKeyDer = signerKeys.publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const coreEnvironment = {
    TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM: rekorKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    TOKENLESS_ATTESTATION_REKOR_URL: "https://rekor.example.test",
    TOKENLESS_ATTESTATION_SIGNING_KEY_ID: keyId,
    TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: signerKeys.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_ATTESTATION_VERIFICATION_KEYS: JSON.stringify([
      {
        algorithm: "Ed25519",
        status: "current",
        keyId,
        publicKey: publicKeyDer.toString("base64url"),
      },
    ]),
  };
  const coreRuntime = await __assuranceAttestationRuntimeTestUtils.buildRuntime(coreEnvironment);
  assert.equal(coreRuntime.tsa, undefined);
  const runtime = await __assuranceAttestationRuntimeTestUtils.buildRuntime({
    ...coreEnvironment,
    TOKENLESS_ATTESTATION_TSA_CA_PEM: rootCertificates[0],
    TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
  });
  assert.equal(runtime.signer.keyId, keyId);
  assert.equal((await runtime.signer.sign(Buffer.from("attestation"))).byteLength, 64);
  assert.ok(runtime.tsa);
});

test("managed attestation structural validation fails before work is claimed", async () => {
  const wrongKeyId = { ...CORE_CONFIGURATION, TOKENLESS_ATTESTATION_SIGNING_KEY_ID: `ed25519:${"0".repeat(24)}` };
  await assert.rejects(__assuranceAttestationRuntimeTestUtils.buildRuntime(wrongKeyId), /fingerprint/u);
  await assert.rejects(
    __assuranceAttestationRuntimeTestUtils.buildRuntime({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_VERIFICATION_KEYS: "[]",
    }),
    /verification keyring/u,
  );
  await assert.rejects(
    __assuranceAttestationRuntimeTestUtils.buildRuntime({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_REKOR_URL: "http://rekor.example.test",
    }),
    /Rekor URL/u,
  );
  await assert.rejects(
    __assuranceAttestationRuntimeTestUtils.buildRuntime({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM: "not-a-public-key",
    }),
    /Rekor public trust key/u,
  );
  await assert.rejects(
    __assuranceAttestationRuntimeTestUtils.buildRuntime({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
      TOKENLESS_ATTESTATION_TSA_CA_PEM: "not-a-certificate",
    }),
    /certificate bundle/u,
  );

  const empty = await processDueAssuranceAttestations({ env: wrongKeyId, now: NOW });
  assert.deepEqual(empty, { configured: false, due: 0, completed: 0, retry: 0, dead: 0, unavailable: 0 });

  const privateKey = createPrivateKey({
    key: Buffer.from(CORE_CONFIGURATION.TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  const escapedPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString().replaceAll("\n", "\\n");
  await assert.doesNotReject(
    __assuranceAttestationRuntimeTestUtils.buildRuntime({
      ...CORE_CONFIGURATION,
      TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: escapedPem,
    }),
  );
});
