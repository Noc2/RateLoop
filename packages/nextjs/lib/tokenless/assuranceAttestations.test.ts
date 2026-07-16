import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  DSSE_PAYLOAD_TYPE,
  canonicalAttestationJson,
  createAssuranceAttestationStatement,
  createAssuranceDsseEnvelope,
  verifyAssuranceDsseEnvelope,
} from "~~/lib/tokenless/assuranceAttestations";

const ARTIFACT_DIGEST = `sha256:${"12".repeat(32)}`;

test("creates a deterministic digest-only in-toto statement without tenant metadata", () => {
  const statement = createAssuranceAttestationStatement({
    kind: "decision_packet",
    artifactDigest: ARTIFACT_DIGEST,
    artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
    boundaryAt: new Date("2026-07-16T12:00:00.000Z"),
  });
  assert.equal(statement.subject[0].digest.sha256, "12".repeat(32));
  assert.equal(statement.predicate.disclosure, "digest_only_no_tenant_metadata");
  assert.equal(statement.predicate.boundary.kind, "artifact_generated");
  const serialized = canonicalAttestationJson(statement);
  assert.doesNotMatch(serialized, /workspaceId|tenantCommitment|reviewerId|rationaleDigest/iu);
});

test("wraps and verifies an Ed25519 DSSE envelope", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const statement = createAssuranceAttestationStatement({
    kind: "coverage_export_head",
    artifactDigest: ARTIFACT_DIGEST,
    artifactSchemaVersion: "rateloop.assurance-coverage-export.v1",
    boundaryAt: new Date("2026-07-16T12:00:00.000Z"),
  });
  const envelope = await createAssuranceDsseEnvelope({
    statement,
    signer: { keyId: "test:ed25519:1", sign: async payload => sign(null, payload, privateKey) },
  });
  assert.equal(envelope.payloadType, DSSE_PAYLOAD_TYPE);
  const verified = verifyAssuranceDsseEnvelope({
    envelope,
    publicKeyDer: publicKey.export({ format: "der", type: "spki" }),
    expectedKeyId: "test:ed25519:1",
    expectedArtifactDigest: ARTIFACT_DIGEST,
    expectedArtifactKind: "coverage_export_head",
    expectedArtifactSchemaVersion: "rateloop.assurance-coverage-export.v1",
  });
  assert.equal(verified.valid, true);
  assert.equal(
    verifyAssuranceDsseEnvelope({
      envelope,
      publicKeyDer: publicKey.export({ format: "der", type: "spki" }),
      expectedKeyId: "test:ed25519:1",
      expectedArtifactDigest: ARTIFACT_DIGEST,
      expectedArtifactKind: "audit_export_head",
      expectedArtifactSchemaVersion: "rateloop-audit-v1",
    }).valid,
    false,
  );

  const tampered = { ...envelope, payload: Buffer.from("{}").toString("base64") };
  assert.equal(
    verifyAssuranceDsseEnvelope({
      envelope: tampered,
      publicKeyDer: publicKey.export({ format: "der", type: "spki" }),
      expectedKeyId: "test:ed25519:1",
      expectedArtifactDigest: ARTIFACT_DIGEST,
      expectedArtifactKind: "coverage_export_head",
      expectedArtifactSchemaVersion: "rateloop.assurance-coverage-export.v1",
    }).valid,
    false,
  );
});

test("rejects malformed subject digests before signing", () => {
  assert.throws(
    () =>
      createAssuranceAttestationStatement({
        kind: "audit_export_head",
        artifactDigest: "sha256:1234",
        artifactSchemaVersion: "rateloop-audit-v1",
        boundaryAt: new Date(),
      }),
    /canonical SHA-256/,
  );
});
