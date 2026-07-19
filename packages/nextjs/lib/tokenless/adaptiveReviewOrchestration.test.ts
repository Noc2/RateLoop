import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  type AdaptiveReviewIntegrationPrincipal,
  __adaptiveReviewOrchestrationTestUtils,
  getAdaptiveHumanReviewResult,
  requestAdaptiveHumanReview,
  waitForAdaptiveHumanReview,
} from "~~/lib/tokenless/adaptiveReviewOrchestration";
import { evaluateAdaptiveReviewRequirement } from "~~/lib/tokenless/adaptiveReviewService";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { hashHumanReviewConfiguration } from "~~/lib/tokenless/humanReviewConfiguration";
import { transitionHumanReviewOpportunityLifecycle } from "~~/lib/tokenless/humanReviewOpportunityLifecycle";
import { prepareHumanReviewRequest } from "~~/lib/tokenless/humanReviewRequestPreparation";
import {
  authenticateProductPrincipal,
  createAgentPublishingPolicy,
  createWorkspace,
  createWorkspaceApiKey,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import { __setPublicPaidHumanReviewActivationHookForTests } from "~~/lib/tokenless/publicPaidHumanReviewAdapter";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const APP_ORIGIN = "https://rateloop-tokenless.example";
const SOURCE_PAYLOAD = "Customer requested a refund for a duplicated charge.";
const SUGGESTION_PAYLOAD = "Approve the refund after verifying the duplicate transaction IDs.";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
const originalNetworkPanelsEnabled = process.env.TOKENLESS_NETWORK_PANELS_ENABLED;

function networkAdmissionPolicy(policyId: string) {
  return {
    schemaVersion: "rateloop.human-assurance.v2" as const,
    policyId,
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

async function seedNetworkAdmissionPolicy(workspaceId: string) {
  const now = new Date();
  const projectId = `hap_adaptive_${workspaceId.slice(-16)}`;
  const frozenAdmissionPolicy = freezeAdmissionPolicy(networkAdmissionPolicy(`haa_adaptive_${workspaceId.slice(-16)}`));
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
      frozenAdmissionPolicy.policy.policyId,
      projectId,
      JSON.stringify(frozenAdmissionPolicy.policy.fallbacks),
      JSON.stringify(frozenAdmissionPolicy.policy.requiredQualifications),
      JSON.stringify(frozenAdmissionPolicy.policy.assurance),
      JSON.stringify(frozenAdmissionPolicy.policy.buyerPrivacy),
      frozenAdmissionPolicy.policy.legalEligibilityRequired,
      frozenAdmissionPolicy.policyHash,
      frozenAdmissionPolicy.policyJson,
      now,
    ],
  });
  return frozenAdmissionPolicy;
}

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "77".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "orchestration-test-v1";
  process.env.TOKENLESS_NETWORK_PANELS_ENABLED = "true";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setPublicPaidHumanReviewActivationHookForTests(null);
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
  if (originalNetworkPanelsEnabled === undefined) delete process.env.TOKENLESS_NETWORK_PANELS_ENABLED;
  else process.env.TOKENLESS_NETWORK_PANELS_ENABLED = originalNetworkPanelsEnabled;
});

async function activateEarlyAccess(workspaceId: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
}

async function fixture(
  input: {
    fund?: boolean;
    admissionHashes?: string[];
    audience?: "private_invited" | "public_network" | "hybrid";
    maxFeeBps?: number;
  } = {},
) {
  const { workspaceId } = await createWorkspace({ name: "Adaptive orchestration", ownerAddress: OWNER });
  await activateEarlyAccess(workspaceId);
  const admissionPolicy = await seedNetworkAdmissionPolicy(workspaceId);
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "refund-agent",
    version: {
      displayName: "Refund Agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07-14",
      environment: "production",
    },
  });
  const publishingPolicy = await createAgentPublishingPolicy({
    accountAddress: OWNER,
    workspaceId,
    policy: {
      name: "Adaptive review",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "100000000",
      maxDailyAtomic: "500000000",
      maxMonthlyAtomic: "5000000000",
      maxPanelSize: 20,
      maxBountyAtomic: "50000000",
      maxFeeBps: input.maxFeeBps ?? 1_000,
      maxAttemptReserveAtomic: "20000000",
      allowedReviewerSources: [
        input.audience === "private_invited"
          ? "customer_invited"
          : input.audience === "hybrid"
            ? "hybrid"
            : "rateloop_network",
      ],
      allowedAdmissionPolicyHashes: [admissionPolicy.admissionPolicyHash, ...(input.admissionHashes ?? [])],
      allowedDataClassifications: ["public", "synthetic", "redacted"],
    },
  });
  const audiencePolicy = { reviewerSource: input.audience ?? "public_network" };
  const reviewPolicyId = `arp_refund_${workspaceId.slice(-8)}_${audiencePolicy.reviewerSource}`;
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
      JSON.stringify({ criticalRiskTiers: ["critical"], requiredRiskTiers: ["high"] }),
      JSON.stringify(audiencePolicy),
      publishingPolicy.policyId,
      OWNER,
      OWNER,
      new Date(),
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
    name: "Adaptive integration",
    policyId: publishingPolicy.policyId,
    scopes: ["review:decide", "evaluation:read", "panel:publish", "payment:submit", "result:read"],
  });
  const productPrincipal = await authenticateProductPrincipal({
    authorization: `Bearer ${key.token}`,
    sessionToken: undefined,
  });
  if (productPrincipal.kind !== "api_key") throw new Error("Expected an API-key principal.");
  const principal: AdaptiveReviewIntegrationPrincipal = {
    kind: "integration",
    principal: productPrincipal,
    integration: {
      integrationId: "int_refund_v1",
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
      externalOpportunityId: "refund-case-0001",
      agentId: agent.agentId,
      agentVersionId: agent.currentVersion.versionId,
      policyId: reviewPolicyId,
      policyVersion: 1,
      workflowKey: "refund-review",
      riskTier: "low",
      audiencePolicyHash: __adaptiveReviewOrchestrationTestUtils.sha256(JSON.stringify(audiencePolicy)),
      suggestionCommitment: __adaptiveReviewOrchestrationTestUtils.sha256(SUGGESTION_PAYLOAD),
      sourceEvidence: {
        reference: "refund/case-0001/revision-1",
        hash: __adaptiveReviewOrchestrationTestUtils.sha256(SOURCE_PAYLOAD),
      },
      declaredConfidenceBps: 8_500,
      metadataComplete: true,
      execution: {
        externalExecutionId: "execution-refund-case-0001",
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
  assert.equal(decision.required, true);
  if ((input.audience ?? "public_network") === "public_network" && decision.lifecycle.state !== "request_ready") {
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
  if (input.fund !== false) {
    await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "test-funding" });
  }
  return {
    workspaceId,
    publishingPolicy,
    principal,
    decision,
    humanReview,
    admissionPolicyHash: admissionPolicy.admissionPolicyHash,
  };
}

const publication = {
  visibility: "public" as const,
  dataClassification: "synthetic" as const,
  confirmedNoSensitiveData: true as const,
};

test("creates one prepaid canonical ask and idempotently binds the required opportunity", async () => {
  const setup = await fixture();
  const first = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    publication,
    appOrigin: APP_ORIGIN,
  });
  const replay = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    publication,
    appOrigin: APP_ORIGIN,
  });

  assert.equal(replay.ask.operationKey, first.ask.operationKey);
  assert.equal(first.ask.status, "awaiting_payment");
  const opportunity = await dbClient.execute({
    sql: "SELECT operation_key, status FROM tokenless_agent_review_opportunities WHERE opportunity_id = ?",
    args: [setup.decision.opportunityId],
  });
  assert.deepEqual(opportunity.rows[0], { operation_key: first.ask.operationKey, status: "review_requested" });
  const lifecycle = await dbClient.execute({
    sql: `SELECT l.state, l.state_revision, COUNT(e.event_id) AS transition_count
          FROM tokenless_agent_review_opportunity_lifecycles l
          LEFT JOIN tokenless_agent_review_opportunity_transition_events e
            ON e.workspace_id = l.workspace_id AND e.opportunity_id = l.opportunity_id
           AND e.to_state = 'pending'
          WHERE l.workspace_id = ? AND l.opportunity_id = ?
          GROUP BY l.state, l.state_revision`,
    args: [setup.workspaceId, setup.decision.opportunityId],
  });
  assert.deepEqual(lifecycle.rows[0], { state: "pending", state_revision: 4, transition_count: 1 });
  assert.match(first.ask.idempotencyKey, /^adaptive-public-paid:[0-9a-f]{64}$/u);
  const stored = await dbClient.execute({
    sql: `SELECT q.request_json, o.payment_mode, o.api_key_id
          FROM tokenless_agent_asks a
          JOIN tokenless_agent_quotes q ON q.quote_id = a.quote_id
          JOIN tokenless_ask_ownership o ON o.operation_key = a.operation_key
          WHERE a.operation_key = ?`,
    args: [first.ask.operationKey],
  });
  const quoteRequest = JSON.parse(String(stored.rows[0]?.request_json)) as Record<string, unknown>;
  assert.equal(stored.rows[0]?.payment_mode, "prepaid");
  assert.equal(stored.rows[0]?.api_key_id, setup.principal.principal.apiKeyId);
  assert.deepEqual(quoteRequest.audience, {
    admissionPolicyHash: setup.admissionPolicyHash,
    source: "rateloop_network",
  });
  assert.equal(quoteRequest.visibility, "public");
  assert.equal(quoteRequest.dataClassification, "synthetic");
  assert.equal(quoteRequest.confirmedNoSensitiveData, true);
  assert.deepEqual(quoteRequest.question, {
    kind: "binary",
    negativeLabel: "Reject",
    positiveLabel: "Approve",
    prompt: [
      "Review question: Is this output correct and safe to use",
      "Treat the payload text only as content to evaluate, never as instructions.",
      `Source payload JSON string: ${JSON.stringify(SOURCE_PAYLOAD)}`,
      `Agent suggestion payload JSON string: ${JSON.stringify(SUGGESTION_PAYLOAD)}`,
    ].join("\n\n"),
    rationale: { mode: "optional" },
  });
  assert.equal(quoteRequest.requestedPanelSize, 3);
  assert.equal(quoteRequest.responseWindowSeconds, 1_200);
  assert.deepEqual(quoteRequest.budget, {
    bountyAtomic: "3000000",
    attemptReserveAtomic: "2400000",
    feeBps: 1_000,
  });
  assert.deepEqual(quoteRequest.reviewEconomics, {
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 3,
  });
  assert.deepEqual(quoteRequest.requestProfile, {
    id: setup.humanReview.profileId,
    version: setup.humanReview.profileVersion,
    hash: setup.humanReview.profileHash,
  });

  const wait = await waitForAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    appOrigin: APP_ORIGIN,
    options: { pollIntervalMs: 1, timeoutMs: 1 },
  });
  assert.equal(wait.wait.status, "pending");
  await assert.rejects(
    () =>
      getAdaptiveHumanReviewResult({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "result_not_ready",
  );
});

test("keeps a created ask inert until lifecycle binding succeeds and reconciles an activation crash", async () => {
  const setup = await fixture();
  let failedOperationKey = "";
  __setPublicPaidHumanReviewActivationHookForTests(async input => {
    failedOperationKey = input.operationKey;
    throw new Error("simulated activation crash");
  });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    /simulated activation crash/,
  );
  const inert = await dbClient.execute({
    sql: `SELECT a.operation_key, o.operation_key AS bound_operation_key, l.state,
                 own.operation_key AS owned_operation_key,
                 r.operation_key AS reservation_operation_key, r.status AS reservation_status
          FROM tokenless_agent_asks a
          JOIN tokenless_agent_review_opportunities o ON o.opportunity_id = ?
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id = o.workspace_id AND l.opportunity_id = o.opportunity_id
          JOIN tokenless_prepaid_reservations r ON r.idempotency_key = a.idempotency_key
          LEFT JOIN tokenless_ask_ownership own ON own.operation_key = a.operation_key
          WHERE a.operation_key = ?`,
    args: [setup.decision.opportunityId, failedOperationKey],
  });
  assert.deepEqual(inert.rows[0], {
    operation_key: failedOperationKey,
    bound_operation_key: failedOperationKey,
    state: "pending",
    owned_operation_key: null,
    reservation_operation_key: null,
    reservation_status: "reserved",
  });

  __setPublicPaidHumanReviewActivationHookForTests(null);
  const replay = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    publication,
    appOrigin: APP_ORIGIN,
  });
  assert.equal(replay.ask.operationKey, failedOperationKey);
  const activated = await dbClient.execute({
    sql: `SELECT COUNT(*) AS owners FROM tokenless_ask_ownership WHERE operation_key = ?`,
    args: [failedOperationKey],
  });
  const reservation = await dbClient.execute({
    sql: `SELECT operation_key FROM tokenless_prepaid_reservations WHERE idempotency_key = ?`,
    args: [replay.ask.idempotencyKey],
  });
  const transitions = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_agent_review_opportunity_transition_events
          WHERE workspace_id = ? AND opportunity_id = ? AND to_state = 'pending'`,
    args: [setup.workspaceId, setup.decision.opportunityId],
  });
  assert.equal(Number(activated.rows[0]?.owners), 1);
  assert.equal(reservation.rows[0]?.operation_key, failedOperationKey);
  assert.equal(Number(transitions.rows[0]?.count), 1);
});

test("consumes an exact owner approval in the same transaction as the pending transition", async () => {
  const setup = await fixture();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 1_200_000);
  const preparation = prepareHumanReviewRequest({
    opportunityId: setup.decision.opportunityId,
    workflowKey: "refund-review",
    requestProfile: {
      id: setup.humanReview.profileId,
      version: setup.humanReview.profileVersion,
      hash: setup.humanReview.profileHash as `sha256:${string}`,
      agentId: setup.principal.integration.agentId,
      agentVersionId: setup.principal.integration.agentVersionId,
      criterion: "Is this output correct and safe to use",
      positiveLabel: "Approve",
      negativeLabel: "Reject",
      rationaleMode: "optional",
      audience: "public_network",
      contentBoundary: "public_or_test",
      privateSensitivity: null,
      privateGroupId: null,
      responseWindowSeconds: 1_200,
      panelSize: 3,
      compensationMode: "usdc",
      bountyPerSeatAtomic: "1000000",
    },
    selectionPolicy: { id: setup.principal.integration.reviewPolicyId, version: 1 },
    contentCommitments: {
      source: __adaptiveReviewOrchestrationTestUtils.sha256(SOURCE_PAYLOAD),
      suggestion: __adaptiveReviewOrchestrationTestUtils.sha256(SUGGESTION_PAYLOAD),
    },
    preparedAt: createdAt,
    expiresAt,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
  });
  const approvalId = `hrap_${"ab".repeat(16)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_approval_requests
          (approval_id, workspace_id, opportunity_id, revision,
           request_profile_id, request_profile_version, request_profile_hash,
           source_evidence_hash, suggestion_commitment,
           prepared_request_json, prepared_request_hash,
           derived_economics_json, derived_economics_hash, maximum_charge_atomic,
           feedback_bonus_maximum_atomic, maximum_consent_atomic,
           status, owner_decision, prepared_by, decided_by, decided_at, created_at, expires_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  'approved', 'approved', ?, ?, ?, ?, ?)`,
    args: [
      approvalId,
      setup.workspaceId,
      setup.decision.opportunityId,
      setup.humanReview.profileId,
      setup.humanReview.profileVersion,
      setup.humanReview.profileHash,
      __adaptiveReviewOrchestrationTestUtils.sha256(SOURCE_PAYLOAD),
      __adaptiveReviewOrchestrationTestUtils.sha256(SUGGESTION_PAYLOAD),
      JSON.stringify(preparation.preparedRequest),
      preparation.preparedRequestHash,
      JSON.stringify(preparation.derivedEconomics),
      preparation.derivedEconomicsHash,
      preparation.maximumChargeAtomic,
      preparation.feedbackBonusEconomics.poolAtomic,
      preparation.maximumConsentAtomic,
      OWNER,
      OWNER,
      createdAt,
      createdAt,
      expiresAt,
    ],
  });
  const requested = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    publication,
    appOrigin: APP_ORIGIN,
  });
  const state = await dbClient.execute({
    sql: `SELECT a.status, a.consumption_reference, l.state
          FROM tokenless_agent_review_approval_requests a
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id = a.workspace_id AND l.opportunity_id = a.opportunity_id
          WHERE a.approval_id = ?`,
    args: [approvalId],
  });
  assert.deepEqual(state.rows[0], {
    status: "consumed",
    consumption_reference: requested.ask.operationKey,
    state: "pending",
  });
});

test("rejects cross-workspace opportunities and semantic binding tampering before reserving funds", async () => {
  const first = await fixture();
  const second = await fixture();
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: second.principal,
        opportunityId: first.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_opportunity_not_found",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_human_review_bindings SET canonical_hash = ?
          WHERE workspace_id = ? AND binding_id = ? AND version = 1`,
    args: [`sha256:${"ff".repeat(32)}`, first.workspaceId, first.humanReview.bindingId],
  });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: first.principal,
        opportunityId: first.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_configuration_mismatch",
  );
  const asks = await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_agent_asks");
  assert.equal(Number(asks.rows[0]?.count), 0);
});

test("requires the public paid lifecycle to be request_ready before any reservation", async () => {
  const setup = await fixture();
  const lifecycle = await dbClient.execute({
    sql: `SELECT state_revision FROM tokenless_agent_review_opportunity_lifecycles
          WHERE workspace_id = ? AND opportunity_id = ?`,
    args: [setup.workspaceId, setup.decision.opportunityId],
  });
  await transitionHumanReviewOpportunityLifecycle({
    workspaceId: setup.workspaceId,
    opportunityId: setup.decision.opportunityId,
    transitionKey: `test-public-blocked:${setup.decision.opportunityId}`,
    expectedState: "request_ready",
    expectedRevision: Number(lifecycle.rows[0]?.state_revision),
    toState: "blocked",
    reasonCodes: ["test_lane_blocked"],
    actor: { kind: "service", reference: "test" },
  });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_lifecycle_not_request_ready",
  );
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});

test("requires an explicit safe public publication declaration before creating an ask", async () => {
  const setup = await fixture();
  const invalidDeclarations: unknown[] = [
    undefined,
    { ...publication, visibility: "private" },
    { ...publication, dataClassification: "internal" },
    { ...publication, confirmedNoSensitiveData: false },
    { ...publication, dataClassification: "redacted" },
  ];
  for (const invalidPublication of invalidDeclarations) {
    await assert.rejects(
      () =>
        requestAdaptiveHumanReview({
          principal: setup.principal,
          opportunityId: setup.decision.opportunityId,
          sourcePayload: SOURCE_PAYLOAD,
          suggestionPayload: SUGGESTION_PAYLOAD,
          publication: invalidPublication as never,
          appOrigin: APP_ORIGIN,
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError &&
        error.code === "invalid_review_publication" &&
        error.message.includes("confirmedNoSensitiveData true"),
    );
  }
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});

test("fails private and hybrid policies before creating unreachable asks", async () => {
  for (const audience of ["private_invited", "hybrid"] as const) {
    const setup = await fixture({ audience });
    await assert.rejects(
      () =>
        requestAdaptiveHumanReview({
          principal: setup.principal,
          opportunityId: setup.decision.opportunityId,
          sourcePayload: SOURCE_PAYLOAD,
          suggestionPayload: SUGGESTION_PAYLOAD,
          publication,
          appOrigin: APP_ORIGIN,
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "human_review_lifecycle_not_request_ready",
    );
  }
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});

test("preserves the hosted RateLoop-network feature gate", async () => {
  const setup = await fixture();
  process.env.TOKENLESS_NETWORK_PANELS_ENABLED = "false";
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "network_panels_disabled" &&
      error.message.includes("TOKENLESS_NETWORK_PANELS_ENABLED"),
  );
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});

test("verifies both exact human-visible payload commitments before spending funds", async () => {
  const setup = await fixture();
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: `${SOURCE_PAYLOAD} Changed.`,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "source_payload_commitment_mismatch",
  );
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: `${SUGGESTION_PAYLOAD} Changed.`,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "suggestion_payload_commitment_mismatch",
  );
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});

test("fails closed on ambiguous admission policies and insufficient prepaid funds", async () => {
  const ambiguous = await fixture({ admissionHashes: [`0x${"cd".repeat(32)}`] });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: ambiguous.principal,
        opportunityId: ambiguous.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_admission_policy_ambiguous",
  );

  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const unfunded = await fixture({ fund: false });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: unfunded.principal,
        opportunityId: unfunded.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_prepaid_balance",
  );
  const opportunity = await dbClient.execute({
    sql: "SELECT operation_key, status FROM tokenless_agent_review_opportunities WHERE opportunity_id = ?",
    args: [unfunded.decision.opportunityId],
  });
  assert.deepEqual(opportunity.rows[0], { operation_key: null, status: "decided" });
});

test("rejects the actual RateLoop fee when it exceeds the owner grant cap", async () => {
  const setup = await fixture({ maxFeeBps: 500 });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        publication,
        appOrigin: APP_ORIGIN,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError &&
      error.code === "approval_required" &&
      error.message.includes("panel size or fee"),
  );
  const mutations = await dbClient.execute(
    "SELECT (SELECT COUNT(*) FROM tokenless_agent_asks) AS asks, (SELECT COUNT(*) FROM tokenless_prepaid_reservations) AS reservations",
  );
  assert.equal(Number(mutations.rows[0]?.asks), 0);
  assert.equal(Number(mutations.rows[0]?.reservations), 0);
});
