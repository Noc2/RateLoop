import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { getWorkspaceEvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import {
  addAssuranceCase,
  createAssuranceAudiencePolicy,
  createAssuranceProject,
  createAssuranceRun,
  createAssuranceSuite,
  freezeAssuranceSuite,
  markAssuranceCaseReady,
} from "~~/lib/tokenless/humanAssurance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER: `0x${string}` = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function seedArtifact(projectId: string, role: "baseline" | "candidate") {
  const now = new Date();
  const artifactId = `${projectId}_${role}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
           redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'text/plain', 10, ?, 'approved', 'plain_text', ?, ?)`,
    args: [artifactId, projectId, role, role, hash(artifactId), `artifact://test/${artifactId}`, now, now],
  });
  return artifactId;
}

async function seedAdaptiveCoverage(workspaceId: string, agent: Awaited<ReturnType<typeof createWorkspaceAgent>>) {
  const policyId = "arp_evaluation_coverage";
  const scopeId = "aesc_evaluation_coverage";
  const latestChangeAt = new Date("2026-07-16T12:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
           agreement_threshold_bps,production_floor_bps,maximum_unreviewed_gap,rules_json,
           audience_policy_json,created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'adaptive',true,7000,6000,20,'{}',?,?,?,?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ reviewerSource: "public_network" }),
      OWNER,
      OWNER,
      new Date("2026-07-14T12:00:00.000Z"),
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
           workflow_key,risk_tier,audience_policy_hash,partition_commitment,execution_profile_hash,
           execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,
           completed_comparable_cases,stable_cases_since_stage,unreviewed_since_last_sample,
           stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'support-reply','low',?,?,?,'{}',?,1,?,1,?,
                  'high_coverage',60,30,0,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      hash("coverage-audience"),
      hash("coverage-partition"),
      hash("coverage-execution-profile"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      latestChangeAt,
      latestChangeAt,
    ],
  });
  for (const change of [
    {
      id: "arpe_coverage_first",
      type: "stage_changed",
      from: "calibrating",
      to: "high_coverage",
      reason: "two_stable_windows",
      at: new Date("2026-07-14T12:00:00.000Z"),
    },
    {
      id: "arpe_coverage_reset",
      type: "reset",
      from: "high_coverage",
      to: "calibrating",
      reason: "agreement_below_threshold",
      at: new Date("2026-07-15T12:00:00.000Z"),
    },
    {
      id: "arpe_coverage_latest",
      type: "stage_changed",
      from: "calibrating",
      to: "high_coverage",
      reason: "two_stable_windows",
      at: latestChangeAt,
    },
    {
      id: "arpe_coverage_forced",
      type: "forced_review",
      from: "high_coverage",
      to: "high_coverage",
      reason: "must-not-enter-coverage-history",
      at: new Date("2026-07-17T12:00:00.000Z"),
    },
  ]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_policy_events
            (event_id,workspace_id,scope_id,policy_id,policy_version,event_type,from_stage,to_stage,
             reason_codes_json,actor_type,actor_reference,event_commitment,created_at)
            VALUES (?,?,?,?,1,?,?,?,?, 'service','private-adaptive-actor',?,?)`,
      args: [
        change.id,
        workspaceId,
        scopeId,
        policyId,
        change.type,
        change.from,
        change.to,
        JSON.stringify([change.reason]),
        hash(change.id),
        change.at,
      ],
    });
  }
  return { scopeId };
}

test("evaluation dashboard suppresses small cells and never attributes legacy runs to registered agents", async () => {
  const { workspaceId } = await createWorkspace({ name: "Evaluation workspace", ownerAddress: OWNER });
  const principal = { kind: "workspace_session" as const, accountAddress: OWNER, workspaceId, role: "owner" as const };
  const { projectId } = await createAssuranceProject({
    principal,
    name: "Support release gate",
    dataClassification: "confidential",
    retentionDays: 30,
  });
  const [baselineArtifactId, candidateArtifactId] = await Promise.all([
    seedArtifact(projectId, "baseline"),
    seedArtifact(projectId, "candidate"),
  ]);
  const suite = await createAssuranceSuite({
    principal,
    projectId,
    name: "Support quality",
    rubric: {
      prompt: "Which answer is better?",
      failureTags: [{ key: "incorrect", label: "Incorrect" }],
      rationale: { mode: "optional", maxLength: 500 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6_000,
        minimumValidResponses: 3,
      },
    },
  });
  const assuranceCase = await addAssuranceCase({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    title: "Support response",
    instructions: "Compare the baseline and candidate support responses.",
    baselineArtifactId,
    candidateArtifactId,
  });
  await markAssuranceCaseReady({ principal, caseId: assuranceCase.caseId });
  await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
  const audience = await createAssuranceAudiencePolicy({
    principal,
    projectId,
    policy: {
      reviewerSource: "customer_invited",
      compensation: "unpaid",
      cohorts: [{ cohortId: "employees", minimumReviewers: 1, maximumReviewers: 3 }],
      selection: "customer_named",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [],
      assurance: {
        requirements: [
          {
            capability: "customer_invitation",
            reviewerSources: ["customer_invited"],
            allowedProviders: ["rateloop:invitation"],
          },
        ],
      },
      buyerPrivacy: {
        visibleFields: ["reviewer_source"],
        minimumAggregationSize: 3,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: false,
    },
  });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
  });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "support-agent",
    version: {
      displayName: "Support agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });
  const coverageFixture = await seedAdaptiveCoverage(workspaceId, agent);

  const now = new Date();
  for (const [index, choice] of ["candidate", "baseline"].entries()) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_responses
            (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
             failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
             response_digest, validity, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, 'customer_invited', ?, '[]', '[]',
                    '["customer_invitation"]', ?, 'valid', ?, ?)`,
      args: [
        `response_${index}`,
        run.runId,
        assuranceCase.caseId,
        `reviewer_${index}`,
        choice,
        hash(`response_${index}`),
        now,
        now,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_mechanism_health
          (run_id,workspace_id,project_id,scope_hash,non_gold_case_count,unanimous_case_count,
           valid_response_count,candidate_share_bps,rbts_score_count,eligible_chain_case_count,
           indexed_chain_case_count,rbts_score_mean_bps,rbts_score_variance_bps2,gold_outcome_count,
           gold_failure_count,comparable_drift_bps,observed_at)
          VALUES (?,?,?, ?,1,1,3,6666,0,0,0,NULL,NULL,0,0,NULL,?)`,
    args: [run.runId, workspaceId, projectId, hash("mechanism-scope"), now],
  });

  const suppressed = await getWorkspaceEvaluationDashboard({ accountAddress: OWNER, workspaceId });
  assert.equal(suppressed.runs[0]?.sampleStatus, "suppressed");
  assert.equal(suppressed.runs[0]?.candidateSelectionShareBps, null);
  assert.equal(suppressed.runs[0]?.choices, null);
  assert.equal(suppressed.runs[0]?.mechanismHealth, null);
  assert.equal(suppressed.agents[0]?.attributedRunCount, 0);
  assert.equal(suppressed.summary.attributedRuns, 0);
  assert.deepEqual(suppressed.agents[0]?.adaptiveCoverage, [
    {
      scopeId: coverageFixture.scopeId,
      workflowKey: "support-reply",
      riskTier: "low",
      stage: "high_coverage",
      reviewRateBps: 6_000,
      changes: [
        {
          fromRateBps: 10_000,
          toRateBps: 6_000,
          reason: "two_stable_windows",
          changedAt: "2026-07-16T12:00:00.000Z",
        },
        {
          fromRateBps: 6_000,
          toRateBps: 10_000,
          reason: "agreement_below_threshold",
          changedAt: "2026-07-15T12:00:00.000Z",
        },
        {
          fromRateBps: 10_000,
          toRateBps: 6_000,
          reason: "two_stable_windows",
          changedAt: "2026-07-14T12:00:00.000Z",
        },
      ],
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(suppressed.agents[0]?.adaptiveCoverage),
    /private-adaptive-actor|must-not-enter-coverage-history|arpe_coverage/u,
  );

  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_responses
          (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
           failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
           response_digest, validity, submitted_at, updated_at)
          VALUES ('response_2', ?, ?, 'reviewer_2', 'customer_invited', 'candidate', '[]', '[]',
                  '["customer_invitation"]', ?, 'valid', ?, ?)`,
    args: [run.runId, assuranceCase.caseId, hash("response_2"), now, now],
  });
  const released = await getWorkspaceEvaluationDashboard({ accountAddress: OWNER, workspaceId });
  assert.equal(released.runs[0]?.sampleStatus, "small");
  assert.equal(released.runs[0]?.candidateSelectionShareBps, 6_666);
  assert.deepEqual(released.runs[0]?.mechanismHealth, {
    unanimityRateBps: 10_000,
    rbtsScoreVarianceBps2: null,
    goldFailureRateBps: null,
    comparableDriftBps: null,
  });
  assert.deepEqual(released.runs[0]?.attribution, { status: "unattributed", agentId: null, versionId: null });
  assert.ok(released.runs[0]?.candidateSelectionIntervalBps);
  // Anti-rubber-stamping surfaces: the deterministic explanation flag and the
  // caller's own decision trend (empty for a fresh workspace).
  assert.equal(typeof released.runs[0]?.explanationRequired, "boolean");
  assert.deepEqual(released.deciderTrend, {
    clientDecisions: { total: 0, goCount: 0 },
    overrides: { total: 0, acceptedCount: 0 },
  });

  await assert.rejects(
    () => getWorkspaceEvaluationDashboard({ accountAddress: OUTSIDER, workspaceId }),
    /Workspace not found/,
  );
});
