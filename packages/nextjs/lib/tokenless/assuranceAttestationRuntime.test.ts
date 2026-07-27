import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { enqueueAssuranceAttestation } from "~~/lib/tokenless/assuranceAttestationPipeline";
import {
  __assuranceAttestationRuntimeTestUtils,
  __setAssuranceAttestationRuntimeForTests,
  processDueAssuranceAttestations,
} from "~~/lib/tokenless/assuranceAttestationRuntime";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const DIGEST = `sha256:${"34".repeat(32)}`;

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setAssuranceAttestationRuntimeForTests(null);
});

afterEach(() => {
  __setAssuranceAttestationRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function queuedJob() {
  const { workspaceId } = await createWorkspace({ name: "Scheduled attestation", ownerAddress: OWNER });
  return enqueueAssuranceAttestation({
    workspaceId,
    kind: "decision_packet",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
    boundaryAt: NOW,
    now: NOW,
  });
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

test("scheduled attestation processing executes dependency-injected managed witnesses", async () => {
  await queuedJob();
  const keys = generateKeyPairSync("ed25519");
  __setAssuranceAttestationRuntimeForTests({
    signer: {
      custody: "managed",
      keyId: "kms:rateloop:scheduled:1",
      publicKeyDer: keys.publicKey.export({ format: "der", type: "spki" }),
      sign: async payload => sign(null, payload, keys.privateKey),
    },
    rekor: {
      publish: async () => ({ entryUuid: "scheduled-rekor-entry", logIndex: "9", inclusionBundle: { proof: true } }),
    },
    tsa: { timestamp: async () => ({ token: Buffer.alloc(64, 1) }) },
  });
  assert.deepEqual(await processDueAssuranceAttestations({ now: NOW, env: {} }), {
    configured: true,
    due: 1,
    completed: 1,
    retry: 0,
    dead: 0,
    unavailable: 0,
  });
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

test("platform attestation runtime stays optional and rejects partial configuration", () => {
  assert.deepEqual(__assuranceAttestationRuntimeTestUtils.configurationState({}), {
    configured: false,
    error: null,
  });
  assert.deepEqual(
    __assuranceAttestationRuntimeTestUtils.configurationState({
      TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: "partial",
    }),
    {
      configured: false,
      error: "Managed attestation runtime configuration is incomplete.",
    },
  );
});

test("platform attestation runtime builds from a sealed Ed25519 secret and public trust anchors", async () => {
  const signerKeys = generateKeyPairSync("ed25519");
  const publicKeyDer = signerKeys.publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const runtime = await __assuranceAttestationRuntimeTestUtils.buildRuntime({
    TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM: rekorKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    TOKENLESS_ATTESTATION_REKOR_URL: "https://rekor.example.test",
    TOKENLESS_ATTESTATION_SIGNING_KEY_ID: keyId,
    TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY: signerKeys.privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url"),
    TOKENLESS_ATTESTATION_TSA_CA_PEM: "test-only-ca",
    TOKENLESS_ATTESTATION_TSA_URL: "https://tsa.example.test/rfc3161",
    TOKENLESS_EVIDENCE_VERIFICATION_KEYS: JSON.stringify([
      {
        algorithm: "Ed25519",
        status: "current",
        keyId,
        publicKey: publicKeyDer.toString("base64url"),
      },
    ]),
  });
  assert.equal(runtime.signer.keyId, keyId);
  assert.equal((await runtime.signer.sign(Buffer.from("attestation"))).byteLength, 64);
});

test("managed attestation signing requires the exact current public verification key", () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKeyDer = keys.publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
  const signer = {
    custody: "managed" as const,
    keyId,
    publicKeyDer,
    sign: async (payload: Buffer) => sign(null, payload, keys.privateKey),
  };
  const env = {
    TOKENLESS_EVIDENCE_VERIFICATION_KEYS: JSON.stringify([
      {
        algorithm: "Ed25519",
        status: "current",
        keyId,
        publicKey: publicKeyDer.toString("base64url"),
      },
    ]),
  };
  assert.doesNotThrow(() => __assuranceAttestationRuntimeTestUtils.requirePublishedSignerKey(signer, env));
  assert.throws(
    () =>
      __assuranceAttestationRuntimeTestUtils.requirePublishedSignerKey(signer, {
        TOKENLESS_EVIDENCE_VERIFICATION_KEYS: "[]",
      }),
    /published verification keyring/u,
  );
});
