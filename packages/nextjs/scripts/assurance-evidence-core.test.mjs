import {
  LEGACY_EVIDENCE_SCHEMA_VERSIONS,
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceMerkleRoot,
  evidenceSigningKeyId,
  sha256EvidenceValue,
  verifyEvidenceExport,
} from "./assurance-evidence-core.mjs";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function emptyEvidencePayload() {
  const recomputation = {
    reviewerSources: [],
    cases: [],
    caseLeaves: [],
    responseLeaves: [],
  };
  const passRule = { minimumValidResponses: 1, thresholdBps: 5_001 };
  return {
    schemaVersion: LEGACY_EVIDENCE_SCHEMA_VERSIONS[0],
    recomputation,
    roots: {
      caseRoot: await evidenceMerkleRoot(recomputation.caseLeaves),
      responseRoot: await evidenceMerkleRoot(recomputation.responseLeaves),
    },
    aggregation: computeEvidenceAggregation(recomputation, 1, passRule),
  };
}

async function signedPacket(input) {
  const publicKey = createPublicKey(input.privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const signing = {
    algorithm: input.algorithm,
    keyId: await evidenceSigningKeyId(publicKey, input.algorithm),
    publicKey,
  };
  const signedDocument = { payload: await emptyEvidencePayload(), signing };
  const signature = sign(
    input.algorithm === "ECDSA-SHA256" ? "sha256" : null,
    Buffer.from(canonicalizeEvidenceValue(signedDocument)),
    input.signatureOptions ? { key: input.privateKey, ...input.signatureOptions } : input.privateKey,
  ).toString("base64url");
  return {
    ...signedDocument,
    packetDigest: await sha256EvidenceValue(signedDocument),
    signature,
  };
}

test("shared assurance evidence verifier has no Node runtime dependencies", async () => {
  const source = await readFile(new URL("./assurance-evidence-core.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["']node:/u);
  assert.doesNotMatch(source, /\bBuffer\b/u);
  assert.equal(
    await sha256EvidenceValue({ b: 2, a: 1 }),
    "sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
  );
});

test("shared WebCrypto verifier accepts Ed25519 evidence", async () => {
  const keys = generateKeyPairSync("ed25519");
  const packet = await signedPacket({ algorithm: "Ed25519", privateKey: keys.privateKey });
  assert.deepEqual(
    await verifyEvidenceExport(packet, {
      expectedPublicKey: packet.signing.publicKey,
      expectedKeyId: packet.signing.keyId,
    }),
    { valid: true, errors: [], packetDigest: packet.packetDigest },
  );
});

test("shared WebCrypto verifier accepts historical DER and browser-native raw P-256 signatures", async () => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  for (const signatureOptions of [undefined, { dsaEncoding: "ieee-p1363" }]) {
    const packet = await signedPacket({
      algorithm: "ECDSA-SHA256",
      privateKey: keys.privateKey,
      signatureOptions,
    });
    assert.equal(
      (
        await verifyEvidenceExport(packet, {
          expectedPublicKey: packet.signing.publicKey,
          expectedKeyId: packet.signing.keyId,
        })
      ).valid,
      true,
    );
  }
});
