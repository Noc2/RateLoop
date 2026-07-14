import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  __adaptiveReviewServiceTestUtils,
  authenticateAdaptiveReviewPrincipal,
  evaluateAdaptiveReviewRequirement,
  getAdaptiveAssuranceState,
} from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER_A = "0x1111111111111111111111111111111111111111";
const OWNER_B = "0x2222222222222222222222222222222222222222";
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "77".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "sampler-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

async function fixture(owner = OWNER_A) {
  const { workspaceId } = await createWorkspace({ name: `Workspace ${owner.slice(-4)}`, ownerAddress: owner });
  const agent = await createWorkspaceAgent({
    accountAddress: owner,
    workspaceId,
    externalId: `support-agent-${owner.slice(-4)}`,
    version: {
      displayName: "Support Agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07-14",
      environment: "production",
    },
  });
  const audiencePolicy = { source: "customer_invited", group: "support-emea", classification: "internal" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audiencePolicy);
  const policyId = `arp_support_${owner.slice(-4)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, ?, ?, ?, ?, ?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ criticalRiskTiers: ["critical"], requiredRiskTiers: ["high"] }),
      JSON.stringify(audiencePolicy),
      owner.toLowerCase(),
      owner.toLowerCase(),
      new Date(),
    ],
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Adaptive evaluator",
    scopes: ["evaluation:read", "review:decide"],
  });
  const principal = await authenticateAdaptiveReviewPrincipal(`Bearer ${key.token}`, "review:decide");
  return { workspaceId, agent, audiencePolicyHash, policyId, key, principal };
}

function opportunity(input: Awaited<ReturnType<typeof fixture>>, externalOpportunityId = "ticket-00000001") {
  return {
    externalOpportunityId,
    agentId: input.agent.agentId,
    agentVersionId: input.agent.currentVersion.versionId,
    policyId: input.policyId,
    policyVersion: 1,
    workflowKey: "support-reply",
    riskTier: "low",
    audiencePolicyHash: input.audiencePolicyHash,
    suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ action: "reply", option: "candidate" }),
    sourceEvidence: {
      reference: "case/ticket-00000001/revision-1",
      hash: __adaptiveReviewServiceTestUtils.sha256({ caseId: "ticket-00000001", revision: 1 }),
    },
    declaredConfidenceBps: 8700,
    criticalRisk: false,
    metadataComplete: true,
  };
}

test("persists deterministic calibration decisions and returns frozen idempotent replays", async () => {
  const setup = await fixture();
  const request = opportunity(setup);
  const first = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request });
  const replay = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request });

  assert.deepEqual(replay, first);
  assert.equal(first.decision, "required");
  assert.equal(first.stage, "calibrating");
  assert.equal(first.reviewRateBps, 10_000);
  assert.equal(first.selectionProbabilityBps, 10_000);
  assert.deepEqual(first.reasonCodes, ["calibrating"]);
  assert.equal(first.policyFrozen, true);
  assert.equal(first.sourceEvidenceHash, request.sourceEvidence.hash);
  assert.equal("sourceEvidenceReference" in first, false);

  const rows = await dbClient.execute(
    "SELECT suggestion_commitment, source_evidence_reference, source_evidence_hash FROM tokenless_agent_review_opportunities",
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0]?.suggestion_commitment, request.suggestionCommitment);
  assert.equal(rows.rows[0]?.source_evidence_reference, request.sourceEvidence.reference);
  assert.equal(rows.rows[0]?.source_evidence_hash, request.sourceEvidence.hash);

  const state = await getAdaptiveAssuranceState({ principal: setup.principal, scopeId: first.scopeId });
  assert.equal(state.completedComparableCases, 0);
  assert.equal(state.humanAgreementBps, null);
  assert.equal(state.nextReassessmentAfter, 30);
});

test("rejects idempotency conflicts and cross-workspace state reads without leaking existence", async () => {
  const firstSetup = await fixture(OWNER_A);
  const secondSetup = await fixture(OWNER_B);
  const first = await evaluateAdaptiveReviewRequirement({
    principal: firstSetup.principal,
    request: opportunity(firstSetup),
  });

  await assert.rejects(
    () =>
      evaluateAdaptiveReviewRequirement({
        principal: firstSetup.principal,
        request: {
          ...opportunity(firstSetup),
          suggestionCommitment: __adaptiveReviewServiceTestUtils.sha256({ changed: true }),
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_opportunity_conflict",
  );
  await assert.rejects(
    () => getAdaptiveAssuranceState({ principal: secondSetup.principal, scopeId: first.scopeId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_state_not_found",
  );
});

test("enforces dedicated scopes and fails closed when the sampler secret is absent", async () => {
  const setup = await fixture();
  const narrow = await createWorkspaceApiKey({
    workspaceId: setup.workspaceId,
    name: "Results only",
    scopes: ["result:read"],
  });
  await assert.rejects(
    () => authenticateAdaptiveReviewPrincipal(`Bearer ${narrow.token}`, "review:decide"),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_scope",
  );

  delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  await assert.rejects(
    () => evaluateAdaptiveReviewRequirement({ principal: setup.principal, request: opportunity(setup) }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "adaptive_review_unavailable",
  );
});

test("critical risk is forced even outside an adaptive sample", async () => {
  const setup = await fixture();
  const decision = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: { ...opportunity(setup, "ticket-critical-01"), riskTier: "critical" },
  });
  assert.equal(decision.required, true);
  assert.ok(decision.reasonCodes.includes("critical_risk"));
});

test("adaptive review forces suggestions below the configured confidence threshold", async () => {
  const setup = await fixture();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies SET rules_json = ?
          WHERE workspace_id = ? AND policy_id = ? AND version = 1`,
    args: [
      JSON.stringify({
        criticalRiskTiers: ["critical"],
        requiredRiskTiers: ["high"],
        minimumConfidenceBps: 8_000,
      }),
      setup.workspaceId,
      setup.policyId,
    ],
  });

  const decision = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: { ...opportunity(setup, "ticket-low-confidence-01"), declaredConfidenceBps: 7_999 },
  });

  assert.equal(decision.required, true);
  assert.equal(decision.selectionProbabilityBps, 10_000);
  assert.ok(decision.reasonCodes.includes("low_confidence"));
});

test("source-derived observations advance the persisted scope only after two stable windows", async () => {
  const setup = await fixture();
  for (let index = 0; index < 30; index += 1) {
    const decision = await evaluateAdaptiveReviewRequirement({
      principal: setup.principal,
      request: opportunity(setup, `calibration-${String(index).padStart(4, "0")}`),
    });
    const finalizedAt = new Date(Date.now() + index);
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_evaluation_observations
            (observation_id, workspace_id, scope_id, opportunity_id, evidence_reference, source_payload_hash,
             agent_outcome_commitment, human_outcome_commitment, agreement, comparable,
             responding_human_count, finalized_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agree', true, 1, ?, ?)`,
      args: [
        `obs_calibration_${index}`,
        setup.workspaceId,
        decision.scopeId,
        decision.opportunityId,
        `evidence/calibration/${index}`,
        __adaptiveReviewServiceTestUtils.sha256({ source: index }),
        decision.suggestionCommitment,
        __adaptiveReviewServiceTestUtils.sha256({ human: "agree", index }),
        finalizedAt,
        finalizedAt,
      ],
    });
  }

  const steppedDown = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "post-calibration-0001"),
  });
  assert.equal(steppedDown.stage, "high_coverage");
  assert.equal(steppedDown.reviewRateBps, 5_000);
  assert.equal(steppedDown.completedComparableCases, 30);
  assert.equal(steppedDown.humanAgreementBps, 10_000);
  assert.ok((steppedDown.humanAgreementLower95Bps ?? 0) >= 7_000);
  assert.equal(steppedDown.nextReassessmentAfter, 50);

  const events = await dbClient.execute({
    sql: `SELECT event_type, from_stage, to_stage, reason_codes_json
          FROM tokenless_agent_review_policy_events
          WHERE workspace_id = ? AND scope_id = ? AND event_type = 'stage_changed'`,
    args: [setup.workspaceId, steppedDown.scopeId],
  });
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0]?.from_stage, "calibrating");
  assert.equal(events.rows[0]?.to_stage, "high_coverage");
  assert.deepEqual(JSON.parse(String(events.rows[0]?.reason_codes_json)), ["two_stable_windows"]);
});
