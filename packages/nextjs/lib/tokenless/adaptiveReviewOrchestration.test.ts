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
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  authenticateProductPrincipal,
  createAgentPublishingPolicy,
  createWorkspace,
  createWorkspaceApiKey,
  recordPrepaidLedgerEntry,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const ADMISSION_HASH = `0x${"ab".repeat(32)}` as const;
const APP_ORIGIN = "https://rateloop-tokenless.example";
const SOURCE_PAYLOAD = "Customer requested a refund for a duplicated charge.";
const SUGGESTION_PAYLOAD = "Approve the refund after verifying the duplicate transaction IDs.";
const originalSandboxMode = process.env.TOKENLESS_SANDBOX_MODE;
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_SANDBOX_MODE = "false";
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "77".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "orchestration-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSandboxMode === undefined) delete process.env.TOKENLESS_SANDBOX_MODE;
  else process.env.TOKENLESS_SANDBOX_MODE = originalSandboxMode;
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
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

async function fixture(input: { fund?: boolean; admissionHashes?: string[] } = {}) {
  const { workspaceId } = await createWorkspace({ name: "Adaptive orchestration", ownerAddress: OWNER });
  await activateEarlyAccess(workspaceId);
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
      name: "Adaptive private review",
      allowedPaymentModes: ["prepaid"],
      maxPanelAtomic: "100000000",
      maxDailyAtomic: "500000000",
      maxMonthlyAtomic: "5000000000",
      maxPanelSize: 20,
      maxBountyAtomic: "50000000",
      maxFeeBps: 1_000,
      maxAttemptReserveAtomic: "20000000",
      allowedReviewerSources: ["customer_invited"],
      allowedAdmissionPolicyHashes: input.admissionHashes ?? [ADMISSION_HASH],
      allowedDataClassifications: ["internal"],
    },
  });
  const reviewPolicyId = "arp_refund_v1";
  const audiencePolicy = { reviewerSource: "private_invited" };
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
    },
  });
  assert.equal(decision.required, true);
  if (input.fund !== false) {
    await recordPrepaidLedgerEntry({ workspaceId, amountAtomic: "100000000", source: "test-funding" });
  }
  return { workspaceId, publishingPolicy, principal, decision };
}

const economics = {
  requestedPanelSize: 5,
  bountyAtomic: "25000000",
  attemptReserveAtomic: "5000000",
  feeBps: 750,
};

test("creates one prepaid canonical ask and idempotently binds the required opportunity", async () => {
  const setup = await fixture();
  const first = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    economics,
    appOrigin: APP_ORIGIN,
  });
  const replay = await requestAdaptiveHumanReview({
    principal: setup.principal,
    opportunityId: setup.decision.opportunityId,
    sourcePayload: SOURCE_PAYLOAD,
    suggestionPayload: SUGGESTION_PAYLOAD,
    economics,
    appOrigin: APP_ORIGIN,
  });

  assert.equal(replay.ask.operationKey, first.ask.operationKey);
  assert.equal(first.ask.status, "awaiting_payment");
  const opportunity = await dbClient.execute({
    sql: "SELECT operation_key, status FROM tokenless_agent_review_opportunities WHERE opportunity_id = ?",
    args: [setup.decision.opportunityId],
  });
  assert.deepEqual(opportunity.rows[0], { operation_key: first.ask.operationKey, status: "review_requested" });
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
  assert.deepEqual(quoteRequest.audience, { admissionPolicyHash: ADMISSION_HASH, source: "customer_invited" });
  assert.deepEqual(quoteRequest.question, {
    kind: "binary",
    negativeLabel: "No",
    positiveLabel: "Yes",
    prompt: __adaptiveReviewOrchestrationTestUtils.canonicalQuestion(SOURCE_PAYLOAD, SUGGESTION_PAYLOAD).prompt,
    rationale: { mode: "optional" },
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

test("verifies both exact human-visible payload commitments before spending funds", async () => {
  const setup = await fixture();
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: setup.principal,
        opportunityId: setup.decision.opportunityId,
        sourcePayload: `${SOURCE_PAYLOAD} Changed.`,
        suggestionPayload: SUGGESTION_PAYLOAD,
        economics,
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
        economics,
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
  const ambiguous = await fixture({ admissionHashes: [ADMISSION_HASH, `0x${"cd".repeat(32)}`] });
  await assert.rejects(
    () =>
      requestAdaptiveHumanReview({
        principal: ambiguous.principal,
        opportunityId: ambiguous.decision.opportunityId,
        sourcePayload: SOURCE_PAYLOAD,
        suggestionPayload: SUGGESTION_PAYLOAD,
        economics,
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
        economics,
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
