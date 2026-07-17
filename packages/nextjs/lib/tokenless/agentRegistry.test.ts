import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createWorkspaceAgent,
  createWorkspaceAgentVersion,
  deactivateWorkspaceAgent,
  listWorkspaceAgents,
  updateWorkspaceAgentCapabilityStatement,
} from "~~/lib/tokenless/agentRegistry";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const MEMBER = "0x2222222222222222222222222222222222222222";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const ADMIN = "0x4444444444444444444444444444444444444444";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function version(modelVersion: string) {
  return {
    displayName: "Support quality agent",
    description: "Reviews support responses before customer delivery.",
    provider: "OpenAI",
    model: "gpt-5",
    modelVersion,
    deploymentName: "support-prod",
    environment: "production" as const,
  };
}

const HASH = (character: string) => `sha256:${character.repeat(64)}`;

async function insertReviewProjectionPolicy(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  profileId: string;
  profileHash: string;
  now: Date;
}) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, fixed_rate_bps, maximum_unreviewed_gap,
           rules_json, audience_policy_json, publishing_policy_id, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 8750, 1000, NULL, 9, ?, ?, NULL, ?, ?, ?)`,
    args: [
      input.policyId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      JSON.stringify({
        enforcementMode: "advisory",
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7000,
        maximumLatencyMs: 120000,
      }),
      JSON.stringify({ reviewerSource: "public_network" }),
      OWNER,
      OWNER,
      input.now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_request_profiles
          (profile_id, version, workspace_id, agent_id, agent_version_id, criterion, positive_label,
           negative_label, rationale_mode, audience, content_boundary, private_sensitivity,
           private_group_id, private_group_policy_version, private_group_policy_hash,
           response_window_seconds, panel_size, compensation_mode, bounty_per_seat_atomic,
           configuration_status, profile_hash, created_by, created_at, approved_by, approved_at)
          VALUES (?, 1, ?, ?, ?, 'Check whether this response is correct', 'Approve', 'Reject', 'required',
                  'public_network', 'public_or_test', NULL, NULL, NULL, NULL, 3600, 3, 'usdc',
                  '2500000', 'ready', ?, ?, ?, ?, ?)`,
    args: [
      input.profileId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.profileHash,
      OWNER,
      input.now,
      OWNER,
      input.now,
    ],
  });
}

async function insertReviewProjectionScope(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  bindingId: string;
  bindingVersion: number;
  profileId: string;
  profileHash: string;
  scopeId: string;
  hashCharacter: string;
  now: Date;
}) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version,
           workflow_key, risk_tier, audience_policy_hash, partition_commitment,
           execution_profile_hash, execution_profile_json, human_review_binding_id, human_review_binding_version,
           request_profile_id, request_profile_version, request_profile_hash, stage, completed_comparable_cases,
           stable_cases_since_stage, unreviewed_since_last_sample, stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, 'normal', ?, ?, ?, '{}', ?, ?, ?, 1, ?,
                  'calibrating', 0, 0, 0, ?, ?)`,
    args: [
      input.scopeId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.policyId,
      `workflow-${input.hashCharacter}`,
      HASH(input.hashCharacter),
      HASH(input.hashCharacter),
      HASH(input.hashCharacter),
      input.bindingId,
      input.bindingVersion,
      input.profileId,
      input.profileHash,
      input.now,
      input.now,
    ],
  });
}

async function insertReviewProjectionOpportunity(input: {
  workspaceId: string;
  agentId: string;
  agentVersionId: string;
  policyId: string;
  bindingId: string;
  bindingVersion: number;
  profileId: string;
  profileHash: string;
  scopeId: string;
  opportunityId: string;
  state: "approval_required" | "request_ready" | "pending" | "blocked" | "skipped" | "completed";
  createdAt: Date;
  terminalAt?: Date | null;
}) {
  const terminalAt = input.terminalAt ?? null;
  const legacyStatus =
    input.state === "pending"
      ? "review_requested"
      : input.state === "completed"
        ? "completed"
        : input.state === "skipped"
          ? "skipped"
          : "decided";
  const decision = input.state === "skipped" ? "skip" : "required";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id, workspace_id, agent_id, agent_version_id, scope_id, policy_id, policy_version,
           external_opportunity_id, suggestion_commitment, declared_confidence_bps, metadata_commitment,
           metadata_complete, critical_risk, decision, review_rate_bps, selection_probability_bps,
           sample_bucket, sampler_key_version, sampler_commitment, reason_codes_json, status,
           source_evidence_reference, source_evidence_hash, human_review_binding_id,
           human_review_binding_version, request_profile_id, request_profile_version,
           request_profile_hash, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 9000, ?, true, false, ?, 10000, 10000, 1,
                  'projection-test-v1', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    args: [
      input.opportunityId,
      input.workspaceId,
      input.agentId,
      input.agentVersionId,
      input.scopeId,
      input.policyId,
      `external-${input.opportunityId}`,
      HASH("a"),
      HASH("b"),
      decision,
      HASH("c"),
      JSON.stringify([`${input.state}_reason`]),
      legacyStatus,
      `source/${input.opportunityId}`,
      HASH("d"),
      input.bindingId,
      input.bindingVersion,
      input.profileId,
      input.profileHash,
      input.createdAt,
      terminalAt ?? input.createdAt,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
          (workspace_id, opportunity_id, state, state_revision, reason_codes_json,
           state_entered_at, terminal_at, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    args: [
      input.workspaceId,
      input.opportunityId,
      input.state,
      JSON.stringify([`${input.state}_reason`]),
      terminalAt ?? input.createdAt,
      terminalAt,
      input.createdAt,
      terminalAt ?? input.createdAt,
    ],
  });
}

test("agent updates append immutable declared-model versions and preserve earlier snapshots", async () => {
  const { workspaceId } = await createWorkspace({ name: "Agent registry", ownerAddress: OWNER });
  const created = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "support-agent-prod",
    version: version("2026-07-01"),
  });
  assert.equal(created.currentVersion.versionNumber, 1);
  assert.equal(created.currentVersion.declaredModelVersion, "2026-07-01");
  assert.match(created.currentVersion.configurationCommitment, /^[a-f0-9]{64}$/);

  const updated = await createWorkspaceAgentVersion({
    accountAddress: OWNER,
    workspaceId,
    agentId: created.agentId,
    version: { ...version("2026-07-14"), displayName: "Support quality agent v2" },
  });
  assert.equal(updated.currentVersion.versionNumber, 2);
  assert.equal(updated.currentVersion.displayName, "Support quality agent v2");
  assert.deepEqual(
    updated.versions.map(item => [item.versionNumber, item.declaredModelVersion]),
    [
      [2, "2026-07-14"],
      [1, "2026-07-01"],
    ],
  );
  assert.notEqual(updated.versions[0]?.configurationCommitment, updated.versions[1]?.configurationCommitment);

  const stored = await dbClient.execute({
    sql: `SELECT version_number, display_name, declared_model_version, configuration_commitment
          FROM tokenless_agent_versions WHERE agent_id = ? ORDER BY version_number`,
    args: [created.agentId],
  });
  assert.equal(stored.rowCount, 2);
  assert.equal(stored.rows[0]?.display_name, "Support quality agent");
  assert.equal(stored.rows[0]?.declared_model_version, "2026-07-01");
  assert.match(String(stored.rows[0]?.configuration_commitment), /^[a-f0-9]{64}$/);
  assert.equal(stored.rows[1]?.display_name, "Support quality agent v2");

  await assert.rejects(
    () =>
      createWorkspaceAgentVersion({
        accountAddress: OWNER,
        workspaceId,
        agentId: created.agentId,
        version: { ...version("2026-07-14"), displayName: "Support quality agent v2" },
      }),
    /already exists/,
  );
});

test("agent registry returns source-derived human-assurance evidence without pooling scopes", async () => {
  const { workspaceId } = await createWorkspace({ name: "Assurance registry", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "assurance-agent",
    version: version("2026-07-15"),
  });
  const now = new Date();
  const policyId = "arp_assurance_registry";
  const scopeId = "aesc_assurance_registry";
  const bindingId = "hrb_assurance_registry";
  const requestProfileId = "rrp_assurance_registry";
  const requestProfileHash = HASH("c");
  const executionProfileHash = `sha256:${"a".repeat(64)}`;
  const executionProfileJson = JSON.stringify({
    schemaVersion: "rateloop.execution-profile.v1",
    orchestrationMode: "multi_model",
    primary: {
      provider: "OpenAI",
      requestedModel: "sol",
      resolvedModel: "gpt-5.1-codex",
      modelVersion: "2026-07-15",
      reasoningEffort: "high",
      serviceTier: "priority",
    },
    contributors: [
      {
        provider: "OpenAI",
        requestedModel: "terra",
        resolvedModel: null,
        modelVersion: null,
        reasoningEffort: "medium",
        serviceTier: "standard",
      },
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id, version, workspace_id, agent_id, agent_version_id, mode, enabled,
           agreement_threshold_bps, production_floor_bps, maximum_unreviewed_gap, rules_json,
           audience_policy_json, created_by, approved_by, created_at)
          VALUES (?, 1, ?, ?, ?, 'adaptive', true, 7000, 1000, 20, '{}', ?, ?, ?, ?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ reviewerSource: "public_network" }),
      OWNER.toLowerCase(),
      OWNER.toLowerCase(),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_request_profiles
          (profile_id, version, workspace_id, agent_id, agent_version_id, criterion, positive_label,
           negative_label, rationale_mode, audience, content_boundary, private_sensitivity,
           private_group_id, private_group_policy_version, private_group_policy_hash,
           response_window_seconds, panel_size, compensation_mode, bounty_per_seat_atomic,
           configuration_status, profile_hash, created_by, created_at, approved_by, approved_at)
          VALUES (?, 1, ?, ?, ?, 'Check whether this response is correct', 'Approve', 'Reject', 'required',
                  'public_network', 'public_or_test', NULL, NULL, NULL, NULL, 3600, 3, 'usdc',
                  '1000000', 'ready', ?, ?, ?, ?, ?)`,
    args: [
      requestProfileId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      requestProfileHash,
      OWNER.toLowerCase(),
      now,
      OWNER.toLowerCase(),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id, version, workspace_id, agent_id, agent_version_id,
           selection_policy_id, selection_policy_version, request_profile_id, request_profile_version,
           request_profile_hash, publishing_policy_id, publishing_policy_version, authority, enabled,
           canonical_hash, created_by, created_at, approved_by, approved_at)
          VALUES (?, 1, ?, ?, ?, ?, 1, ?, 1, ?, NULL, NULL, 'check_only', true, ?, ?, ?, ?, ?)`,
    args: [
      bindingId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      requestProfileId,
      requestProfileHash,
      HASH("d"),
      OWNER.toLowerCase(),
      now,
      OWNER.toLowerCase(),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version,
           workflow_key, risk_tier, audience_policy_hash, partition_commitment,
           execution_profile_hash, execution_profile_json, human_review_binding_id,
           human_review_binding_version, request_profile_id, request_profile_version,
           request_profile_hash, stage,
           completed_comparable_cases, stable_cases_since_stage, unreviewed_since_last_sample,
           stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 'support-reply', 'low', 'sha256:audience', 'sha256:partition', ?, ?,
                  ?, 1, ?, 1, ?, 'high_coverage', 32, 12, 0, ?, ?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      executionProfileHash,
      executionProfileJson,
      bindingId,
      requestProfileId,
      requestProfileHash,
      now,
      now,
    ],
  });

  for (const [index, metrics] of [
    { duration: 1_000, input: 100, output: 20 },
    { duration: 3_000, input: null, output: 40 },
  ].entries()) {
    const executionId = `aexe_registry_${index}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_executions
            (execution_id, workspace_id, agent_id, agent_version_id, external_execution_id, status,
             started_at, completed_at, total_duration_ms, tool_call_count, model_call_count,
             input_token_total, output_token_total, reasoning_output_token_total, primary_span_id,
             manifest_commitment, execution_profile_hash, execution_profile_json, created_at)
            VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        executionId,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        `external-execution-${index}`,
        new Date(now.getTime() + index),
        new Date(now.getTime() + index + metrics.duration),
        metrics.duration,
        metrics.input,
        metrics.output,
        null,
        `span_primary_${index}`,
        `sha256:${String(index + 1).repeat(64)}`,
        executionProfileHash,
        executionProfileJson,
        new Date(now.getTime() + index),
      ],
    });
  }

  for (const [index, status] of ["completed", "completed", "skipped"].entries()) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
          (opportunity_id, workspace_id, agent_id, agent_version_id, scope_id, policy_id, policy_version,
             execution_id, external_opportunity_id, suggestion_commitment, declared_confidence_bps, metadata_commitment,
             metadata_complete, critical_risk, decision, review_rate_bps, selection_probability_bps,
             sample_bucket, sampler_key_version, sampler_commitment, reason_codes_json, status,
             source_evidence_reference, source_evidence_hash, human_review_binding_id,
             human_review_binding_version, request_profile_id, request_profile_version,
             request_profile_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 9000, ?, true, false, ?, 5000, 5000,
                    ?, 'sampler-v1', ?, '[]', ?, ?, ?, ?, 1, ?, 1, ?, ?, ?)`,
      args: [
        `aeop_registry_${index}`,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        scopeId,
        policyId,
        status === "skipped" ? null : `aexe_registry_${index}`,
        `external-registry-${index}`,
        `sha256:suggestion-${index}`,
        `sha256:metadata-${index}`,
        status === "skipped" ? "skip" : "required",
        index,
        `sha256:sampler-${index}`,
        status,
        `evidence/registry/${index}`,
        `sha256:evidence-${index}`,
        bindingId,
        requestProfileId,
        requestProfileHash,
        new Date(now.getTime() + index),
        new Date(now.getTime() + index),
      ],
    });
  }

  for (const [index, agreement] of ["agree", "disagree"].entries()) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_evaluation_observations
            (observation_id, workspace_id, scope_id, opportunity_id, evidence_reference, source_payload_hash,
             agent_outcome_commitment, human_outcome_commitment, agreement, comparable,
             responding_human_count, finalized_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, true, 1, ?, ?)`,
      args: [
        `aeob_registry_${index}`,
        workspaceId,
        scopeId,
        `aeop_registry_${index}`,
        `evidence/registry/${index}`,
        `sha256:source-${index}`,
        `sha256:agent-${index}`,
        `sha256:human-${index}`,
        agreement,
        new Date(now.getTime() + index),
        new Date(now.getTime() + index),
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policy_events
          (event_id, workspace_id, scope_id, policy_id, policy_version, event_type, from_stage, to_stage,
           reason_codes_json, actor_type, actor_reference, event_commitment, created_at)
          VALUES ('arpe_registry', ?, ?, ?, 1, 'stage_changed', 'calibrating', 'high_coverage', ?,
                  'service', 'adaptive-review', 'sha256:event', ?)`,
    args: [workspaceId, scopeId, policyId, JSON.stringify(["two_stable_windows"]), now],
  });

  const legacyScopeId = "aesc_assurance_registry_legacy";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version,
           workflow_key, risk_tier, audience_policy_hash, partition_commitment,
           execution_profile_hash, execution_profile_json, human_review_binding_id,
           human_review_binding_version, request_profile_id, request_profile_version,
           request_profile_hash, stage,
           completed_comparable_cases, stable_cases_since_stage, unreviewed_since_last_sample,
           stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 'support-reply', 'low', 'sha256:audience', 'sha256:legacy-partition',
                  ?, '{}', ?, 1, ?, 1, ?, 'calibrating', 0, 0, 0, ?, ?)`,
    args: [
      legacyScopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      `sha256:${"b".repeat(64)}`,
      bindingId,
      requestProfileId,
      requestProfileHash,
      now,
      new Date(now.getTime() - 1),
    ],
  });

  const registry = await listWorkspaceAgents({ accountAddress: OWNER, workspaceId });
  const evidence = registry.agents[0]?.assuranceScopes.find(scope => scope.scopeId === scopeId);
  assert.ok(evidence);
  assert.equal(evidence.workflowKey, "support-reply");
  assert.equal(evidence.riskTier, "low");
  assert.equal(evidence.reviewRateBps, 5_000);
  assert.equal(evidence.reviewedOpportunityCount, 2);
  assert.equal(evidence.skippedOpportunityCount, 1);
  assert.equal(evidence.comparableCount, 2);
  assert.equal(evidence.agreementCount, 1);
  assert.equal(evidence.humanAgreementBps, 5_000);
  assert.ok((evidence.humanAgreementLower95Bps ?? 5_000) < 5_000);
  assert.equal(evidence.executionProfileHash, executionProfileHash);
  assert.deepEqual(evidence.executionProfile, {
    available: true,
    orchestrationMode: "multi_model",
    primary: {
      provider: "OpenAI",
      requestedModel: "sol",
      resolvedModel: "gpt-5.1-codex",
      modelVersion: "2026-07-15",
      reasoningEffort: "high",
      serviceTier: "priority",
    },
    contributors: [
      {
        provider: "OpenAI",
        requestedModel: "terra",
        resolvedModel: null,
        modelVersion: null,
        reasoningEffort: "medium",
        serviceTier: "standard",
      },
    ],
  });
  assert.equal(evidence.executionCount, 2);
  assert.equal(evidence.averageTotalDurationMs, 2_000);
  assert.equal(evidence.averageInputTokenTotal, 100);
  assert.equal(evidence.averageOutputTokenTotal, 30);
  assert.equal(evidence.averageReasoningOutputTokenTotal, null);
  assert.equal(evidence.nextReassessmentAfter, 38);
  assert.deepEqual(evidence.lastTransition?.reasonCodes, ["two_stable_windows"]);

  const legacyEvidence = registry.agents[0]?.assuranceScopes.find(scope => scope.scopeId === legacyScopeId);
  assert.ok(legacyEvidence);
  assert.deepEqual(legacyEvidence.executionProfile, {
    available: false,
    orchestrationMode: null,
    primary: null,
    contributors: [],
  });
  assert.equal(legacyEvidence.executionCount, 0);
  assert.equal(legacyEvidence.averageTotalDurationMs, null);

  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_policies
          SET mode = 'fixed', production_floor_bps = 0, fixed_rate_bps = 1234
          WHERE policy_id = ? AND version = 1`,
    args: [policyId],
  });
  const fixedEvidence = (
    await listWorkspaceAgents({ accountAddress: OWNER, workspaceId })
  ).agents[0]?.assuranceScopes.find(scope => scope.scopeId === scopeId);
  assert.equal(fixedEvidence?.reviewRateBps, 1_234);
  assert.equal(fixedEvidence?.nextReassessmentAfter, 0);

  for (const mode of ["rules", "manual"] as const) {
    await dbClient.execute({
      sql: `UPDATE tokenless_agent_review_policies
            SET mode = ?, fixed_rate_bps = NULL
            WHERE policy_id = ? AND version = 1`,
      args: [mode, policyId],
    });
    const nonAdaptiveEvidence = (
      await listWorkspaceAgents({ accountAddress: OWNER, workspaceId })
    ).agents[0]?.assuranceScopes.find(scope => scope.scopeId === scopeId);
    assert.equal(nonAdaptiveEvidence?.reviewRateBps, 0);
    assert.equal(nonAdaptiveEvidence?.nextReassessmentAfter, 0);
  }
});

test("human-review summaries use exact current bindings, aggregate durable workload, and redact member-only reads", async () => {
  const { workspaceId } = await createWorkspace({ name: "Review projection", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, new Date()],
  });
  const first = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "review-projection-agent",
    version: version("2026-07-15"),
  });
  const base = new Date("2026-07-16T08:00:00.000Z");
  await insertReviewProjectionPolicy({
    workspaceId,
    agentId: first.agentId,
    agentVersionId: first.currentVersion.versionId,
    policyId: "rpol_projection_old",
    profileId: "rrp_projection_old",
    profileHash: HASH("e"),
    now: base,
  });
  const current = await createWorkspaceAgentVersion({
    accountAddress: OWNER,
    workspaceId,
    agentId: first.agentId,
    version: { ...version("2026-07-16"), displayName: "Review projection agent v2" },
  });
  await insertReviewProjectionPolicy({
    workspaceId,
    agentId: current.agentId,
    agentVersionId: current.currentVersion.versionId,
    policyId: "rpol_projection_current",
    profileId: "rrp_projection_current",
    profileHash: HASH("f"),
    now: new Date(base.getTime() + 1_000),
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id, version, workspace_id, agent_id, agent_version_id,
           selection_policy_id, selection_policy_version, request_profile_id, request_profile_version,
           request_profile_hash, publishing_policy_id, publishing_policy_version, authority, enabled,
           canonical_hash, created_by, created_at, approved_by, approved_at)
          VALUES ('hrb_projection_old', 1, ?, ?, ?, 'rpol_projection_old', 1,
                  'rrp_projection_old', 1, ?, NULL, NULL, 'check_only', true, ?, ?, ?, ?, ?)`,
    args: [
      workspaceId,
      current.agentId,
      first.currentVersion.versionId,
      HASH("e"),
      HASH("e"),
      OWNER,
      base,
      OWNER,
      base,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_bindings
          (binding_id, version, workspace_id, agent_id, agent_version_id,
           selection_policy_id, selection_policy_version, request_profile_id, request_profile_version,
           request_profile_hash, publishing_policy_id, publishing_policy_version, authority, enabled,
           canonical_hash, created_by, created_at, approved_by, approved_at, superseded_at)
          VALUES
          ('hrb_projection', 1, ?, ?, ?, 'rpol_projection_current', 1, 'rrp_projection_current', 1,
           ?, NULL, NULL, 'check_only', false, ?, ?, ?, ?, ?, ?),
          ('hrb_projection', 2, ?, ?, ?, 'rpol_projection_current', 1, 'rrp_projection_current', 1,
           ?, NULL, NULL, 'check_only', true, ?, ?, ?, ?, ?, NULL)`,
    args: [
      workspaceId,
      current.agentId,
      current.currentVersion.versionId,
      HASH("f"),
      HASH("1"),
      OWNER,
      base,
      OWNER,
      base,
      new Date(base.getTime() + 1_000),
      workspaceId,
      current.agentId,
      current.currentVersion.versionId,
      HASH("f"),
      HASH("2"),
      OWNER,
      new Date(base.getTime() + 1_000),
      OWNER,
      new Date(base.getTime() + 1_000),
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_human_review_binding_events
          (event_id, workspace_id, binding_id, binding_version, event_type, actor_type,
           actor_reference, details_json, event_hash, created_at)
          VALUES
          ('hrbe_projection_1', ?, 'hrb_projection', 1, 'created', 'account', ?, '{}', ?, ?),
          ('hrbe_projection_2', ?, 'hrb_projection', 2, 'configuration_changed', 'account', ?, '{}', ?, ?)`,
    args: [workspaceId, OWNER, HASH("3"), base, workspaceId, OWNER, HASH("4"), new Date(base.getTime() + 1_000)],
  });

  const exactKey = await createWorkspaceApiKey({
    workspaceId,
    name: "Exact review projection",
    scopes: ["evaluation:read", "review:decide", "result:read"],
  });
  const staleKey = await createWorkspaceApiKey({
    workspaceId,
    name: "Stale review projection",
    scopes: ["evaluation:read", "review:decide", "result:read"],
  });
  for (const integration of [
    {
      id: "agi_projection_exact",
      pairingId: "apr_projection_exact",
      keyId: exactKey.apiKeyId,
      bindingId: "hrb_projection",
      bindingVersion: 2,
      offset: 0,
    },
    {
      id: "agi_projection_stale",
      pairingId: "apr_projection_stale",
      keyId: staleKey.apiKeyId,
      bindingId: null,
      bindingVersion: null,
      offset: 86_400_000,
    },
  ]) {
    const createdAt = new Date(base.getTime() + integration.offset);
    const expiresAt = new Date(createdAt.getTime() + 7 * 86_400_000);
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_pairing_sessions
            (pairing_id, workspace_id, api_key_id, credential_hash, credential_prefix, status,
             created_by, resolved_by, created_at, expires_at, approved_at)
            VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?)`,
      args: [
        integration.pairingId,
        workspaceId,
        integration.keyId,
        `credential-${integration.id}`,
        integration.id.slice(0, 20),
        OWNER,
        OWNER,
        createdAt,
        expiresAt,
        createdAt,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_integrations
            (integration_id, pairing_id, workspace_id, agent_id, agent_version_id,
             review_policy_id, review_policy_version, api_key_id, status, enforcement_mode,
             allowed_workflow_keys_json, granted_scopes_json, credential_expires_at,
             human_review_binding_id, human_review_binding_version,
             last_decision_at, last_request_at, last_result_at, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'rpol_projection_current', 1, ?, 'active', 'advisory', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        integration.id,
        integration.pairingId,
        workspaceId,
        current.agentId,
        current.currentVersion.versionId,
        integration.keyId,
        JSON.stringify(["evaluation:read", "review:decide", "result:read"]),
        expiresAt,
        integration.bindingId,
        integration.bindingVersion,
        new Date(createdAt.getTime() + 10_000),
        new Date(createdAt.getTime() + 20_000),
        new Date(createdAt.getTime() + 30_000),
        OWNER,
        createdAt,
        createdAt,
      ],
    });
  }

  await insertReviewProjectionScope({
    workspaceId,
    agentId: current.agentId,
    agentVersionId: first.currentVersion.versionId,
    policyId: "rpol_projection_old",
    bindingId: "hrb_projection_old",
    bindingVersion: 1,
    profileId: "rrp_projection_old",
    profileHash: HASH("e"),
    scopeId: "aesc_projection_old",
    hashCharacter: "5",
    now: base,
  });
  await insertReviewProjectionScope({
    workspaceId,
    agentId: current.agentId,
    agentVersionId: current.currentVersion.versionId,
    policyId: "rpol_projection_current",
    bindingId: "hrb_projection",
    bindingVersion: 2,
    profileId: "rrp_projection_current",
    profileHash: HASH("f"),
    scopeId: "aesc_projection_current",
    hashCharacter: "6",
    now: base,
  });
  const opportunities = [
    [
      "aop_projection_old_approval",
      "approval_required",
      "aesc_projection_old",
      "rpol_projection_old",
      first.currentVersion.versionId,
    ],
    [
      "aop_projection_current_approval",
      "approval_required",
      "aesc_projection_current",
      "rpol_projection_current",
      current.currentVersion.versionId,
    ],
    [
      "aop_projection_ready",
      "request_ready",
      "aesc_projection_current",
      "rpol_projection_current",
      current.currentVersion.versionId,
    ],
    [
      "aop_projection_pending",
      "pending",
      "aesc_projection_current",
      "rpol_projection_current",
      current.currentVersion.versionId,
    ],
    [
      "aop_projection_blocked",
      "blocked",
      "aesc_projection_current",
      "rpol_projection_current",
      current.currentVersion.versionId,
    ],
  ] as const;
  for (const [opportunityId, state, scopeId, policyId, agentVersionId] of opportunities) {
    await insertReviewProjectionOpportunity({
      workspaceId,
      agentId: current.agentId,
      agentVersionId,
      policyId,
      bindingId: policyId === "rpol_projection_old" ? "hrb_projection_old" : "hrb_projection",
      bindingVersion: policyId === "rpol_projection_old" ? 1 : 2,
      profileId: policyId === "rpol_projection_old" ? "rrp_projection_old" : "rrp_projection_current",
      profileHash: policyId === "rpol_projection_old" ? HASH("e") : HASH("f"),
      scopeId,
      opportunityId,
      state,
      createdAt: new Date(base.getTime() + 2_000),
    });
  }
  await insertReviewProjectionOpportunity({
    workspaceId,
    agentId: current.agentId,
    agentVersionId: first.currentVersion.versionId,
    policyId: "rpol_projection_old",
    bindingId: "hrb_projection_old",
    bindingVersion: 1,
    profileId: "rrp_projection_old",
    profileHash: HASH("e"),
    scopeId: "aesc_projection_old",
    opportunityId: "aop_projection_old_terminal",
    state: "completed",
    createdAt: base,
    terminalAt: new Date(base.getTime() + 9 * 3_600_000),
  });
  await insertReviewProjectionOpportunity({
    workspaceId,
    agentId: current.agentId,
    agentVersionId: current.currentVersion.versionId,
    policyId: "rpol_projection_current",
    bindingId: "hrb_projection",
    bindingVersion: 2,
    profileId: "rrp_projection_current",
    profileHash: HASH("f"),
    scopeId: "aesc_projection_current",
    opportunityId: "aop_projection_current_terminal",
    state: "skipped",
    createdAt: base,
    terminalAt: new Date(base.getTime() + 8 * 3_600_000),
  });
  for (const approval of [
    {
      id: "hrap_projection_active",
      opportunityId: "aop_projection_current_approval",
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
      hashCharacter: "7",
    },
    {
      id: "hrap_projection_expired",
      opportunityId: "aop_projection_old_approval",
      createdAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
      hashCharacter: "8",
    },
  ]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_approval_requests
            (approval_id, workspace_id, opportunity_id, revision, request_profile_id,
             request_profile_version, request_profile_hash, source_evidence_hash, suggestion_commitment,
             prepared_request_json, prepared_request_hash, derived_economics_json, derived_economics_hash,
             maximum_charge_atomic, feedback_bonus_maximum_atomic, maximum_consent_atomic,
             status, prepared_by, created_at, expires_at)
            VALUES (?, ?, ?, 1, 'rrp_projection_current', 1, ?, ?, ?, '{}', ?, '{}', ?,
                    7500000, 0, 7500000, 'pending', ?, ?, ?)`,
      args: [
        approval.id,
        workspaceId,
        approval.opportunityId,
        HASH("f"),
        HASH("d"),
        HASH("a"),
        HASH(approval.hashCharacter),
        HASH(approval.hashCharacter === "7" ? "9" : "0"),
        OWNER,
        approval.createdAt,
        approval.expiresAt,
      ],
    });
  }

  const ownerAgent = (await listWorkspaceAgents({ accountAddress: OWNER, workspaceId })).agents[0]!;
  assert.equal(ownerAgent.currentVersion.versionId, current.currentVersion.versionId);
  assert.equal(ownerAgent.humanReview.status, "configured");
  assert.deepEqual(ownerAgent.humanReview.configuration?.selection.effectiveRateRangeBps, {
    minimum: 10_000,
    maximum: 10_000,
  });
  assert.equal(ownerAgent.humanReview.configuration?.request.responseWindowSeconds, 3600);
  assert.equal(ownerAgent.humanReview.configuration?.request.panelSize, 3);
  assert.equal(ownerAgent.humanReview.configuration?.connected, true);
  assert.deepEqual(ownerAgent.humanReview.activity, {
    lastDecisionAt: "2026-07-16T08:00:10.000Z",
    lastRequestAt: "2026-07-16T08:00:20.000Z",
    lastResultAt: "2026-07-16T08:00:30.000Z",
  });
  assert.deepEqual(ownerAgent.humanReview.workload, {
    openCount: 5,
    approvalRequiredCount: 2,
    requestReadyCount: 1,
    activeReviewCount: 1,
    blockedCount: 1,
    ownerActionCount: 1,
  });
  assert.deepEqual(ownerAgent.humanReview.lastTerminal, {
    state: "completed",
    at: "2026-07-16T17:00:00.000Z",
  });
  assert.equal(ownerAgent.humanReview.management?.binding?.version, 2);
  assert.equal(ownerAgent.humanReview.management?.selectionPolicy?.id, "rpol_projection_current");
  assert.equal(ownerAgent.humanReview.management?.delegation?.integrationId, "agi_projection_exact");
  assert.deepEqual(ownerAgent.humanReview.management?.delegation?.scopes, [
    "evaluation:read",
    "review:decide",
    "result:read",
  ]);
  assert.equal(ownerAgent.humanReview.management?.audit.eventCount, 2);
  assert.equal(ownerAgent.humanReview.management?.audit.latest?.type, "configuration_changed");
  assert.equal(ownerAgent.humanReview.management?.lastTerminalDetails?.opportunityId, "aop_projection_old_terminal");

  const memberAgent = (await listWorkspaceAgents({ accountAddress: MEMBER, workspaceId })).agents[0]!;
  assert.equal(memberAgent.ownerAccountAddress, null);
  assert.equal(memberAgent.createdBy, null);
  assert.ok(memberAgent.versions.every(snapshot => snapshot.createdBy === null));
  assert.equal(memberAgent.humanReview.management, null);
  assert.deepEqual(memberAgent.humanReview.configuration, ownerAgent.humanReview.configuration);
  assert.deepEqual(memberAgent.humanReview.workload, ownerAgent.humanReview.workload);
  const memberProjection = JSON.stringify(memberAgent.humanReview);
  for (const secret of ["hrb_projection", "rrp_projection_current", HASH("f"), "agi_projection_exact"]) {
    assert.doesNotMatch(memberProjection, new RegExp(secret));
  }
});

test("workspace roles permit authorized reads while restricting registry mutations to owners and admins", async () => {
  const { workspaceId } = await createWorkspace({ name: "Scoped registry", ownerAddress: OWNER });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?), (?, ?, 'admin', ?)`,
    args: [workspaceId, MEMBER, new Date(), workspaceId, ADMIN, new Date()],
  });
  await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "allowed-reader",
    version: version("2026-07-14"),
  });
  const adminAgent = await createWorkspaceAgent({
    accountAddress: ADMIN,
    workspaceId,
    externalId: "admin-managed",
    version: version("2026-07-14-admin"),
  });
  assert.equal(adminAgent.ownerAccountAddress, ADMIN.toLowerCase());
  const adminRegistry = await listWorkspaceAgents({ accountAddress: ADMIN, workspaceId });
  assert.equal(adminRegistry.callerRole, "admin");
  assert.equal(adminRegistry.canManage, true);

  const memberRegistry = await listWorkspaceAgents({ accountAddress: MEMBER, workspaceId });
  assert.equal(memberRegistry.callerRole, "member");
  assert.equal(memberRegistry.canManage, false);
  assert.equal(memberRegistry.agents.length, 2);
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: MEMBER,
        workspaceId,
        externalId: "member-write",
        version: version("2026-07-14"),
      }),
    /Workspace not found/,
  );
  await assert.rejects(() => listWorkspaceAgents({ accountAddress: OUTSIDER, workspaceId }), /Workspace not found/);
});

test("Free and Early Access plans enforce active-agent limits in the creation transaction", async () => {
  const { workspaceId } = await createWorkspace({ name: "Agent limits", ownerAddress: OWNER });
  await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "free-agent",
    version: version("2026-07-14"),
  });
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "over-free-limit",
        version: version("2026-07-15"),
      }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "plan_limit_reached" &&
      "limitType" in error &&
      error.limitType === "active_agents",
  );
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_workspace_subscriptions
          SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
              provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
          WHERE workspace_id = ?`,
    args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
  });
  const second = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "paid-agent-two",
    version: version("2026-07-15"),
  });
  const third = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "paid-agent-three",
    version: version("2026-07-16"),
  });
  assert.equal(second.status, "active");
  assert.equal(third.status, "active");
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "over-paid-limit",
        version: version("2026-07-17"),
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "plan_limit_reached",
  );
});

test("deactivation is durable and blocks later versions without deleting audit history", async () => {
  const { workspaceId } = await createWorkspace({ name: "Deactivation", ownerAddress: OWNER });
  const created = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "deactivated-agent",
    version: version("2026-07-14"),
  });
  const inactive = await deactivateWorkspaceAgent({ accountAddress: OWNER, workspaceId, agentId: created.agentId });
  assert.equal(inactive.status, "inactive");
  assert.ok(inactive.deactivatedAt);
  assert.equal(inactive.versions.length, 1);
  await assert.rejects(
    () =>
      createWorkspaceAgentVersion({
        accountAddress: OWNER,
        workspaceId,
        agentId: created.agentId,
        version: version("2026-07-15"),
      }),
    /inactive/,
  );
  const audit = await dbClient.execute({
    sql: `SELECT event_type FROM tokenless_agent_audit_events
          WHERE workspace_id = ? AND agent_id = ? ORDER BY created_at`,
    args: [workspaceId, created.agentId],
  });
  assert.deepEqual(
    audit.rows.map(row => row.event_type),
    ["agent.created", "agent.deactivated"],
  );
});

test("external IDs and declared model metadata are validated before persistence", async () => {
  const { workspaceId } = await createWorkspace({ name: "Validation", ownerAddress: OWNER });
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "contains spaces",
        version: version("2026-07-14"),
      }),
    /External agent ID/,
  );
  await assert.rejects(
    () =>
      createWorkspaceAgent({
        accountAddress: OWNER,
        workspaceId,
        externalId: "missing-provider",
        version: { ...version("2026-07-14"), provider: "" },
      }),
    /Declared provider/,
  );
});

test("owner-editable capability statements persist, audit, and stay owner/admin-gated", async () => {
  const { workspaceId } = await createWorkspace({ name: "Capability card", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, new Date()],
  });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "capability-card",
    version: version("2026-07-14"),
  });
  // Default: nothing stated yet.
  assert.deepEqual(agent.capabilityStatement, {
    intendedPurpose: null,
    knownLimitations: null,
    doNotUseConditions: null,
    updatedAt: null,
    updatedBy: null,
  });

  const updated = await updateWorkspaceAgentCapabilityStatement({
    accountAddress: OWNER,
    workspaceId,
    agentId: agent.agentId,
    statement: {
      intendedPurpose: "Draft support replies for low-risk tickets.",
      knownLimitations: "Struggles with refunds and legal questions.",
      doNotUseConditions: "  Never use for medical or legal advice.  ",
    },
  });
  assert.equal(updated.capabilityStatement.intendedPurpose, "Draft support replies for low-risk tickets.");
  assert.equal(updated.capabilityStatement.doNotUseConditions, "Never use for medical or legal advice.");
  assert.equal(updated.capabilityStatement.updatedBy, OWNER.toLowerCase());
  assert.notEqual(updated.capabilityStatement.updatedAt, null);

  // Clearing a field stores null, and member reads redact the updating account.
  const cleared = await updateWorkspaceAgentCapabilityStatement({
    accountAddress: OWNER,
    workspaceId,
    agentId: agent.agentId,
    statement: { intendedPurpose: "Draft support replies.", knownLimitations: "", doNotUseConditions: null },
  });
  assert.equal(cleared.capabilityStatement.knownLimitations, null);
  const memberView = await listWorkspaceAgents({ accountAddress: MEMBER, workspaceId });
  assert.equal(memberView.agents[0]?.capabilityStatement.intendedPurpose, "Draft support replies.");
  assert.equal(memberView.agents[0]?.capabilityStatement.updatedBy, null);

  await assert.rejects(
    () =>
      updateWorkspaceAgentCapabilityStatement({
        accountAddress: MEMBER,
        workspaceId,
        agentId: agent.agentId,
        statement: { intendedPurpose: "member write" },
      }),
    /Workspace not found/,
  );
  await assert.rejects(
    () =>
      updateWorkspaceAgentCapabilityStatement({
        accountAddress: OWNER,
        workspaceId,
        agentId: agent.agentId,
        statement: { intendedPurpose: "x".repeat(2001) },
      }),
    /at most 2000 characters/,
  );
  await assert.rejects(
    () =>
      updateWorkspaceAgentCapabilityStatement({
        accountAddress: OWNER,
        workspaceId,
        agentId: agent.agentId,
        statement: { unsupported: true } as never,
      }),
    /Capability statements carry only/,
  );
  await assert.rejects(
    () =>
      updateWorkspaceAgentCapabilityStatement({
        accountAddress: OWNER,
        workspaceId,
        agentId: "agt_missing",
        statement: { intendedPurpose: "ghost" },
      }),
    /Agent not found/,
  );

  const audit = await dbClient.execute({
    sql: `SELECT event_type, details_json FROM tokenless_agent_audit_events
          WHERE workspace_id = ? AND agent_id = ? ORDER BY created_at ASC`,
    args: [workspaceId, agent.agentId],
  });
  const capabilityEvents = audit.rows.filter(row => row.event_type === "agent.capability_statement_updated");
  assert.equal(capabilityEvents.length, 2);
  assert.deepEqual(JSON.parse(String(capabilityEvents[1]?.details_json)), {
    hasIntendedPurpose: true,
    hasKnownLimitations: false,
    hasDoNotUseConditions: false,
  });
});

test("the capability-statement route is a same-origin mutation of the registry service", () => {
  const source = readFileSync(
    new URL(
      "../../app/api/account/workspaces/[workspaceId]/agents/[agentId]/capability-statement/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(source, /updateWorkspaceAgentCapabilityStatement/u);
  assert.match(source, /export async function PUT/u);
  assert.doesNotMatch(source, /export async function (GET|POST|DELETE)/u);
});
