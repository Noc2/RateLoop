import { TOKENLESS_SCHEMA_VERSION, type TokenlessResult } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __adaptiveReviewEvidenceTestUtils,
  finalizeAdaptiveReviewEvidence,
} from "~~/lib/tokenless/adaptiveReviewEvidence";
import {
  type AdaptiveReviewIntegrationPrincipal,
  __adaptiveReviewOrchestrationTestUtils,
  getAdaptiveHumanReviewResult,
  requestAdaptiveHumanReview,
} from "~~/lib/tokenless/adaptiveReviewOrchestration";
import { evaluateAdaptiveReviewRequirement } from "~~/lib/tokenless/adaptiveReviewService";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { transitionHumanReviewOpportunityLifecycle } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import {
  authenticateProductPrincipal,
  createAgentPublishingPolicy,
  createWorkspace,
  createWorkspaceApiKey,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const SOURCE_PAYLOAD = "The customer was charged twice for invoice 42.";
const SUGGESTION_PAYLOAD = "Refund the confirmed duplicate charge.";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
const originalNetworkPanelsEnabled = process.env.TOKENLESS_NETWORK_PANELS_ENABLED;

function networkAdmissionPolicy() {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId: "haa_adaptive_review_network",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:adaptive-review:test",
      epochManifestHash: `sha256:${"ab".repeat(32)}` as const,
      maxClusterShareBps: 3_334,
      allowedRiskBands: ["low", "medium"] as const,
      recentCoassignmentWindowSeconds: 2_592_000,
      maxRecentCoassignments: 1,
      maxPerCustomer: 3,
      onePerProviderSubject: true as const,
    },
    compensation: "paid" as const,
    cohorts: [],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "unique_human" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["world:poh"],
          freshnessSeconds: 3_600,
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 3,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

const FROZEN_ADMISSION_POLICY = freezeAdmissionPolicy(networkAdmissionPolicy());
const ADMISSION_HASH = FROZEN_ADMISSION_POLICY.admissionPolicyHash;

async function seedNetworkAdmissionPolicy(workspaceId: string) {
  const now = new Date();
  const projectId = `hap_adaptive_${workspaceId.slice(-16)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,retention_days,created_by,created_at,updated_at)
          VALUES (?,?,'Adaptive review network fixture','synthetic',30,?,?,?)`,
    args: [projectId, workspaceId, OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES (?,?,1,'rateloop_network','paid','[]','randomized',?,?,?,?,?,?,?,?)`,
    args: [
      FROZEN_ADMISSION_POLICY.policy.policyId,
      projectId,
      JSON.stringify(FROZEN_ADMISSION_POLICY.policy.fallbacks),
      JSON.stringify(FROZEN_ADMISSION_POLICY.policy.requiredQualifications),
      JSON.stringify(FROZEN_ADMISSION_POLICY.policy.assurance),
      JSON.stringify(FROZEN_ADMISSION_POLICY.policy.buyerPrivacy),
      FROZEN_ADMISSION_POLICY.policy.legalEligibilityRequired,
      FROZEN_ADMISSION_POLICY.policyHash,
      FROZEN_ADMISSION_POLICY.policyJson,
      now,
    ],
  });
}

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "88".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "evidence-test-v1";
  process.env.TOKENLESS_NETWORK_PANELS_ENABLED = "true";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
  if (originalNetworkPanelsEnabled === undefined) delete process.env.TOKENLESS_NETWORK_PANELS_ENABLED;
  else process.env.TOKENLESS_NETWORK_PANELS_ENABLED = originalNetworkPanelsEnabled;
});

async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Adaptive evidence", ownerAddress: OWNER });
  await seedNetworkAdmissionPolicy(workspaceId);
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "duplicate-charge-agent",
    version: {
      displayName: "Duplicate Charge Agent",
      provider: "OpenAI",
      model: "gpt-test",
      environment: "production",
    },
  });
  const publishingPolicy = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Evidence review publishing",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "100000000",
      maxDailyAtomic: "500000000",
      maxMonthlyAtomic: "5000000000",
      maxPanelSize: 20,
      maxBountyAtomic: "50000000",
      maxFeeBps: 1_000,
      maxAttemptReserveAtomic: "20000000",
      allowedReviewerSources: ["rateloop_network"],
      allowedAdmissionPolicyHashes: [ADMISSION_HASH],
      allowedDataClassifications: ["synthetic"],
    },
  });
  const reviewPolicyId = "arp_evidence_v1";
  const audiencePolicy = { reviewerSource: "public_network" };
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, publishing_policy_id, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 9000, 1000, 20, ?, ?, ?, ?, ?, ?)`,
    args: [
      reviewPolicyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ criticalRiskTiers: ["critical"], requiredRiskTiers: [] }),
      JSON.stringify(audiencePolicy),
      publishingPolicy.policyId,
      OWNER,
      OWNER,
      now,
    ],
  });
  const humanReview = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId: reviewPolicyId,
    actor: OWNER,
  });
  const automaticBindingHash = hashHumanReviewConfiguration({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    selectionPolicy: { id: reviewPolicyId, version: 1 },
    requestProfile: {
      id: humanReview.profileId,
      version: humanReview.profileVersion,
      hash: humanReview.profileHash,
    },
    publishingPolicy: { id: publishingPolicy.policyId, version: 1 },
    authority: "ask_automatically",
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_human_review_bindings
          SET publishing_policy_id = ?, publishing_policy_version = 1, authority = 'ask_automatically',
              canonical_hash = ?
          WHERE workspace_id = ? AND binding_id = ? AND version = 1`,
    args: [publishingPolicy.policyId, automaticBindingHash, workspaceId, humanReview.bindingId],
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Evidence integration",
    policyId: publishingPolicy.policyId,
    scopes: ["review:decide", "evaluation:read", "panel:publish", "payment:submit", "result:read"],
  });
  const productPrincipal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  if (productPrincipal.kind !== "api_key") throw new Error("Expected API-key principal.");
  const principal: AdaptiveReviewIntegrationPrincipal = {
    kind: "integration",
    principal: productPrincipal,
    integration: {
      integrationId: "int_evidence_v1",
      workspaceId,
      agentId: agent.agentId,
      agentVersionId: agent.currentVersion.versionId,
      reviewPolicyId,
      reviewPolicyVersion: 1,
      publishingPolicyId: publishingPolicy.policyId,
      publishingPolicyVersion: 1,
      status: "active",
      enforcementMode: "advisory",
      allowedWorkflowKeys: ["refund-review"],
      lastSeenAt: null,
    },
  };
  const decision = await evaluateAdaptiveReviewRequirement({
    principal: productPrincipal,
    request: {
      externalOpportunityId: "duplicate-charge-0001",
      agentId: agent.agentId,
      agentVersionId: agent.currentVersion.versionId,
      policyId: reviewPolicyId,
      policyVersion: 1,
      workflowKey: "refund-review",
      riskTier: "low",
      audiencePolicyHash: __adaptiveReviewOrchestrationTestUtils.sha256(JSON.stringify(audiencePolicy)),
      suggestionCommitment: __adaptiveReviewOrchestrationTestUtils.sha256(SUGGESTION_PAYLOAD),
      sourceEvidence: {
        reference: "invoice/42/revision-1",
        hash: __adaptiveReviewOrchestrationTestUtils.sha256(SOURCE_PAYLOAD),
      },
      declaredConfidenceBps: 8_500,
      metadataComplete: true,
      execution: {
        externalExecutionId: "execution-duplicate-charge-0001",
        status: "completed",
        primarySpanId: "generation-primary",
        generationSpans: [
          {
            spanId: "generation-primary",
            role: "primary",
            provider: "OpenAI",
            requestedModel: "gpt-5.6-sol",
            reasoningEffort: "medium",
          },
        ],
      },
    },
  });
  if (decision.lifecycle.state !== "request_ready") {
    await transitionHumanReviewOpportunityLifecycle({
      workspaceId,
      opportunityId: decision.opportunityId,
      transitionKey: `test-public-ready:${decision.opportunityId}`,
      expectedState: decision.lifecycle.state as "approval_required" | "blocked",
      expectedRevision: decision.lifecycle.revision,
      toState: "request_ready",
      reasonCodes: ["test_owner_grant"],
      actor: { kind: "owner", reference: OWNER },
    });
  }
  await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "test-funding" });
  const requested = await requestAdaptiveHumanReview({
    principal,
    opportunityId: decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    publication: {
      visibility: "public",
      dataClassification: "synthetic",
      confirmedNoSensitiveData: true,
    },
    appOrigin: "https://rateloop-tokenless.example",
  });
  return { workspaceId, principal, decision, operationKey: requested.ask.operationKey };
}

async function storedResult(
  operationKey: string,
  input: {
    status?: TokenlessResult["verdictStatus"];
    selected?: string | null;
    preferenceShareBps?: number | null;
    participantCount?: number;
    updatedAt?: string;
  } = {},
) {
  const ask = await dbClient.execute({
    sql: "SELECT economics_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [operationKey],
  });
  const status = input.status ?? "publishable";
  const publishable = status === "publishable";
  const result: TokenlessResult = {
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey,
    roundId: "round_evidence_0001",
    verdictStatus: status,
    terminal: status !== "pending",
    responseWindowSeconds: 1_200,
    commitDeadline: "2026-07-17T12:00:00.000Z",
    requestProfile: null,
    reviewEconomics: null,
    economics: JSON.parse(String(ask.rows[0]?.economics_json)) as TokenlessResult["economics"],
    audience: {
      admissionPolicyHash: ADMISSION_HASH,
      label: "RateLoop-network reviewers",
      participantCount: input.participantCount ?? 5,
      source: "rateloop_network",
    },
    verdict: publishable
      ? {
          intervalBps: { lower: 4_500, upper: 9_500 },
          preferenceShareBps: input.preferenceShareBps ?? 8_000,
          selected: input.selected === undefined ? "yes" : input.selected,
        }
      : null,
    feedback: { items: [], redactedCount: 0 },
    methodologyUrl: "https://rateloop-tokenless.example/docs/how-it-works",
    updatedAt: input.updatedAt ?? new Date(Date.now() + 1_000).toISOString(),
  };
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks
          SET result_json = ?, verdict_status = ?, updated_at = ?
          WHERE operation_key = ?`,
    args: [JSON.stringify(result), status, new Date(result.updatedAt), operationKey],
  });
  return result;
}

async function observationRow(opportunityId: string) {
  const result = await dbClient.execute({
    sql: `SELECT observation_id, evidence_reference, source_payload_hash, agent_outcome_commitment,
                 human_outcome_commitment, agreement, comparable, responding_human_count,
                 human_human_agreement_bps, latency_ms, cost_atomic, finalized_at
          FROM tokenless_agent_evaluation_observations WHERE opportunity_id = ?`,
    args: [opportunityId],
  });
  return result.rows[0] as Record<string, unknown> | undefined;
}

test("idempotently derives comparable yes evidence from the bound server result", async () => {
  const setup = await fixture();
  const result = await storedResult(setup.operationKey, { preferenceShareBps: 8_000, participantCount: 5 });
  const completed = await getAdaptiveHumanReviewResult({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
  });
  const first = completed.observation;
  const replay = await finalizeAdaptiveReviewEvidence({ operationKey: setup.operationKey });

  assert.deepEqual(completed.result, result);
  assert.ok(first);
  assert.deepEqual(replay, first);
  assert.equal(first.agreement, "agree");
  assert.equal(first.comparable, true);
  assert.equal(first.respondingHumanCount, 5);
  assert.equal(first.humanHumanAgreementBps, 8_000);
  assert.equal(first.sourcePayloadHash, __adaptiveReviewOrchestrationTestUtils.sha256(SOURCE_PAYLOAD));
  assert.equal(first.agentOutcomeCommitment, __adaptiveReviewOrchestrationTestUtils.sha256(SUGGESTION_PAYLOAD));
  assert.match(first.humanOutcomeCommitment, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.costAtomic, "0");
  assert.equal(first.finalizedAt, result.updatedAt);

  const stored = await observationRow(setup.decision.opportunityId);
  assert.equal(stored?.observation_id, first.observationId);
  assert.equal(stored?.agreement, "agree");
  assert.equal(stored?.comparable, true);
  const opportunity = await dbClient.execute({
    sql: "SELECT status FROM tokenless_agent_review_opportunities WHERE opportunity_id = ?",
    args: [setup.decision.opportunityId],
  });
  assert.equal(opportunity.rows[0]?.status, "completed");
});

test("maps no to disagreement and invalidates comparability after a terminal delisting", async () => {
  const setup = await fixture();
  await storedResult(setup.operationKey, { selected: "no", preferenceShareBps: 2_500, participantCount: 4 });
  const disagreement = await finalizeAdaptiveReviewEvidence({ operationKey: setup.operationKey });
  assert.ok(disagreement);
  assert.equal(disagreement.agreement, "disagree");
  assert.equal(disagreement.comparable, true);
  assert.equal(disagreement.humanHumanAgreementBps, 7_500);

  await storedResult(setup.operationKey, { status: "delisted", participantCount: 4 });
  const delisted = await finalizeAdaptiveReviewEvidence({ operationKey: setup.operationKey });
  assert.ok(delisted);
  assert.equal(delisted.observationId, disagreement.observationId);
  assert.equal(delisted.agreement, "inconclusive");
  assert.equal(delisted.comparable, false);
  assert.equal(delisted.respondingHumanCount, 4);
  assert.equal(delisted.humanHumanAgreementBps, null);
  assert.notEqual(delisted.humanOutcomeCommitment, disagreement.humanOutcomeCommitment);
  const stored = await observationRow(setup.decision.opportunityId);
  assert.equal(stored?.comparable, false);
  assert.equal(stored?.agreement, "inconclusive");
});

test("agent-authored feedback results never become adaptive observations", async () => {
  const setup = await fixture();
  const result = await storedResult(setup.operationKey);
  const observation = __adaptiveReviewEvidenceTestUtils.observationFromResult({
    row: {
      result_semantics: "feedback",
      question_authority: "agent_per_request",
      question_hash: __adaptiveReviewOrchestrationTestUtils.sha256("Would you buy this product?"),
    },
    result,
    operationKey: setup.operationKey,
  });
  assert.equal(observation, null);
});

test("fails before terminal evidence", async () => {
  const setup = await fixture();
  await assert.rejects(
    () => finalizeAdaptiveReviewEvidence({ operationKey: setup.operationKey }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "result_not_ready" && error.retryable,
  );
  assert.equal(await observationRow(setup.decision.opportunityId), undefined);
});
