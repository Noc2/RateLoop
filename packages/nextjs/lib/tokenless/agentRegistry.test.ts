import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  createWorkspaceAgent,
  createWorkspaceAgentVersion,
  deactivateWorkspaceAgent,
  listWorkspaceAgents,
} from "~~/lib/tokenless/agentRegistry";
import { createWorkspace } from "~~/lib/tokenless/productCore";

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
      JSON.stringify({ reviewerSource: "private_invited" }),
      OWNER.toLowerCase(),
      OWNER.toLowerCase(),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id, workspace_id, agent_id, agent_version_id, policy_id, policy_version,
           workflow_key, risk_tier, audience_policy_hash, partition_commitment,
           execution_profile_hash, execution_profile_json, stage,
           completed_comparable_cases, stable_cases_since_stage, unreviewed_since_last_sample,
           stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 'support-reply', 'low', 'sha256:audience', 'sha256:partition', ?, ?,
                  'high_coverage', 32, 12, 0, ?, ?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      executionProfileHash,
      executionProfileJson,
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
             source_evidence_reference, source_evidence_hash, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 9000, ?, true, false, ?, 5000, 5000,
                    ?, 'sampler-v1', ?, '[]', ?, ?, ?, ?, ?)`,
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
           execution_profile_hash, execution_profile_json, stage,
           completed_comparable_cases, stable_cases_since_stage, unreviewed_since_last_sample,
           stage_entered_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, 'support-reply', 'low', 'sha256:audience', 'sha256:legacy-partition',
                  ?, '{}', 'calibrating', 0, 0, 0, ?, ?)`,
    args: [
      legacyScopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      `sha256:${"b".repeat(64)}`,
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
