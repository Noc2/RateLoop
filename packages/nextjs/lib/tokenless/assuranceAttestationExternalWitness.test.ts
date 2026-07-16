import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  createAwsKmsManagedAttestationSigner,
  createRekorDssePublisher,
  createRfc3161TimestampAuthority,
} from "~~/lib/tokenless/assuranceAttestationExternalWitness";
import {
  canonicalAttestationJson,
  createAssuranceAttestationStatement,
  createAssuranceDsseEnvelope,
} from "~~/lib/tokenless/assuranceAttestations";
import {
  REKOR_RECEIPT_SCHEMA_VERSION,
  expectedRekorCanonicalBody,
  rfc3161BoundaryDigestHex,
  verifyAssuranceAttestationWitnessBundle,
} from "~~/scripts/assurance-attestation-witness-core.mjs";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const DIGEST = `sha256:${"12".repeat(32)}`;
const KEY_ARN = "arn:aws:kms:eu-central-1:123456789012:key/11111111-2222-3333-4444-555555555555";

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
    signer: { keyId: KEY_ARN, sign: async payload => sign(null, payload, signerKeys.privateKey) },
  });
  return { signerKeys, statement, envelope };
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
  return {
    entryUuid: "a".repeat(64),
    logEntry: {
      ...logEntry,
      verification: {
        signedEntryTimestamp,
        inclusionProof: { logIndex: 0, treeSize: 1, rootHash, hashes: [], checkpoint: "signed-checkpoint" },
      },
    },
  };
}

test("AWS KMS managed signer pins the Ed25519 key policy and signs only RAW messages", async () => {
  const keys = generateKeyPairSync("ed25519");
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const signer = await createAwsKmsManagedAttestationSigner({
    keyArn: KEY_ARN,
    region: "eu-central-1",
    resolveCredential: async () => ({ accessKeyId: "AKIATEST", secretAccessKey: "s".repeat(32) }),
    now: () => NOW,
    fetch: async (_url, init) => {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ headers, body });
      if (headers.get("x-amz-target") === "TrentService.GetPublicKey") {
        return Response.json({
          KeyId: KEY_ARN,
          KeySpec: "ECC_NIST_EDWARDS25519",
          KeyUsage: "SIGN_VERIFY",
          SigningAlgorithms: ["ED25519_SHA_512"],
          PublicKey: keys.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
        });
      }
      const message = Buffer.from(String(body.Message), "base64");
      return Response.json({
        KeyId: KEY_ARN,
        SigningAlgorithm: "ED25519_SHA_512",
        Signature: sign(null, message, keys.privateKey).toString("base64"),
      });
    },
  });
  const signature = await signer.sign(Buffer.from("managed signing test"));
  const publicKeyDer = keys.publicKey.export({ format: "der", type: "spki" });
  assert.equal(signer.keyId, `ed25519:${createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24)}`);
  assert.equal(signature.byteLength, 64);
  assert.equal(requests[1]?.body.MessageType, "RAW");
  assert.equal(requests[1]?.body.SigningAlgorithm, "ED25519_SHA_512");
  assert.match(requests[0]?.headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 /u);
  assert.doesNotMatch(requests[0]?.headers.get("authorization") ?? "", /s{16}/u);
});

test("Rekor publisher submits DSSE proposedContent and locally verifies SET plus inclusion proof", async () => {
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
    dsse: { signerKeyId: KEY_ARN, envelope: signed.envelope },
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
    expectedSignerKeyId: KEY_ARN,
  });
  assert.deepEqual(valid, { valid: true, errors: [] });
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
