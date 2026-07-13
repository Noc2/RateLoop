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

const integrityPolicy = {
  schemaVersion: "rateloop.integrity-assignment.v1" as const,
  epochId: "integrity:2026-07-13:001",
  epochManifestHash: `sha256:${"a".repeat(64)}` as const,
  maxClusterShareBps: 2_000,
  allowedRiskBands: ["low", "medium"] as const,
  recentCoassignmentWindowSeconds: 2_592_000,
  maxRecentCoassignments: 1,
  maxPerCustomer: 3,
  onePerProviderSubject: true as const,
};

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
        requirements: [
          {
            capability: "customer_invitation",
            reviewerSources: ["customer_invited"],
            allowedProviders: ["rateloop:invitation"],
          },
          {
            capability: "live_human",
            reviewerSources: ["rateloop_network"],
            allowedProviders: ["world-id", "self"],
            freshnessSeconds: 3600,
          },
        ],
      },
      buyerPrivacy: {
        visibleFields: ["reviewer_source", "qualification_summary"],
        minimumAggregationSize: 10,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: true,
    }).assurance.requirements.map((value) => value.capability),
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
      aggregationVersion: "rateloop.descriptive-case-quorum.v2",
      result: {
        method: "descriptive_per_case",
        reviewerCoverage: {
          targetReviewerCount: 5,
          assignedReviewerCount: 5,
          paidReviewerCount: 0,
          respondingReviewerCount: 5,
          completeJudgmentSetReviewerCount: 5,
        },
        judgmentCoverage: {
          caseCount: 2,
          targetExpectedJudgmentCount: 10,
          assignedExpectedJudgmentCount: 10,
          submittedJudgmentCount: 10,
          validJudgmentCount: 10,
          invalidJudgmentCount: 0,
          pendingJudgmentCount: 0,
          missingTargetJudgmentCount: 0,
          missingAssignedJudgmentCount: 0,
        },
        cases: [
          {
            caseId: "case_1",
            targetReviewerCount: 5,
            assignedReviewerCount: 5,
            submittedJudgmentCount: 5,
            validReviewerCount: 5,
            invalidJudgmentCount: 0,
            pendingJudgmentCount: 0,
            missingTargetJudgmentCount: 0,
            missingAssignedJudgmentCount: 0,
            quorum: { requiredValidReviewers: 3, met: true },
            candidatePreferenceShareBps: 6000,
            disagreementBps: 4000,
            outcome: "pass",
          },
          {
            caseId: "case_2",
            targetReviewerCount: 5,
            assignedReviewerCount: 5,
            submittedJudgmentCount: 5,
            validReviewerCount: 5,
            invalidJudgmentCount: 0,
            pendingJudgmentCount: 0,
            missingTargetJudgmentCount: 0,
            missingAssignedJudgmentCount: 0,
            quorum: { requiredValidReviewers: 3, met: true },
            candidatePreferenceShareBps: 8000,
            disagreementBps: 2000,
            outcome: "pass",
          },
        ],
        suite: {
          method: "all_cases_must_pass",
          evaluatedCaseCount: 2,
          passCaseCount: 2,
          failCaseCount: 0,
          insufficientCaseCount: 0,
          outcome: "pass",
        },
      },
      limitations: ["Customer selected the cases."],
      chainReferences: ["base-sepolia:123"],
      generatedAt: now,
      signature: "ed25519:example",
    }).result.judgmentCoverage.targetExpectedJudgmentCount,
    10,
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
        integrity: integrityPolicy,
        compensation: "paid",
        cohorts: [],
        selection: "randomized",
        fallbacks: { allowed: false, sources: [] },
        requiredQualifications: [],
        assurance: {
          tierId: "passport",
          requirements: [
            {
              capability: "document_holder",
              reviewerSources: ["rateloop_network"],
              allowedProviders: ["world-id"],
            },
          ],
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

test("v2 assurance requirements must identify a concrete reviewer source", () => {
  assert.throws(
    () =>
      parseHumanAssuranceAudiencePolicy({
        ...base,
        policyId: "policy_source_required",
        version: 1,
        reviewerSource: "rateloop_network",
        integrity: integrityPolicy,
        compensation: "paid",
        cohorts: [],
        selection: "randomized",
        fallbacks: { allowed: false, sources: [] },
        requiredQualifications: [],
        assurance: {
          requirements: [
            {
              capability: "unique_human",
              reviewerSources: [],
              allowedProviders: ["world-id"],
            },
          ],
        },
        buyerPrivacy: {
          visibleFields: ["reviewer_source"],
          minimumAggregationSize: 5,
          suppressSmallCells: true,
        },
        legalEligibilityRequired: true,
      }),
    (error: unknown) =>
      error instanceof RateLoopSdkError &&
      error.message.includes("reviewerSources"),
  );
});

test("network policies freeze exact epoch constraints while non-network policies cannot claim them", () => {
  const common = {
    ...base,
    policyId: "policy_integrity_required",
    version: 1,
    compensation: "paid",
    cohorts: [],
    selection: "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "unique_human",
          reviewerSources: ["rateloop_network"],
          allowedProviders: ["world:poh"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: 5,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
  assert.throws(
    () =>
      parseHumanAssuranceAudiencePolicy({
        ...common,
        reviewerSource: "rateloop_network",
      }),
    (error: unknown) =>
      error instanceof RateLoopSdkError && error.message.includes("integrity"),
  );
  assert.throws(
    () =>
      parseHumanAssuranceAudiencePolicy({
        ...common,
        reviewerSource: "rateloop_network",
        integrity: integrityPolicy,
        assurance: {
          requirements: [
            {
              capability: "unique_human",
              reviewerSources: ["rateloop_network"],
              allowedProviders: ["world-id"],
            },
          ],
        },
      }),
    (error: unknown) =>
      error instanceof RateLoopSdkError && error.message.includes("world:poh"),
  );
  assert.throws(
    () =>
      parseHumanAssuranceAudiencePolicy({
        ...common,
        reviewerSource: "customer_invited",
        integrity: integrityPolicy,
      }),
    (error: unknown) =>
      error instanceof RateLoopSdkError &&
      error.message.includes("invited and sandbox"),
  );
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
