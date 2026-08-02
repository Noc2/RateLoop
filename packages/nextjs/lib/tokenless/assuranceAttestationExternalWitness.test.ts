import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  createPlatformSecretManagedAttestationSigner,
  createRekorDssePublisher,
  createRfc3161TimestampAuthority,
} from "~~/lib/tokenless/assuranceAttestationExternalWitness";
import {
  canonicalAttestationJson,
  canonicalizeLegacyAttestationJson,
  createAssuranceAttestationStatement,
  createAssuranceDsseEnvelope,
  dssePreAuthenticationEncoding,
} from "~~/lib/tokenless/assuranceAttestations";
import {
  REKOR_RECEIPT_SCHEMA_VERSION,
  __attestationWitnessCoreTestUtils,
  canonicalizeLegacyAttestationWitness,
  expectedLegacyRekorCanonicalBody,
  expectedRekorCanonicalBody,
  rfc3161BoundaryDigestHex,
  verifyAssuranceAttestationWitnessBundle,
} from "~~/scripts/assurance-attestation-witness-core.mjs";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const DIGEST = `sha256:${"12".repeat(32)}`;
const SIGNER_KEY_ID = "ed25519:platform-secret-test";

async function signedEnvelope() {
  const signerKeys = generateKeyPairSync("ed25519");
  const statement = createAssuranceAttestationStatement({
    kind: "decision_packet",
    artifactDigest: DIGEST,
    artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
    boundaryAt: NOW,
  });
  const envelope = await createAssuranceDsseEnvelope({
    statement,
    signer: { keyId: SIGNER_KEY_ID, sign: async payload => sign(null, payload, signerKeys.privateKey) },
  });
  return { signerKeys, statement, envelope };
}

function signedCheckpoint(input: {
  rootHash: string;
  treeSize: number;
  rekorKeys: ReturnType<typeof generateKeyPairSync>;
  origin?: string;
}) {
  const origin = input.origin ?? "rekor.example.test - test-log";
  const signerName = origin.split(" - ")[0];
  const message = `${origin}\n ${input.treeSize}\n ${Buffer.from(input.rootHash, "hex").toString("base64")}\n Timestamp: ${NOW.getTime()}\n`;
  const publicKeyDer = input.rekorKeys.publicKey.export({ format: "der", type: "spki" });
  const keyHint = createHash("sha256").update(publicKeyDer).digest().subarray(0, 4);
  const signature = sign("sha256", Buffer.from(message), input.rekorKeys.privateKey);
  return `${message}\n— ${signerName} ${Buffer.concat([keyHint, signature]).toString("base64")}\n`;
}

function rekorResponse(input: {
  envelope: Awaited<ReturnType<typeof signedEnvelope>>["envelope"];
  signerPublicKey: ReturnType<typeof generateKeyPairSync>["publicKey"];
  rekorKeys: ReturnType<typeof generateKeyPairSync>;
}) {
  const canonicalBody = expectedRekorCanonicalBody({
    envelope: input.envelope,
    signerPublicKey: input.signerPublicKey,
  });
  const body = Buffer.from(canonicalAttestationJson(canonicalBody));
  const rekorPublicKeyDer = input.rekorKeys.publicKey.export({ format: "der", type: "spki" });
  const logEntry = {
    body: body.toString("base64"),
    integratedTime: Math.floor(NOW.getTime() / 1000),
    logID: createHash("sha256").update(rekorPublicKeyDer).digest("hex"),
    logIndex: 0,
  };
  const signedEntryTimestamp = sign(
    "sha256",
    Buffer.from(canonicalAttestationJson(logEntry)),
    input.rekorKeys.privateKey,
  ).toString("base64");
  const rootHash = createHash("sha256")
    .update(Buffer.concat([Buffer.from([0]), body]))
    .digest("hex");
  const checkpoint = signedCheckpoint({ rootHash, treeSize: 1, rekorKeys: input.rekorKeys });
  return {
    entryUuid: "a".repeat(64),
    logEntry: {
      ...logEntry,
      verification: {
        signedEntryTimestamp,
        inclusionProof: { logIndex: 0, treeSize: 1, rootHash, hashes: [], checkpoint },
      },
    },
  };
}

test("platform-secret managed signer pins the Ed25519 key fingerprint and signs bounded payloads", async () => {
  const keys = generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
  const publicKeyDer = keys.publicKey.export({ format: "der", type: "spki" });
  const keyId = `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`;
  const signer = createPlatformSecretManagedAttestationSigner({ expectedKeyId: keyId, privateKey });
  const signature = await signer.sign(Buffer.from("managed signing test"));
  assert.equal(signer.keyId, keyId);
  assert.equal(signature.byteLength, 64);
  assert.equal(signer.publicKeyDer.toString("base64url"), publicKeyDer.toString("base64url"));
  assert.throws(
    () => createPlatformSecretManagedAttestationSigner({ expectedKeyId: `ed25519:${"0".repeat(24)}`, privateKey }),
    /fingerprint/u,
  );
  await assert.rejects(() => signer.sign(Buffer.alloc(4097)), /payload/u);
});

test("Rekor publisher submits DSSE proposedContent and locally verifies SET, checkpoint, and inclusion proof", async () => {
  const signed = await signedEnvelope();
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const response = rekorResponse({
    envelope: signed.envelope,
    signerPublicKey: signed.signerKeys.publicKey,
    rekorKeys,
  });
  const proposals: Array<Record<string, unknown>> = [];
  const publisher = createRekorDssePublisher({
    logOrigin: "https://rekor.example.test",
    signerPublicKeyDer: signed.signerKeys.publicKey.export({ format: "der", type: "spki" }),
    trustedRekorPublicKeyPem: rekorKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
    fetch: async (_url, init) => {
      proposals.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ [response.entryUuid]: response.logEntry });
    },
  });
  const receipt = await publisher.publish({ envelope: signed.envelope, statement: signed.statement });
  assert.equal(proposals[0]?.kind, "dsse");
  assert.equal(proposals[0]?.apiVersion, "0.0.1");
  assert.equal(receipt.entryUuid, response.entryUuid);
  assert.equal(receipt.logIndex, "0");
  assert.equal(receipt.inclusionBundle.schemaVersion, REKOR_RECEIPT_SCHEMA_VERSION);
});

test("Rekor checkpoint verification follows signed-note framing and rejects unauthenticated roots", async () => {
  const signed = await signedEnvelope();
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const response = rekorResponse({
    envelope: signed.envelope,
    signerPublicKey: signed.signerKeys.publicKey,
    rekorKeys,
  });
  const proof = response.logEntry.verification.inclusionProof;
  assert.equal(__attestationWitnessCoreTestUtils.verifyCheckpoint(proof, rekorKeys.publicKey), true);

  assert.equal(
    __attestationWitnessCoreTestUtils.verifyCheckpoint({ ...proof, checkpoint: undefined }, rekorKeys.publicKey),
    false,
  );
  const tamperedSignature = proof.checkpoint.replace(
    /^(— [^ ]+ )([A-Za-z0-9+/])/mu,
    (_line, prefix: string, first: string) => `${prefix}${first === "A" ? "B" : "A"}`,
  );
  assert.equal(
    __attestationWitnessCoreTestUtils.verifyCheckpoint(
      { ...proof, checkpoint: tamperedSignature },
      rekorKeys.publicKey,
    ),
    false,
  );
  assert.equal(
    __attestationWitnessCoreTestUtils.verifyCheckpoint(
      { ...proof, rootHash: Buffer.alloc(32, 1).toString("hex") },
      rekorKeys.publicKey,
    ),
    false,
  );

  const untrustedKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const untrustedCheckpoint = signedCheckpoint({
    rootHash: proof.rootHash,
    treeSize: proof.treeSize,
    rekorKeys: untrustedKeys,
  });
  assert.equal(
    __attestationWitnessCoreTestUtils.verifyCheckpoint(
      { ...proof, checkpoint: untrustedCheckpoint },
      rekorKeys.publicKey,
    ),
    false,
  );
});

test("RFC 3161 adapter sends a DER timestamp query and accepts only a locally verified response", async () => {
  let verifiedDigest = "";
  let request = Buffer.alloc(0);
  const token = Buffer.concat([Buffer.from([0x30, 0x20]), Buffer.alloc(32, 7)]);
  const tsa = createRfc3161TimestampAuthority({
    authorityUrl: "https://tsa.example.test/rfc3161",
    trustedCaPem: "test-only-ca",
    fetch: async (_url, init) => {
      request = Buffer.from(init?.body as Uint8Array);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/timestamp-query");
      return new Response(token, { headers: { "content-type": "application/timestamp-reply" } });
    },
    verifyResponse: async input => {
      assert.deepEqual(input.token, token);
      verifiedDigest = input.digestHex;
    },
  });
  const receipt = await tsa.timestamp({ artifactDigest: DIGEST, boundaryAt: NOW.toISOString() });
  assert.equal(request[0], 0x30);
  assert.equal(verifiedDigest, rfc3161BoundaryDigestHex({ artifactDigest: DIGEST, boundaryAt: NOW.toISOString() }));
  assert.deepEqual(receipt.token, token);
});

test("offline witness verifier binds DSSE, Rekor, and explicit signer/log trust anchors", async () => {
  const signed = await signedEnvelope();
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const response = rekorResponse({
    envelope: signed.envelope,
    signerPublicKey: signed.signerKeys.publicKey,
    rekorKeys,
  });
  const bundle = {
    schemaVersion: "rateloop.assurance-external-witness.v1",
    jobId: `aat_${"1".repeat(40)}`,
    artifact: {
      kind: "decision_packet",
      schemaVersion: "rateloop.human-assurance.evidence.v3",
      digest: DIGEST,
      boundaryAt: NOW.toISOString(),
    },
    statement: signed.statement,
    dsse: { signerKeyId: SIGNER_KEY_ID, envelope: signed.envelope },
    rekor: {
      entryUuid: response.entryUuid,
      logIndex: "0",
      bundle: {
        schemaVersion: REKOR_RECEIPT_SCHEMA_VERSION,
        logOrigin: "https://rekor.example.test",
        entryUuid: response.entryUuid,
        logEntry: response.logEntry,
      },
    },
    rfc3161: null,
    completedAt: NOW.toISOString(),
  };
  const valid = verifyAssuranceAttestationWitnessBundle(bundle, {
    signerPublicKey: signed.signerKeys.publicKey.export({ format: "pem", type: "spki" }),
    rekorPublicKey: rekorKeys.publicKey.export({ format: "pem", type: "spki" }),
    expectedSignerKeyId: SIGNER_KEY_ID,
  });
  assert.deepEqual(valid, { valid: true, errors: [] });
  const missingCheckpoint = structuredClone(bundle);
  Reflect.deleteProperty(missingCheckpoint.rekor.bundle.logEntry.verification.inclusionProof, "checkpoint");
  assert.ok(
    verifyAssuranceAttestationWitnessBundle(missingCheckpoint, {
      signerPublicKey: signed.signerKeys.publicKey.export({ format: "pem", type: "spki" }),
      rekorPublicKey: rekorKeys.publicKey.export({ format: "pem", type: "spki" }),
    }).errors.includes("invalid_rekor_checkpoint"),
  );
  const tampered = structuredClone(bundle);
  tampered.artifact.digest = `sha256:${"ff".repeat(32)}`;
  assert.equal(
    verifyAssuranceAttestationWitnessBundle(tampered, {
      signerPublicKey: signed.signerKeys.publicKey.export({ format: "pem", type: "spki" }),
      rekorPublicKey: rekorKeys.publicKey.export({ format: "pem", type: "spki" }),
    }).valid,
    false,
  );
});

test("offline witness verifier preserves historical v1 statement and Rekor SET bytes", () => {
  const signerKeys = generateKeyPairSync("ed25519");
  const rekorKeys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const statement = {
    ...createAssuranceAttestationStatement({
      kind: "decision_packet",
      artifactDigest: DIGEST,
      artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
      boundaryAt: NOW,
    }),
    legacyExtension: { A: 1, a: 2, "€": 3, "💩": 4 },
  };
  const payload = Buffer.from(canonicalizeLegacyAttestationJson(statement));
  const envelope = {
    payloadType: "application/vnd.in-toto+json" as const,
    payload: payload.toString("base64"),
    signatures: [
      {
        keyid: SIGNER_KEY_ID,
        sig: sign(
          null,
          dssePreAuthenticationEncoding("application/vnd.in-toto+json", payload),
          signerKeys.privateKey,
        ).toString("base64"),
      },
    ] as [{ keyid: string; sig: string }],
  };
  const body = Buffer.from(
    canonicalizeLegacyAttestationWitness(
      expectedLegacyRekorCanonicalBody({ envelope, signerPublicKey: signerKeys.publicKey }),
    ),
  );
  const rekorPublicKeyDer = rekorKeys.publicKey.export({ format: "der", type: "spki" });
  const logEntry = {
    body: body.toString("base64"),
    integratedTime: Math.floor(NOW.getTime() / 1000),
    logID: createHash("sha256").update(rekorPublicKeyDer).digest("hex"),
    logIndex: 0,
    legacyExtension: { A: 1, a: 2, "€": 3, "💩": 4 },
  };
  const signedEntryTimestamp = sign(
    "sha256",
    Buffer.from(
      canonicalizeLegacyAttestationWitness({
        body: logEntry.body,
        integratedTime: logEntry.integratedTime,
        logID: logEntry.logID,
        logIndex: logEntry.logIndex,
      }),
    ),
    rekorKeys.privateKey,
  ).toString("base64");
  const rootHash = createHash("sha256")
    .update(Buffer.concat([Buffer.from([0]), body]))
    .digest("hex");
  const checkpoint = signedCheckpoint({ rootHash, treeSize: 1, rekorKeys });
  const entryUuid = "b".repeat(64);
  const bundle = {
    schemaVersion: "rateloop.assurance-external-witness.v1",
    jobId: `aat_${"2".repeat(40)}`,
    artifact: {
      kind: "decision_packet",
      schemaVersion: "rateloop.human-assurance.evidence.v3",
      digest: DIGEST,
      boundaryAt: NOW.toISOString(),
    },
    statement,
    dsse: { signerKeyId: SIGNER_KEY_ID, envelope },
    rekor: {
      entryUuid,
      logIndex: "0",
      bundle: {
        schemaVersion: REKOR_RECEIPT_SCHEMA_VERSION,
        logOrigin: "https://rekor.example.test",
        entryUuid,
        logEntry: {
          ...logEntry,
          verification: {
            signedEntryTimestamp,
            inclusionProof: { logIndex: 0, treeSize: 1, rootHash, hashes: [], checkpoint },
          },
        },
      },
    },
    rfc3161: null,
    completedAt: NOW.toISOString(),
  };
  assert.deepEqual(
    verifyAssuranceAttestationWitnessBundle(bundle, {
      signerPublicKey: signerKeys.publicKey.export({ format: "pem", type: "spki" }),
      rekorPublicKey: rekorKeys.publicKey.export({ format: "pem", type: "spki" }),
      expectedSignerKeyId: SIGNER_KEY_ID,
    }),
    { valid: true, errors: [] },
  );
});
