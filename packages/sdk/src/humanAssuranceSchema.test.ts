import assert from "node:assert/strict";
import test from "node:test";
import { RateLoopSdkError } from "./errors";
import {
  HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA,
  HUMAN_ASSURANCE_CLIENT_DECISION_JSON_SCHEMA,
  HUMAN_ASSURANCE_EVIDENCE_PACKET_JSON_SCHEMA,
  HUMAN_ASSURANCE_PROJECT_JSON_SCHEMA,
  parseHumanAssuranceArtifact,
  parseHumanAssuranceAudiencePolicy,
  parseHumanAssuranceCase,
  parseHumanAssuranceClientDecision,
  parseHumanAssuranceEvidencePacket,
  parseHumanAssuranceProject,
  parseHumanAssuranceResponse,
  parseHumanAssuranceRubric,
  parseHumanAssuranceRun,
  parseHumanAssuranceSuite,
} from "./humanAssuranceSchema";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "./humanAssuranceTypes";

const now = "2026-07-13T12:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as const;
const base = { schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION };

test("v2 parsers cover the complete human-assurance domain", () => {
  assert.deepEqual(
    parseHumanAssuranceProject({
      ...base,
      projectId: "project_1",
      workspaceId: "workspace_1",
      name: "Support agent regression",
      dataClassification: "confidential",
      status: "active",
      retentionDays: 90,
      createdAt: now,
      updatedAt: now,
    }).dataClassification,
    "confidential",
  );

  assert.equal(
    parseHumanAssuranceArtifact({
      ...base,
      artifactId: "artifact_1",
      projectId: "project_1",
      role: "candidate",
      label: "Candidate",
      digest: hash,
      contentType: "text/plain",
      sizeBytes: 42,
      storageRef: "artifact://private/1",
      redactionStatus: "approved",
      rendererPolicy: "plain_text",
      createdAt: now,
    }).digest,
    hash,
  );

  assert.equal(
    parseHumanAssuranceCase({
      ...base,
      caseId: "case_1",
      projectId: "project_1",
      title: "Refund request",
      instructions: "Choose the better response.",
      baselineArtifactId: "artifact_baseline",
      candidateArtifactId: "artifact_candidate",
      contextArtifactIds: [],
      status: "ready",
    }).status,
    "ready",
  );

  assert.equal(
    parseHumanAssuranceRubric({
      ...base,
      rubricId: "rubric_1",
      projectId: "project_1",
      version: 1,
      prompt: "Which response is better?",
      choices: ["baseline", "candidate", "tie"],
      failureTags: [{ key: "unsafe", label: "Unsafe" }],
      rationale: { mode: "required", minLength: 10, maxLength: 500 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6000,
        minimumValidResponses: 30,
      },
    }).passRule.thresholdBps,
    6000,
  );

  assert.deepEqual(
    parseHumanAssuranceAudiencePolicy({
      ...base,
      policyId: "policy_1",
      version: 1,
      reviewerSource: "customer_invited",
      compensation: "paid",
      cohorts: [
        { cohortId: "cohort_1", minimumReviewers: 10, maximumReviewers: 20 },
      ],
      selection: "customer_named",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [
        { key: "support_experience", operator: "attested", value: true },
      ],
      assurance: {
        requiredCapabilities: ["customer_invitation", "live_human"],
        allowedProviders: ["world-id", "self"],
        freshnessSeconds: 3600,
      },
      buyerPrivacy: {
        visibleFields: ["reviewer_source", "qualification_summary"],
        minimumAggregationSize: 10,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: true,
    }).assurance.requiredCapabilities,
    ["customer_invitation", "live_human"],
  );

  assert.equal(
    parseHumanAssuranceSuite({
      ...base,
      suiteId: "suite_1",
      projectId: "project_1",
      name: "Release gate",
      version: 1,
      status: "frozen",
      caseIds: ["case_1"],
      rubricId: "rubric_1",
      rubricVersion: 1,
      frozenAt: now,
    }).version,
    1,
  );

  assert.equal(
    parseHumanAssuranceRun({
      ...base,
      runId: "run_1",
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: 1,
      audiencePolicyId: "policy_1",
      audiencePolicyVersion: 1,
      status: "collecting",
      policyHash: hash,
      manifestHash: hash,
      previousRunId: null,
      createdAt: now,
      frozenAt: now,
      completedAt: null,
    }).status,
    "collecting",
  );

  assert.equal(
    parseHumanAssuranceResponse({
      ...base,
      responseId: "response_1",
      runId: "run_1",
      caseId: "case_1",
      choice: "candidate",
      failureTagKeys: [],
      rationale: "More accurate and actionable.",
      reviewer: {
        source: "customer_invited",
        qualificationKeys: ["support_experience"],
        assuranceCapabilities: ["customer_invitation"],
      },
      responseDigest: hash,
      settlementReference: "base-sepolia:123",
      validity: "valid",
      submittedAt: now,
    }).choice,
    "candidate",
  );

  assert.equal(
    parseHumanAssuranceEvidencePacket({
      ...base,
      packetId: "packet_1",
      runId: "run_1",
      manifestHash: hash,
      caseRoot: hash,
      responseRoot: hash,
      aggregationVersion: "preference-share.v1",
      result: {
        candidatePreferenceShareBps: 6400,
        validResponseCount: 50,
        invalidResponseCount: 2,
        missingCaseCount: 0,
        disagreementBps: 3600,
        interval: { method: "wilson_95", lowerBps: 5014, upperBps: 7576 },
        passed: true,
      },
      limitations: ["Customer selected the cases."],
      chainReferences: ["base-sepolia:123"],
      generatedAt: now,
      signature: "ed25519:example",
    }).result.interval?.method,
    "wilson_95",
  );

  assert.equal(
    parseHumanAssuranceClientDecision({
      ...base,
      decisionId: "decision_1",
      runId: "run_1",
      decision: "go",
      decidedBy: "0x1111111111111111111111111111111111111111",
      evidencePacketId: "packet_1",
      decidedAt: now,
    }).decision,
    "go",
  );
});

test("v2 refuses ordered tiers, fake confidence, and unpaid eligibility bypasses", () => {
  assert.throws(
    () =>
      parseHumanAssuranceAudiencePolicy({
        ...base,
        policyId: "policy_1",
        version: 1,
        reviewerSource: "rateloop_network",
        compensation: "paid",
        cohorts: [],
        selection: "randomized",
        fallbacks: { allowed: false, sources: [] },
        requiredQualifications: [],
        assurance: {
          tierId: "passport",
          requiredCapabilities: ["document_holder"],
          allowedProviders: ["world-id"],
        },
        buyerPrivacy: {
          visibleFields: ["reviewer_source"],
          minimumAggregationSize: 5,
          suppressSmallCells: true,
        },
        legalEligibilityRequired: false,
      }),
    (error: unknown) =>
      error instanceof RateLoopSdkError &&
      error.message.includes("legalEligibilityRequired"),
  );

  const schemaText = JSON.stringify(
    HUMAN_ASSURANCE_EVIDENCE_PACKET_JSON_SCHEMA,
  );
  assert.equal(schemaText.includes("confidence"), false);
  assert.equal(schemaText.includes("tierId"), false);
});

test("v2 JSON schemas are distinct, versioned public contracts", () => {
  assert.equal(
    HUMAN_ASSURANCE_PROJECT_JSON_SCHEMA.$id,
    "urn:rateloop:human-assurance:project:v2",
  );
  assert.equal(
    HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA.properties.schemaVersion.const,
    HUMAN_ASSURANCE_SCHEMA_VERSION,
  );
  assert.equal(
    HUMAN_ASSURANCE_CLIENT_DECISION_JSON_SCHEMA.$id,
    "urn:rateloop:human-assurance:client-decision:v2",
  );
});
