import {
  canonicalizeLegacyEvidenceValue,
  computeEvidenceAggregation,
  evidenceSigningKeyId,
  sha256LegacyEvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";
import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  type ProjectWindowComplianceArtifact,
  type ProjectWindowPacketArtifact,
  type ProjectWindowReportArtifact,
  __projectWindowComplianceSharesTestUtils,
  buildProjectWindowComplianceManifest,
  evaluateProjectWindowComplianceAccessPolicy,
  issueProjectWindowComplianceShare,
  projectProjectWindowEvidencePacket,
  verifyBoundProjectWindowEvidencePacket,
} from "~~/lib/tokenless/projectWindowComplianceShares";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

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

test("share issuance replay returns no second bearer secret and mismatched requests roll back", async () => {
  const actor = `rlp_${"a".repeat(40)}`;
  const shareId = `pwcs_${"S".repeat(22)}`;
  const builtManifest = manifest();
  const issuedAt = "2026-07-01T00:00:00.000Z";
  const expiresAt = "2026-07-03T00:00:00.000Z";
  const grant = {
    schemaVersion: "rateloop.project-window-compliance-share.v1",
    workspaceId: "workspace_compliance",
    projectId: "project_compliance",
    shareId,
    evidenceWindow: { startInclusive: START, endExclusive: END },
    artifactManifestRoot: builtManifest.manifestRoot,
    expectedArtifactCount: builtManifest.entries.length,
    expectedPacketCount: builtManifest.packetCount,
    expectedReportCount: builtManifest.reportCount,
    accessBasis: "bounded_project_window_compliance_evidence",
    statutoryAccessStatus: "not_benchmark_research_or_article_40_access",
    issuedBy: actor,
    issuedAt,
    expiresAt,
  };
  const grantJson = canonicalizeRfc8785(grant);
  const grantHash = sha256Rfc8785(grant);
  const request = {
    accountAddress: actor,
    workspaceId: "workspace_compliance",
    projectId: "project_compliance",
    evidenceWindowStart: new Date(START),
    evidenceWindowEnd: new Date(END),
    evidencePacketIds: ["packet_compliance_2026_01"],
    reportVersions: [{ reportId: "dsa8r_report_2026_h1", reportVersion: 2 }],
    expiresAt: new Date(expiresAt),
    idempotencyKey: "share-issuance-replay-0001",
  };
  const binding = __projectWindowComplianceSharesTestUtils.deriveCapabilityIssuanceIdempotency({
    capabilityKind: "project_window_compliance_share",
    actorPrincipalId: actor,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    idempotencyKey: request.idempotencyKey,
    request: {
      evidenceWindowStart: START,
      evidenceWindowEnd: END,
      evidencePacketIds: request.evidencePacketIds,
      reportVersions: request.reportVersions,
      expiresAt,
    },
  });
  const row = {
    request_binding_hash: binding.requestBindingHash,
    workspace_id: request.workspaceId,
    project_id: request.projectId,
    share_id: shareId,
    evidence_window_start: START,
    evidence_window_end: END,
    artifact_manifest_json: builtManifest.manifestJson,
    artifact_manifest_root: builtManifest.manifestRoot,
    expected_artifact_count: builtManifest.entries.length,
    expected_packet_count: builtManifest.packetCount,
    expected_report_count: builtManifest.reportCount,
    grant_json: grantJson,
    grant_hash: grantHash,
    issued_by: actor,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const fakePool = (requestBindingHash: string) => {
    const queries: string[] = [];
    const client = {
      async query(text: string) {
        queries.push(text);
        if (
          text.startsWith("BEGIN") ||
          text === "COMMIT" ||
          text === "ROLLBACK" ||
          text.includes("set_config") ||
          text.includes("pg_advisory_xact_lock")
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes("FROM tokenless_workspace_members m")) return { rows: [{}], rowCount: 1 };
        if (text.includes("tokenless_project_window_compliance_share_issuances i")) {
          return { rows: [{ ...row, request_binding_hash: requestBindingHash }], rowCount: 1 };
        }
        throw new Error(`Unexpected query: ${text}`);
      },
      release() {},
    } as unknown as PoolClient;
    return {
      pool: {
        async connect() {
          return client;
        },
      } as unknown as Pick<Pool, "connect">,
      queries,
    };
  };
  const replayDatabase = fakePool(binding.requestBindingHash);
  const replay = await issueProjectWindowComplianceShare(request, { pool: replayDatabase.pool });
  assert.equal(replay.bearerSecret, null);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.recoveryRequired, true);
  assert.deepEqual(replay.grant, grant);
  assert.equal(
    replayDatabase.queries.some(query => query.startsWith("INSERT")),
    false,
  );
  assert.equal(replayDatabase.queries.includes("COMMIT"), true);

  const conflictDatabase = fakePool(digest("0"));
  await assert.rejects(
    issueProjectWindowComplianceShare(request, { pool: conflictDatabase.pool }),
    (error: TokenlessServiceError) =>
      error.status === 409 && error.code === "project_window_compliance_share_issuance_conflict",
  );
  assert.equal(conflictDatabase.queries.includes("ROLLBACK"), true);
  assert.equal(
    conflictDatabase.queries.some(query => query.startsWith("INSERT")),
    false,
  );
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

function complianceProjectionSource(validReviewerCount: number, canary = "PRIVATE_CANARY_DO_NOT_DISCLOSE") {
  const minimumAggregationSize = 2;
  const source = {
    source: `customer_invited_${canary}`,
    targetReviewerCount: validReviewerCount,
    assignedReviewerCount: validReviewerCount,
    paidReviewerCount: validReviewerCount,
    respondingReviewerCount: validReviewerCount,
    completeJudgmentSetReviewerCount: validReviewerCount,
  };
  const counts = {
    source: `customer_invited_${canary}`,
    targetReviewerCount: validReviewerCount,
    assignedReviewerCount: validReviewerCount,
    validReviewerCount,
    invalidJudgmentCount: 0,
    pendingJudgmentCount: 0,
    ...(validReviewerCount >= minimumAggregationSize ? { candidate: validReviewerCount, baseline: 0, tie: 0 } : {}),
  };
  const aggregation = computeEvidenceAggregation(
    {
      reviewerSources: [source],
      cases: [{ caseId: `case_${canary}`, overall: counts, sourceCounts: [counts] }],
      caseLeaves: [`case_leaf_${canary}`],
      responseLeaves: [`response_leaf_${canary}`],
    },
    minimumAggregationSize,
    {
      metric: "candidate_preference_share_bps",
      operator: "gte",
      thresholdBps: 5_000,
      minimumValidResponses: minimumAggregationSize,
    },
  );
  return {
    payload: {
      schemaVersion: "rateloop.human-assurance.evidence.v2",
      packetId: "packet_compliance_projection",
      runId: `run_${canary}`,
      tenantCommitment: `tenant_${canary}`,
      generatedAt: "2026-07-01T00:00:00.000Z",
      privacy: {
        classification: `classification_${canary}`,
        minimumAggregationSize,
        reviewerIdentitiesIncluded: false,
        rawRationaleIncluded: false,
        calibrationItemsIncludedInVerdict: false,
      },
      frozen: {
        runManifestHash: digest("a"),
        runManifest: { title: canary, instructions: canary, objective: canary },
        suiteManifestHash: digest("b"),
        suiteManifest: { artifact: canary },
        policyHash: digest("c"),
        policy: { privatePolicy: canary },
      },
      reviewContext: {
        selectionTrigger: { reasonCodes: [canary] },
        gate: { stopGateEvidenceReference: canary },
        versions: { requestProfile: canary },
        reviewerQualifications: { qualifications: [canary] },
        period: {
          startInclusive: START,
          endInclusive: END,
          durationMs: new Date(END).getTime() - new Date(START).getTime(),
          coverage: {
            caseCount: aggregation.judgmentCoverage.caseCount,
            targetExpectedJudgmentCount: aggregation.judgmentCoverage.targetExpectedJudgmentCount,
            submittedJudgmentCount: aggregation.judgmentCoverage.submittedJudgmentCount,
            respondingReviewerCount: aggregation.reviewerCoverage.respondingReviewerCount,
            targetReviewerCount: aggregation.reviewerCoverage.targetReviewerCount,
          },
          responseSubmissionLatencyFromPeriodStartMs: { median: canary },
        },
      },
      roots: { caseRoot: digest("d"), responseRoot: digest("e") },
      aggregation,
      calibration: { calibrationItem: canary },
      overrideDecisions: { overrideReason: canary },
      failureTagCounts: [{ tag: canary, count: validReviewerCount }],
      rationaleDigests: [{ rationaleDigest: digest("f"), canary }],
      settlement: { payoutDestination: canary },
      chainEvidence: { contentId: canary, roundId: canary },
      limitations: [
        { code: "small_source_cells_suppressed", message: canary },
        { code: `private_${canary}`, message: canary },
      ],
      recomputation: {
        reviewerPrincipalId: canary,
        contentId: canary,
        caseLeaves: [`case_leaf_${canary}`],
        responseLeaves: [`response_leaf_${canary}`],
      },
    },
    signing: { algorithm: "Ed25519", keyId: "evidence-key-v1", publicKey: canary },
    packetDigest: digest("9"),
    signature: canary,
  };
}

test("compliance evidence projection is a strict allowlist with independently bound provenance", () => {
  const canary = "PRIVATE_CANARY_DO_NOT_DISCLOSE";
  const source = complianceProjectionSource(2, canary);
  const projection = projectProjectWindowEvidencePacket(source);
  assert.deepEqual(projection, {
    schemaVersion: "rateloop.public-compliance-evidence-projection.v1",
    source: {
      schemaVersion: "rateloop.human-assurance.evidence.v2",
      packetId: "packet_compliance_projection",
      generatedAt: "2026-07-01T00:00:00.000Z",
      provenancePacketDigest: digest("9"),
    },
    sourceVerification: {
      status: "verified_before_projection",
      signingAlgorithm: "Ed25519",
      signingKeyId: "evidence-key-v1",
      signatureSemantics: "signature_over_undisclosed_source_packet",
    },
    privacy: {
      minimumAggregationSize: 2,
      reviewerIdentitiesIncluded: false,
      rawRationaleIncluded: false,
      calibrationItemsIncludedInVerdict: false,
    },
    period: {
      startInclusive: START,
      endInclusive: END,
      durationMs: new Date(END).getTime() - new Date(START).getTime(),
      coverage: {
        caseCount: 1,
        targetExpectedJudgmentCount: 2,
        submittedJudgmentCount: 2,
        respondingReviewerCount: 2,
        targetReviewerCount: 2,
      },
    },
    result: {
      suppressed: false,
      aggregationVersion: "rateloop.descriptive-case-quorum.v2",
      method: "descriptive_per_case",
      reviewerCoverage: {
        targetReviewerCount: 2,
        assignedReviewerCount: 2,
        respondingReviewerCount: 2,
        completeJudgmentSetReviewerCount: 2,
      },
      judgmentCoverage: {
        caseCount: 1,
        targetExpectedJudgmentCount: 2,
        assignedExpectedJudgmentCount: 2,
        submittedJudgmentCount: 2,
        validJudgmentCount: 2,
        invalidJudgmentCount: 0,
        pendingJudgmentCount: 0,
        missingTargetJudgmentCount: 0,
        missingAssignedJudgmentCount: 0,
      },
      suite: {
        method: "all_cases_must_pass",
        evaluatedCaseCount: 1,
        passCaseCount: 1,
        failCaseCount: 0,
        insufficientCaseCount: 0,
        outcome: "pass",
      },
    },
    limitations: ["small_source_cells_suppressed"],
    derivation: {
      kind: "audited_allowlisted_projection",
      authentication: "access_snapshot_response_hash_not_source_signature",
    },
  });
  const serialized = canonicalizeRfc8785(projection);
  assert.equal(serialized.includes(canary), false);
  for (const forbidden of [
    "runId",
    "tenantCommitment",
    "frozen",
    "runManifest",
    "suiteManifest",
    "policy",
    "caseId",
    "sourceSubpanels",
    "paidReviewerCount",
    "reviewerQualifications",
    "rationaleDigests",
    "failureTagCounts",
    "settlement",
    "chainEvidence",
    "recomputation",
    "signature",
    "publicKey",
  ]) {
    assert.equal(serialized.includes(`"${forbidden}":`), false, `${forbidden} escaped the allowlist`);
  }
  const reordered = {
    ...source,
    payload: { unrelatedPrivateField: { z: canary, a: canary }, ...source.payload },
  };
  assert.equal(canonicalizeRfc8785(projectProjectWindowEvidencePacket(reordered)), serialized);
});

test("compliance evidence projection suppresses the k-minus-one boundary", () => {
  const projection = projectProjectWindowEvidencePacket(complianceProjectionSource(1));
  assert.deepEqual(projection.result, { suppressed: true, minimumAggregationSize: 2 });
  assert.equal("coverage" in projection.period, false);
  assert.equal(canonicalizeRfc8785(projection).includes("case_PRIVATE_CANARY_DO_NOT_DISCLOSE"), false);
});

test("compliance evidence projection rejects source packets that declare private payload inclusion", () => {
  const source = complianceProjectionSource(2);
  assert.throws(
    () =>
      projectProjectWindowEvidencePacket({
        ...source,
        payload: { ...source.payload, privacy: { ...source.payload.privacy, rawRationaleIncluded: true } },
      }),
    /Stored project-window compliance-share evidence is invalid/u,
  );
});

test("the share is capped at 30 days and does not become research or Article 40 access", () => {
  assert.equal(__projectWindowComplianceSharesTestUtils.maxShareLifetimeMs, 30 * 24 * 60 * 60 * 1_000);
  const serialized = canonicalizeRfc8785(manifest()).toLowerCase();
  assert.doesNotMatch(serialized, /benchmark.research|article.?40|vetted.research/u);
});
