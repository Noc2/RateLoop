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
import { parseAgentExecutionEvidence } from "~~/lib/tokenless/agentExecutionEvidence";
import {
  LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  agentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
  projectAgentExecutionProfile,
} from "~~/lib/tokenless/agentExecutionProvenance";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

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
  const audiencePolicy = { reviewerSource: "public_network" };
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
  const humanReview = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: owner.toLowerCase(),
  });
  const key = await createWorkspaceApiKey({
    workspaceId,
    name: "Adaptive evaluator",
    scopes: ["evaluation:read", "review:decide"],
  });
  const principal = await authenticateAdaptiveReviewPrincipal(`Bearer ${key.token}`, "review:decide");
  return { workspaceId, agent, audiencePolicyHash, policyId, humanReview, key, principal };
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
    execution: {
      externalExecutionId: `execution-${externalOpportunityId}`,
      status: "completed" as const,
      primarySpanId: "generation-primary",
      generationSpans: [
        {
          spanId: "generation-primary",
          role: "primary" as const,
          provider: "OpenAI",
          requestedModel: "gpt-5.6-sol",
          resolvedModel: "gpt-5.6-sol-2026-07-01",
          reasoningEffort: "medium",
          serviceTier: "standard",
        },
      ],
    },
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
  assert.deepEqual(first.reasonCodes, ["calibrating", "safety_gates_unavailable"]);
  assert.equal(first.policyFrozen, true);
  assert.equal(first.sourceEvidenceHash, request.sourceEvidence.hash);
  assert.match(first.executionId, /^aex_/);
  assert.equal(first.executionManifestCommitment, replay.executionManifestCommitment);
  assert.equal(first.executionEvidence.executionId, first.executionId);
  assert.deepEqual(first.executionEvidence.opportunityBinding, {
    opportunityId: first.opportunityId,
    metadataCommitment: first.metadataCommitment,
  });
  assert.equal(first.executionEvidence.manifestCommitment, first.executionManifestCommitment);
  assert.equal(first.executionEvidence.executionProfileHash, first.executionProfileHash);
  assert.deepEqual(first.executionEvidence.source, {
    kind: "host_reported",
    independentlyVerified: false,
    attestation: null,
  });
  assert.deepEqual(parseAgentExecutionEvidence(first.executionEvidence), first.executionEvidence);
  assert.equal(first.executionProfile?.primary.resolvedModel, "gpt-5.6-sol-2026-07-01");
  assert.equal(first.executionProfile?.primary.reasoningEffort, "medium");
  assert.equal("sourceEvidenceReference" in first, false);
  assert.equal(first.lifecycle.state, "approval_required");
  assert.equal(first.lifecycle.revision, 2);
  assert.equal(first.lifecycle.terminal, false);
  assert.ok(first.lifecycle.reasonCodes.includes("check_only_owner_action_required"));

  const rows = await dbClient.execute(
    `SELECT suggestion_commitment, source_evidence_reference, source_evidence_hash,
            human_review_binding_id, human_review_binding_version,
            request_profile_id, request_profile_version, request_profile_hash
     FROM tokenless_agent_review_opportunities`,
  );
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0]?.suggestion_commitment, request.suggestionCommitment);
  assert.equal(rows.rows[0]?.source_evidence_reference, request.sourceEvidence.reference);
  assert.equal(rows.rows[0]?.source_evidence_hash, request.sourceEvidence.hash);
  assert.equal(rows.rows[0]?.human_review_binding_id, setup.humanReview.bindingId);
  assert.equal(rows.rows[0]?.human_review_binding_version, setup.humanReview.bindingVersion);
  assert.equal(rows.rows[0]?.request_profile_id, setup.humanReview.profileId);
  assert.equal(rows.rows[0]?.request_profile_version, setup.humanReview.profileVersion);
  assert.equal(rows.rows[0]?.request_profile_hash, setup.humanReview.profileHash);

  const lifecycle = await dbClient.execute({
    sql: `SELECT l.state,l.state_revision,l.terminal_at,o.status
          FROM tokenless_agent_review_opportunity_lifecycles l
          JOIN tokenless_agent_review_opportunities o
            ON o.workspace_id=l.workspace_id AND o.opportunity_id=l.opportunity_id
          WHERE l.workspace_id=? AND l.opportunity_id=?`,
    args: [setup.workspaceId, first.opportunityId],
  });
  assert.deepEqual(lifecycle.rows[0], {
    state: "approval_required",
    state_revision: 2,
    terminal_at: null,
    status: "decided",
  });
  const transitions = await dbClient.execute({
    sql: `SELECT actor_kind,actor_reference,from_state,to_state,from_revision,to_revision
          FROM tokenless_agent_review_opportunity_transition_events
          WHERE workspace_id=? AND opportunity_id=?`,
    args: [setup.workspaceId, first.opportunityId],
  });
  assert.equal(transitions.rowCount, 1);
  assert.deepEqual(transitions.rows[0], {
    actor_kind: "service",
    actor_reference: setup.principal.apiKeyId,
    from_state: "evaluating",
    to_state: "approval_required",
    from_revision: 1,
    to_revision: 2,
  });

  const scopes = await dbClient.execute({
    sql: `SELECT human_review_binding_id, human_review_binding_version,
                 request_profile_id, request_profile_version, request_profile_hash
          FROM tokenless_agent_evaluation_scopes
          WHERE workspace_id = ? AND scope_id = ?`,
    args: [setup.workspaceId, first.scopeId],
  });
  assert.equal(scopes.rows[0]?.human_review_binding_id, setup.humanReview.bindingId);
  assert.equal(scopes.rows[0]?.human_review_binding_version, setup.humanReview.bindingVersion);
  assert.equal(scopes.rows[0]?.request_profile_id, setup.humanReview.profileId);
  assert.equal(scopes.rows[0]?.request_profile_version, setup.humanReview.profileVersion);
  assert.equal(scopes.rows[0]?.request_profile_hash, setup.humanReview.profileHash);

  const executions = await dbClient.execute({
    sql: `SELECT e.execution_id, e.metadata_source, e.execution_profile_hash, e.model_call_count,
                 s.provider, s.requested_model, s.resolved_model, s.reasoning_effort, s.service_tier
          FROM tokenless_agent_executions e
          JOIN tokenless_agent_generation_spans s ON s.execution_id = e.execution_id`,
  });
  assert.equal(executions.rowCount, 1);
  assert.equal(executions.rows[0]?.execution_id, first.executionId);
  assert.equal(executions.rows[0]?.metadata_source, "host_reported");
  assert.equal(executions.rows[0]?.execution_profile_hash, first.executionProfileHash);
  assert.equal(executions.rows[0]?.model_call_count, 1);
  assert.equal(executions.rows[0]?.requested_model, "gpt-5.6-sol");
  assert.equal(executions.rows[0]?.resolved_model, "gpt-5.6-sol-2026-07-01");
  assert.equal(executions.rows[0]?.reasoning_effort, "medium");
  assert.equal(executions.rows[0]?.service_tier, "standard");

  const state = await getAdaptiveAssuranceState({ principal: setup.principal, scopeId: first.scopeId });
  assert.equal(state.completedComparableCases, 0);
  assert.equal(state.humanAgreementBps, null);
  assert.equal(state.nextReassessmentAfter, 30);
});

test("replays historical v1 execution and scope profiles without rewriting them", async () => {
  const setup = await fixture();
  const request = opportunity(setup, "historical-profile-v1");
  const first = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request });
  const normalized = normalizeAgentExecutionProvenance(request.execution);
  const legacyProfile = projectAgentExecutionProfile(normalized, LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION);
  const legacyHash = agentExecutionProfileHash(legacyProfile);

  await dbClient.execute({
    sql: `UPDATE tokenless_agent_executions
          SET execution_profile_hash=?, execution_profile_json=?
          WHERE execution_id=?`,
    args: [legacyHash, JSON.stringify(legacyProfile), first.executionId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_evaluation_scopes
          SET execution_profile_hash=?, execution_profile_json=?
          WHERE workspace_id=? AND scope_id=?`,
    args: [legacyHash, JSON.stringify(legacyProfile), setup.workspaceId, first.scopeId],
  });

  const replay = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request });
  assert.equal(replay.scopeId, first.scopeId);
  assert.equal(replay.executionProfileHash, legacyHash);
  assert.equal(replay.executionProfile?.schemaVersion, "rateloop.execution-profile.v1");
  assert.equal(replay.executionEvidence.executionProfileHash, legacyHash);
  assert.equal(replay.executionEvidence.executionProfile.schemaVersion, "rateloop.execution-profile.v1");
  assert.deepEqual(parseAgentExecutionEvidence(replay.executionEvidence), replay.executionEvidence);

  const persisted = await dbClient.execute({
    sql: `SELECT execution_profile_hash, execution_profile_json
          FROM tokenless_agent_evaluation_scopes
          WHERE workspace_id=? AND scope_id=?`,
    args: [setup.workspaceId, first.scopeId],
  });
  assert.equal(persisted.rows[0]?.execution_profile_hash, legacyHash);
  assert.equal(
    JSON.parse(String(persisted.rows[0]?.execution_profile_json)).schemaVersion,
    "rateloop.execution-profile.v1",
  );
});

test("comparable human-agreement evidence requires at least two respondents", () => {
  assert.equal(
    __adaptiveReviewServiceTestUtils.humanAgreementGatePassed(
      [{ responding_human_count: 1, human_human_agreement_bps: 10_000 }],
      7_000,
    ),
    false,
  );
  assert.equal(
    __adaptiveReviewServiceTestUtils.humanAgreementGatePassed(
      [{ responding_human_count: 2, human_human_agreement_bps: 7_000 }],
      7_000,
    ),
    true,
  );
  assert.equal(
    __adaptiveReviewServiceTestUtils.humanAgreementGatePassed(
      [{ responding_human_count: 2, human_human_agreement_bps: 6_999 }],
      7_000,
    ),
    false,
  );
});

test("partitions assurance scopes by model identity but not reasoning effort or service tier", async () => {
  const setup = await fixture();
  const sol = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "profile-sol-0001"),
  });
  const effortRequest = opportunity(setup, "profile-sol-effort-0001");
  effortRequest.execution.generationSpans[0] = {
    ...effortRequest.execution.generationSpans[0]!,
    reasoningEffort: "low",
    serviceTier: "priority",
  };
  const changedEffort = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request: effortRequest });

  assert.equal(changedEffort.executionProfileHash, sol.executionProfileHash);
  assert.equal(changedEffort.scopeId, sol.scopeId);
  assert.notEqual(changedEffort.executionManifestCommitment, sol.executionManifestCommitment);
  assert.equal(changedEffort.executionEvidence.manifest.generationSpans[0]?.reasoningEffort, "low");
  assert.equal(changedEffort.executionEvidence.manifest.generationSpans[0]?.serviceTier, "priority");

  const terraRequest = opportunity(setup, "profile-terra-0001");
  terraRequest.execution.generationSpans[0] = {
    ...terraRequest.execution.generationSpans[0]!,
    requestedModel: "gpt-5.6-terra",
    resolvedModel: "gpt-5.6-terra-2026-07-01",
    reasoningEffort: "low",
  };
  const terra = await evaluateAdaptiveReviewRequirement({ principal: setup.principal, request: terraRequest });

  assert.notEqual(terra.executionProfileHash, sol.executionProfileHash);
  assert.notEqual(terra.scopeId, sol.scopeId);
  assert.equal(terra.executionProfile?.primary.requestedModel, "gpt-5.6-terra");
  assert.equal(terra.stage, "calibrating");
  assert.equal(terra.reviewRateBps, 10_000);
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
  const unchanged = await dbClient.execute({
    sql: `SELECT l.state,l.state_revision,COUNT(e.event_id) AS event_count
          FROM tokenless_agent_review_opportunity_lifecycles l
          LEFT JOIN tokenless_agent_review_opportunity_transition_events e
            ON e.workspace_id=l.workspace_id AND e.opportunity_id=l.opportunity_id
          WHERE l.workspace_id=? AND l.opportunity_id=?
          GROUP BY l.state,l.state_revision`,
    args: [firstSetup.workspaceId, first.opportunityId],
  });
  assert.equal(unchanged.rows[0]?.state, "approval_required");
  assert.equal(unchanged.rows[0]?.state_revision, 2);
  assert.equal(Number(unchanged.rows[0]?.event_count), 1);
  await assert.rejects(
    () => getAdaptiveAssuranceState({ principal: secondSetup.principal, scopeId: first.scopeId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_state_not_found",
  );
});

test("legitimate negative selection terminates as skipped without an owner or lane prerequisite", async () => {
  const setup = await fixture();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies
          SET mode='rules',production_floor_bps=0,rules_json=?
          WHERE workspace_id=? AND policy_id=? AND version=1`,
    args: [
      JSON.stringify({ criticalRiskTiers: ["critical"], requiredRiskTiers: ["high"] }),
      setup.workspaceId,
      setup.policyId,
    ],
  });
  const decision = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "rules-legitimate-skip-0001"),
  });
  assert.equal(decision.decision, "skip");
  assert.equal(decision.lifecycle.state, "skipped");
  assert.equal(decision.lifecycle.terminal, true);
  const stored = await dbClient.execute({
    sql: `SELECT o.status,l.terminal_at
          FROM tokenless_agent_review_opportunities o
          JOIN tokenless_agent_review_opportunity_lifecycles l
            ON l.workspace_id=o.workspace_id AND l.opportunity_id=o.opportunity_id
          WHERE o.workspace_id=? AND o.opportunity_id=?`,
    args: [setup.workspaceId, decision.opportunityId],
  });
  assert.equal(stored.rows[0]?.status, "skipped");
  assert.ok(stored.rows[0]?.terminal_at);
});

test("automatic disposition requires both an exact owner grant and a ready public paid lane", () => {
  const binding = {
    authority: "ask_automatically",
    audience: "public_network",
    contentBoundary: "public_or_test",
    compensationMode: "usdc",
    publishingPolicyId: "agpol_exact",
  };
  const policy = { publishingPolicyId: "agpol_exact" };
  const disposition = (grantActive: boolean, networkPanelsEnabled: boolean, workspaceStopped = false) =>
    __adaptiveReviewServiceTestUtils.initialLifecycleDisposition({
      decision: "required",
      binding: binding as never,
      policy: policy as never,
      grant: { active: grantActive, reason: grantActive ? "active_exact_owner_grant" : "owner_grant_inactive" },
      networkPanelsEnabled,
      workspaceStopped,
    });
  assert.deepEqual(disposition(false, true), {
    state: "approval_required",
    reason: "owner_grant_inactive",
  });
  assert.deepEqual(disposition(true, false), {
    state: "blocked",
    reason: "public_paid_lane_unavailable",
  });
  assert.deepEqual(disposition(true, true), {
    state: "request_ready",
    reason: "public_paid_lane_ready",
  });
  // An engaged workspace stop fails everything closed before any lane logic.
  assert.deepEqual(disposition(true, true, true), {
    state: "blocked",
    reason: "workspace_stopped",
  });
  assert.deepEqual(
    __adaptiveReviewServiceTestUtils.initialLifecycleDisposition({
      decision: "required",
      binding: { ...binding, authority: "prepare_for_approval" } as never,
      policy: policy as never,
      grant: { active: true, reason: "active_exact_owner_grant" },
      networkPanelsEnabled: true,
      workspaceStopped: false,
    }),
    { state: "approval_required", reason: "owner_approval_required" },
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

test("fails closed for an incomplete request profile or a mismatched integration binding", async () => {
  const incomplete = await fixture(OWNER_A);
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_request_profiles
          SET configuration_status = 'action_required', response_window_seconds = NULL, panel_size = NULL,
              approved_by = NULL, approved_at = NULL
          WHERE workspace_id = ? AND profile_id = ? AND version = 1`,
    args: [incomplete.workspaceId, incomplete.humanReview.profileId],
  });
  await assert.rejects(
    () =>
      evaluateAdaptiveReviewRequirement({
        principal: incomplete.principal,
        request: opportunity(incomplete, "incomplete-profile-0001"),
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_configuration_action_required",
  );

  const mismatched = await fixture(OWNER_B);
  await assert.rejects(
    () =>
      evaluateAdaptiveReviewRequirement({
        principal: mismatched.principal,
        integrationId: "int_not_bound_to_this_configuration",
        request: opportunity(mismatched, "integration-mismatch-0001"),
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "human_review_integration_binding_mismatch",
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

test("fixed review uses its frozen rate while safety overrides record full selection probability", async () => {
  const setup = await fixture();
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies
          SET mode = 'fixed', production_floor_bps = 0, fixed_rate_bps = 5000,
              rules_json = ?
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

  const sampled = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "fixed-deterministic-01"),
  });
  const replay = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "fixed-deterministic-01"),
  });
  assert.deepEqual(replay, sampled);
  assert.equal(sampled.required, sampled.sampleBucket < 5_000);
  assert.equal(sampled.reviewRateBps, 5_000);
  assert.equal(sampled.selectionProbabilityBps, 5_000);
  assert.deepEqual(sampled.reasonCodes, [sampled.required ? "sampled" : "not_sampled"]);

  const forced = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: {
      ...opportunity(setup, "fixed-safety-override-01"),
      riskTier: "critical",
      declaredConfidenceBps: 7_999,
      metadataComplete: false,
    },
  });
  assert.equal(forced.required, true);
  assert.equal(forced.reviewRateBps, 5_000);
  assert.equal(forced.selectionProbabilityBps, 10_000);
  assert.deepEqual(forced.reasonCodes, ["critical_risk", "missing_metadata", "low_confidence"]);

  const persisted = await dbClient.execute({
    sql: `SELECT review_rate_bps, selection_probability_bps
          FROM tokenless_agent_review_opportunities
          WHERE workspace_id = ? AND opportunity_id = ?`,
    args: [setup.workspaceId, forced.opportunityId],
  });
  assert.equal(persisted.rows[0]?.review_rate_bps, 5_000);
  assert.equal(persisted.rows[0]?.selection_probability_bps, 10_000);
});

test("fixed and rules policies never advance adaptive stages", async () => {
  for (const [mode, owner] of [
    ["fixed", OWNER_A],
    ["rules", OWNER_B],
  ] as const) {
    const setup = await fixture(owner);
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_review_policies
            SET mode = ?, production_floor_bps = 0, fixed_rate_bps = ?
            WHERE workspace_id = ? AND policy_id = ? AND version = 1`,
      args: [mode, mode === "fixed" ? 5_000 : null, setup.workspaceId, setup.policyId],
    });

    let last = await evaluateAdaptiveReviewRequirement({
      principal: setup.principal,
      request: opportunity(setup, `${mode}-stable-0000`),
    });
    for (let index = 0; index < 30; index += 1) {
      if (index > 0) {
        last = await evaluateAdaptiveReviewRequirement({
          principal: setup.principal,
          request: opportunity(setup, `${mode}-stable-${String(index).padStart(4, "0")}`),
        });
      }
      const finalizedAt = new Date(Date.now() + index);
      await dbClient.execute({
        sql: `INSERT INTO tokenless_agent_evaluation_observations
              (observation_id, workspace_id, scope_id, opportunity_id, evidence_reference, source_payload_hash,
               agent_outcome_commitment, human_outcome_commitment, agreement, comparable,
               responding_human_count, finalized_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agree', true, 1, ?, ?)`,
        args: [
          `obs_${mode}_${index}_${setup.workspaceId}`,
          setup.workspaceId,
          last.scopeId,
          last.opportunityId,
          `evidence/${mode}/${index}`,
          __adaptiveReviewServiceTestUtils.sha256({ mode, source: index }),
          last.suggestionCommitment,
          __adaptiveReviewServiceTestUtils.sha256({ mode, human: "agree", index }),
          finalizedAt,
          finalizedAt,
        ],
      });
    }

    const afterEvidence = await evaluateAdaptiveReviewRequirement({
      principal: setup.principal,
      request: opportunity(setup, `${mode}-after-stable-window`),
    });
    assert.equal(afterEvidence.stage, "calibrating");
    assert.equal(afterEvidence.nextReassessmentAfter, 0);
    assert.equal(afterEvidence.reviewRateBps, mode === "fixed" ? 5_000 : 0);

    const events = await dbClient.execute({
      sql: `SELECT event_type FROM tokenless_agent_review_policy_events
            WHERE workspace_id = ? AND scope_id = ? AND event_type IN ('stage_changed', 'reset')`,
      args: [setup.workspaceId, afterEvidence.scopeId],
    });
    assert.equal(events.rowCount, 0);
  }
});

test("adaptive scopes stay at full review and reduced legacy scopes reset while safety gates are unavailable", async () => {
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
             responding_human_count, human_human_agreement_bps, finalized_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agree', true, 2, 10000, ?, ?)`,
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

  const pinned = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "post-calibration-0001"),
  });
  assert.equal(pinned.stage, "calibrating");
  assert.equal(pinned.reviewRateBps, 10_000);
  assert.equal(pinned.selectionProbabilityBps, 10_000);
  assert.deepEqual(pinned.reasonCodes, ["calibrating", "safety_gates_unavailable"]);
  assert.equal(pinned.completedComparableCases, 30);
  assert.equal(pinned.humanAgreementBps, 10_000);
  assert.ok((pinned.humanAgreementLower95Bps ?? 0) >= 7_000);

  await dbClient.execute({
    sql: `UPDATE tokenless_agent_evaluation_scopes
          SET stage = 'high_coverage', stable_cases_since_stage = 0, stage_entered_at = ?
          WHERE workspace_id = ? AND scope_id = ?`,
    args: [new Date(), setup.workspaceId, pinned.scopeId],
  });

  const reset = await evaluateAdaptiveReviewRequirement({
    principal: setup.principal,
    request: opportunity(setup, "legacy-reduced-scope-0001"),
  });
  assert.equal(reset.stage, "calibrating");
  assert.equal(reset.reviewRateBps, 10_000);
  assert.equal(reset.selectionProbabilityBps, 10_000);
  assert.deepEqual(reset.reasonCodes, ["calibrating", "safety_gates_unavailable"]);

  const persisted = await dbClient.execute({
    sql: `SELECT review_rate_bps, selection_probability_bps
          FROM tokenless_agent_review_opportunities
          WHERE workspace_id = ? AND opportunity_id = ?`,
    args: [setup.workspaceId, reset.opportunityId],
  });
  assert.equal(persisted.rows[0]?.review_rate_bps, 10_000);
  assert.equal(persisted.rows[0]?.selection_probability_bps, 10_000);

  const resetEvents = await dbClient.execute({
    sql: `SELECT event_type, from_stage, to_stage, reason_codes_json
          FROM tokenless_agent_review_policy_events
          WHERE workspace_id = ? AND scope_id = ? AND event_type = 'reset'`,
    args: [setup.workspaceId, pinned.scopeId],
  });
  assert.equal(resetEvents.rowCount, 1);
  assert.equal(resetEvents.rows[0]?.from_stage, "high_coverage");
  assert.equal(resetEvents.rows[0]?.to_stage, "calibrating");
  assert.deepEqual(JSON.parse(String(resetEvents.rows[0]?.reason_codes_json)), ["safety_gates_unavailable"]);
});
