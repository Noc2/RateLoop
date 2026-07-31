import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  DSSE_PAYLOAD_TYPE,
  type DsseEnvelope,
  canonicalAttestationJson,
  canonicalizeLegacyAttestationJson,
  createAssuranceAttestationStatement,
  createAssuranceDsseEnvelope,
  dssePreAuthenticationEncoding,
  verifyAssuranceDsseEnvelope,
} from "~~/lib/tokenless/assuranceAttestations";
import { canonicalizeAttestationWitness } from "~~/scripts/assurance-attestation-witness-core.mjs";

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
  assert.equal(serialized, canonicalizeRfc8785(statement));
  assert.equal(serialized, canonicalizeAttestationWitness(statement));
  assert.doesNotMatch(serialized, /workspaceId|tenantCommitment|reviewerId|rationaleDigest/iu);
});

test("verifies immutable v1 attestations that used the historical serializer", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const statement = {
    ...createAssuranceAttestationStatement({
      kind: "decision_packet",
      artifactDigest: ARTIFACT_DIGEST,
      artifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
      boundaryAt: new Date("2026-07-16T12:00:00.000Z"),
    }),
    legacyExtension: { A: 1, a: 2, "€": 3, "💩": 4 },
  };
  const payload = Buffer.from(canonicalizeLegacyAttestationJson(statement));
  assert.notEqual(payload.toString("utf8"), canonicalAttestationJson(statement));
  const envelope: DsseEnvelope = {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [
      {
        keyid: "test:legacy:1",
        sig: sign(null, dssePreAuthenticationEncoding(DSSE_PAYLOAD_TYPE, payload), privateKey).toString("base64"),
      },
    ],
  };
  assert.equal(
    verifyAssuranceDsseEnvelope({
      envelope,
      publicKeyDer: publicKey.export({ format: "der", type: "spki" }),
      expectedKeyId: "test:legacy:1",
      expectedArtifactDigest: ARTIFACT_DIGEST,
      expectedArtifactKind: "decision_packet",
      expectedArtifactSchemaVersion: "rateloop.human-assurance.evidence.v3",
    }).valid,
    true,
  );
});

test("rejects signed attestation JSON that is neither JCS nor the historical canonical form", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const statement = createAssuranceAttestationStatement({
    kind: "decision_packet",
    artifactDigest: ARTIFACT_DIGEST,
    artifactSchemaVersion: "rateloop.human-assurance.evidence.v4",
    boundaryAt: new Date("2026-07-16T12:00:00.000Z"),
  });
  const payload = Buffer.from(JSON.stringify(statement, null, 2));
  const envelope: DsseEnvelope = {
    payloadType: DSSE_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [
      {
        keyid: "test:noncanonical:1",
        sig: sign(null, dssePreAuthenticationEncoding(DSSE_PAYLOAD_TYPE, payload), privateKey).toString("base64"),
      },
    ],
  };
  assert.equal(
    verifyAssuranceDsseEnvelope({
      envelope,
      publicKeyDer: publicKey.export({ format: "der", type: "spki" }),
      expectedKeyId: "test:noncanonical:1",
      expectedArtifactDigest: ARTIFACT_DIGEST,
      expectedArtifactKind: "decision_packet",
      expectedArtifactSchemaVersion: "rateloop.human-assurance.evidence.v4",
    }).valid,
    false,
  );
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
