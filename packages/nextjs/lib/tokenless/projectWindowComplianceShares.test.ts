import {
  canonicalizeLegacyEvidenceValue,
  computeEvidenceAggregation,
  evidenceSigningKeyId,
  sha256LegacyEvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";
import { canonicalizeRfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  type ProjectWindowComplianceArtifact,
  type ProjectWindowPacketArtifact,
  type ProjectWindowReportArtifact,
  __projectWindowComplianceSharesTestUtils,
  buildProjectWindowComplianceManifest,
  evaluateProjectWindowComplianceAccessPolicy,
  verifyBoundProjectWindowEvidencePacket,
} from "~~/lib/tokenless/projectWindowComplianceShares";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const START = "2026-01-01T00:00:00.000Z";
const END = "2026-07-01T00:00:00.000Z";
const artifacts: readonly ProjectWindowComplianceArtifact[] = [
  {
    artifactKind: "part8_report_version",
    reportId: "dsa8r_report_2026_h1",
    reportVersion: 2,
    reportDigest: digest("2"),
    reportingPeriodStart: START,
    reportingPeriodEnd: END,
  },
  {
    artifactKind: "evidence_packet",
    packetId: "packet_compliance_2026_01",
    runId: "run_compliance_2026_01",
    packetDigest: digest("1"),
    generatedAt: "2026-03-01T12:00:00.000Z",
  },
];

function manifest(source: readonly ProjectWindowComplianceArtifact[] = artifacts) {
  return buildProjectWindowComplianceManifest({
    workspaceId: "workspace_compliance",
    projectId: "project_compliance",
    evidenceWindowStart: START,
    evidenceWindowEnd: END,
    artifacts: source,
  });
}

test("project-window manifest is deterministic, typed, and bound to packet and report versions", () => {
  const first = manifest();
  const reversed = manifest([...artifacts].reverse());
  assert.deepEqual(first, reversed);
  assert.equal(first.packetCount, 1);
  assert.equal(first.reportCount, 1);
  assert.deepEqual(
    first.entries.map(entry => [entry.manifestPosition, entry.artifactKey]),
    [
      [1, "packet:packet_compliance_2026_01"],
      [2, "report:dsa8r_report_2026_h1:2"],
    ],
  );
  assert.match(first.manifestRoot, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(canonicalizeRfc8785(JSON.parse(first.manifestJson) as unknown), first.manifestJson);
});

test("artifacts outside the half-open evidence window and duplicates fail closed", () => {
  assert.throws(
    () => manifest([{ ...(artifacts[1] as ProjectWindowPacketArtifact), generatedAt: END }]),
    /wholly bound by the evidence window/u,
  );
  assert.throws(
    () =>
      manifest([
        { ...(artifacts[0] as ProjectWindowReportArtifact), reportingPeriodStart: "2025-12-31T23:59:59.000Z" },
      ]),
    /wholly bound by the evidence window/u,
  );
  assert.throws(() => manifest([artifacts[1]!, artifacts[1]!]), /may be bound only once/u);
});

test("access policy independently rejects tenant, expiry, revocation, window, and unbound artifacts", () => {
  const built = manifest();
  const base = {
    now: "2026-07-02T00:00:00.000Z",
    expiresAt: "2026-07-03T00:00:00.000Z",
    revoked: false,
    tenantBound: true,
    manifestVerified: true,
    evidenceWindowStart: START,
    evidenceWindowEnd: END,
    entries: built.entries,
    requestedArtifactKey: "packet:packet_compliance_2026_01",
    requestedArtifactKind: "evidence_packet" as const,
  };
  assert.equal(evaluateProjectWindowComplianceAccessPolicy(base).allowed, true);
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, tenantBound: false }), {
    allowed: false,
    reason: "tenant_mismatch",
  });
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, revoked: true }), {
    allowed: false,
    reason: "revoked",
  });
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, now: base.expiresAt }), {
    allowed: false,
    reason: "expired",
  });
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, manifestVerified: false }), {
    allowed: false,
    reason: "artifact_invalid",
  });
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, requestedArtifactKey: "packet:not_bound" }), {
    allowed: false,
    reason: "unbound_artifact",
  });
  const escapedEntry = { ...built.entries[0]!, artifactWindowStart: END, artifactWindowEnd: END };
  assert.deepEqual(evaluateProjectWindowComplianceAccessPolicy({ ...base, entries: [escapedEntry] }), {
    allowed: false,
    reason: "window_mismatch",
  });
});

test("same caller idempotency key cannot collide across shares or bearer secrets", () => {
  const identity = __projectWindowComplianceSharesTestUtils.accessIdentity;
  const key = "compliance-access-0001";
  const one = identity({ shareId: `pwcs_${"A".repeat(22)}`, bearerSecret: "a".repeat(43), idempotencyKey: key });
  const otherShare = identity({
    shareId: `pwcs_${"B".repeat(22)}`,
    bearerSecret: "a".repeat(43),
    idempotencyKey: key,
  });
  const otherSecret = identity({
    shareId: `pwcs_${"A".repeat(22)}`,
    bearerSecret: "b".repeat(43),
    idempotencyKey: key,
  });
  assert.notEqual(one.accessId, otherShare.accessId);
  assert.notEqual(one.accessId, otherSecret.accessId);
  assert.equal(JSON.stringify([one, otherShare, otherSecret]).includes("a".repeat(43)), false);
  assert.match(one.accessId, /^pwca_[A-Za-z0-9_-]{22}$/u);
});

test("packet access verifies the pinned signing identity, digest, source IDs, and signature", async () => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = createPublicKey(keys.privateKey).export({ format: "der", type: "spki" }).toString("base64url");
  const keyId = await evidenceSigningKeyId(publicKey);
  const recomputation = { reviewerSources: [], cases: [], caseLeaves: [], responseLeaves: [] };
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 5000,
    minimumValidResponses: 1,
  };
  const payload = {
    schemaVersion: "rateloop.human-assurance.evidence.v2",
    packetId: "packet_compliance_2026_01",
    runId: "run_compliance_2026_01",
    roots: {
      caseRoot: await sha256LegacyEvidenceValue([]),
      responseRoot: await sha256LegacyEvidenceValue([]),
    },
    recomputation,
    aggregation: computeEvidenceAggregation(recomputation, 1, passRule),
  };
  const signingMetadata = { algorithm: "Ed25519", keyId, publicKey } as const;
  const document = { payload, signing: signingMetadata };
  const packet = {
    ...document,
    packetDigest: await sha256LegacyEvidenceValue(document),
    signature: sign(null, Buffer.from(canonicalizeLegacyEvidenceValue(document)), keys.privateKey).toString(
      "base64url",
    ),
  };
  const packetJson = JSON.stringify(packet);
  assert.deepEqual(
    await verifyBoundProjectWindowEvidencePacket({
      packetJson,
      packetId: payload.packetId,
      runId: payload.runId,
      packetDigest: packet.packetDigest,
      signingAlgorithm: signingMetadata.algorithm,
      signingKeyId: keyId,
      signingPublicKey: publicKey,
    }),
    packet,
  );
  const tamperedJson = JSON.stringify({ ...packet, payload: { ...packet.payload, runId: "run_tampered" } });
  await assert.rejects(
    () =>
      verifyBoundProjectWindowEvidencePacket({
        packetJson: tamperedJson,
        packetId: payload.packetId,
        runId: payload.runId,
        packetDigest: packet.packetDigest,
        signingAlgorithm: signingMetadata.algorithm,
        signingKeyId: keyId,
        signingPublicKey: publicKey,
      }),
    /Stored project-window compliance-share evidence is invalid/u,
  );
});

test("the share is capped at 30 days and does not become research or Article 40 access", () => {
  assert.equal(__projectWindowComplianceSharesTestUtils.maxShareLifetimeMs, 30 * 24 * 60 * 60 * 1_000);
  const serialized = canonicalizeRfc8785(manifest()).toLowerCase();
  assert.doesNotMatch(serialized, /benchmark.research|article.?40|vetted.research/u);
});
