import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET as getMetrics } from "~~/app/api/assurance/v1/metrics/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  authenticateAssuranceMetricsCredential,
  collectWorkspaceAssuranceMetrics,
  issueAssuranceMetricsCredential,
  listAssuranceMetricsCredentials,
  renderAssuranceOpenMetrics,
  revokeAssuranceMetricsCredential,
  rotateAssuranceMetricsCredential,
} from "~~/lib/tokenless/assuranceMetrics";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function metricsFixture(label: string, owner = OWNER) {
  const { workspaceId } = await createWorkspace({ name: `Metrics ${label}`, ownerAddress: owner });
  const agent = await createWorkspaceAgent({
    accountAddress: owner,
    workspaceId,
    externalId: `metrics-${label}`,
    version: {
      displayName: `Metrics ${label}`,
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-16",
      environment: "production",
    },
  });
  const policyId = `arp_metrics_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
           agreement_threshold_bps,production_floor_bps,fixed_rate_bps,maximum_unreviewed_gap,
           rules_json,audience_policy_json,publishing_policy_id,created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'adaptive',true,8000,1000,NULL,20,?,?,NULL,?,?,?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ enforcementMode: "advisory" }),
      JSON.stringify({ reviewerSource: "public_network" }),
      owner,
      owner,
      new Date("2026-06-01T00:00:00.000Z"),
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: owner,
  });
  const scopeId = `aesc_metrics_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
           workflow_key,risk_tier,audience_policy_hash,partition_commitment,
           execution_profile_hash,execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,completed_comparable_cases,
           stable_cases_since_stage,unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,?,?,?, ?,?,'{}',?,1,?,1,?,
                  'high_coverage',60,30,4,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      `workflow-${label}`,
      "normal",
      HASH("a"),
      HASH("b"),
      HASH("c"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      new Date("2026-06-30T00:00:00.000Z"),
      NOW,
    ],
  });
  const createOpportunity = async (
    suffix: string,
    state: "pending" | "completed" | "blocked" | "approval_required",
  ) => {
    const opportunityId = `aeop_metrics_${label}_${suffix}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,suggestion_ciphertext,suggestion_key_ref,
             declared_confidence_bps,metadata_commitment,metadata_complete,critical_risk,decision,
             review_rate_bps,selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
             reason_codes_json,status,source_evidence_reference,source_evidence_hash,human_review_binding_id,
             human_review_binding_version,request_profile_id,request_profile_version,request_profile_hash,
             created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,NULL,NULL,6500,?,true,false,'required',5000,10000,1234,
                    'sampler-metrics-v1',?,?,'completed',?,?,?,1,?,1,?,?,?)`,
      args: [
        opportunityId,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        scopeId,
        policyId,
        `external-${label}-${suffix}`,
        HASH("d"),
        HASH("e"),
        HASH("f"),
        JSON.stringify(["metrics_test"]),
        `evidence/${opportunityId}`,
        HASH("1"),
        binding.bindingId,
        binding.profileId,
        binding.profileHash,
        new Date(NOW.getTime() - 60_000),
        NOW,
      ],
    });
    const revision = state === "completed" ? 3 : state === "pending" ? 2 : 2;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunity_lifecycles
            (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,
             terminal_at,created_at,updated_at)
            VALUES (?,?,?,?,?, ?,?,?,?)`,
      args: [
        workspaceId,
        opportunityId,
        state,
        revision,
        "[]",
        NOW,
        state === "completed" ? NOW : null,
        new Date(NOW.getTime() - 60_000),
        NOW,
      ],
    });
    const addEvent = async (eventSuffix: string, from: string, to: string, fromRevision: number) => {
      await dbClient.execute({
        sql: `INSERT INTO tokenless_agent_review_opportunity_transition_events
              (event_id,workspace_id,opportunity_id,transition_key,from_state,to_state,from_revision,to_revision,
               reason_codes_json,actor_kind,actor_reference,details_json,transition_commitment,occurred_at)
              VALUES (?,?,?,?,?,?,?,?,?,'service','metrics-test','{}',?,?)`,
        args: [
          `arte_metrics_${label}_${suffix}_${eventSuffix}`,
          workspaceId,
          opportunityId,
          `metrics-${label}-${suffix}-${eventSuffix}`,
          from,
          to,
          fromRevision,
          fromRevision + 1,
          "[]",
          HASH(eventSuffix === "requested" ? "8" : "9"),
          NOW,
        ],
      });
    };
    if (state === "pending" || state === "completed") {
      await addEvent("requested", "request_ready", "pending", 1);
    }
    if (state === "completed") await addEvent("completed", "pending", "completed", 2);
    if (state === "blocked") await addEvent("blocked", "request_ready", "blocked", 1);
    if (state === "approval_required") await addEvent("approval", "evaluating", "approval_required", 1);
    return opportunityId;
  };
  const completed = await createOpportunity("completed", "completed");
  const pending = await createOpportunity("pending", "pending");
  await createOpportunity("blocked", "blocked");
  await createOpportunity("approval", "approval_required");
  for (const [suffix, opportunityId, agreement, latency] of [
    ["agree", completed, "agree", 1_000],
    ["disagree", pending, "disagree", 3_000],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_evaluation_observations
            (observation_id,workspace_id,scope_id,opportunity_id,execution_id,operation_key,run_id,
             evidence_reference,source_payload_hash,agent_outcome_commitment,human_outcome_commitment,
             agreement,comparable,responding_human_count,human_human_agreement_bps,latency_ms,cost_atomic,
             finalized_at,created_at)
            VALUES (?,?,?,?,NULL,NULL,NULL,?,?,?,?,?,true,1,10000,?,'0',?,?)`,
      args: [
        `aeob_metrics_${label}_${suffix}`,
        workspaceId,
        scopeId,
        opportunityId,
        `evidence/${opportunityId}/result`,
        HASH("2"),
        HASH("3"),
        HASH("4"),
        agreement,
        latency,
        NOW,
        NOW,
      ],
    });
  }
  return {
    workspaceId,
    scopeId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    binding,
  };
}

test("metrics credentials are hashed, workspace-bound, rotatable, and revocable", async () => {
  const firstWorkspace = await createWorkspace({ name: "Metrics A", ownerAddress: OWNER });
  const secondWorkspace = await createWorkspace({ name: "Metrics B", ownerAddress: OUTSIDER });
  const issued = await issueAssuranceMetricsCredential({
    accountAddress: OWNER,
    workspaceId: firstWorkspace.workspaceId,
    label: "Production Prometheus",
    now: NOW,
  });
  const stored = await dbClient.execute({
    sql: `SELECT token_hash FROM tokenless_assurance_metrics_credentials WHERE credential_id = ?`,
    args: [issued.credential.credentialId],
  });
  assert.match(String(stored.rows[0].token_hash), /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(stored.rows[0].token_hash, issued.token);
  assert.equal(
    (await authenticateAssuranceMetricsCredential(`Bearer ${issued.token}`, NOW)).workspaceId,
    firstWorkspace.workspaceId,
  );
  await assert.rejects(
    () =>
      issueAssuranceMetricsCredential({
        accountAddress: OWNER,
        workspaceId: secondWorkspace.workspaceId,
        label: "Cross tenant",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 404,
  );

  const rotated = await rotateAssuranceMetricsCredential({
    accountAddress: OWNER,
    workspaceId: firstWorkspace.workspaceId,
    credentialId: issued.credential.credentialId,
    now: new Date(NOW.getTime() + 1_000),
  });
  await assert.rejects(
    () => authenticateAssuranceMetricsCredential(`Bearer ${issued.token}`),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 401,
  );
  assert.equal(
    (await authenticateAssuranceMetricsCredential(`Bearer ${rotated.token}`)).workspaceId,
    firstWorkspace.workspaceId,
  );
  const listed = await listAssuranceMetricsCredentials({
    accountAddress: OWNER,
    workspaceId: firstWorkspace.workspaceId,
  });
  assert.deepEqual(listed.map(item => item.status).sort(), ["active", "rotated"]);
  assert.equal(JSON.stringify(listed).includes(rotated.token), false);

  await revokeAssuranceMetricsCredential({
    accountAddress: OWNER,
    workspaceId: firstWorkspace.workspaceId,
    credentialId: rotated.credential.credentialId,
    now: new Date(NOW.getTime() + 2_000),
  });
  await assert.rejects(
    () => authenticateAssuranceMetricsCredential(`Bearer ${rotated.token}`),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 401,
  );
});

test("workspace SQL aggregation preserves tenant isolation and metric semantics", async () => {
  const first = await metricsFixture("tenant_a");
  const second = await metricsFixture("tenant_b", OUTSIDER);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_attestation_jobs
          (job_id,workspace_id,artifact_kind,artifact_schema_version,artifact_digest,boundary_at,
           statement_json,state,signer_key_id,dsse_envelope_json,rekor_entry_uuid,rekor_log_index,
           rekor_bundle_json,attempt_count,next_attempt_at,created_at,updated_at,completed_at)
          VALUES (?,?, 'decision_packet','rateloop.assurance-evidence.v3',?,?, '{}','completed',
                  'managed-key','{}','rekor-entry','1','{}',1,?,?,?,?)`,
    args: [
      `aat_${"1".repeat(40)}`,
      first.workspaceId,
      HASH("9"),
      new Date(NOW.getTime() - 60_000),
      NOW,
      new Date(NOW.getTime() - 60_000),
      NOW,
      new Date(NOW.getTime() - 30_000),
    ],
  });
  const snapshot = await collectWorkspaceAssuranceMetrics({ workspaceId: first.workspaceId, now: NOW });
  assert.equal(snapshot.reviewsRequested, 2);
  assert.equal(snapshot.reviewsCompleted, 1);
  assert.equal(snapshot.blocked, 1);
  assert.equal(snapshot.approvalRequired, 1);
  assert.equal(snapshot.scopes.length, 1);
  assert.equal(snapshot.scopes[0].scope, first.scopeId);
  assert.notEqual(snapshot.scopes[0].scope, second.scopeId);
  assert.equal(snapshot.scopes[0].requested / snapshot.scopes[0].eligible, 0.5);
  assert.equal(snapshot.scopes[0].disagreements / snapshot.scopes[0].comparable, 0.5);
  assert.equal(snapshot.scopes[0].latencyMilliseconds / snapshot.scopes[0].latencyCount / 1_000, 2);
  assert.deepEqual(snapshot.evidenceAnchor, { state: "completed", lagSeconds: 30 });
  // Without override records the rate is null, never a misleading zero.
  assert.deepEqual(snapshot.overrideDecisions, { decided: 0, overridden: 0, reversed: 0, overrideRateBps: null });

  const issued = await issueAssuranceMetricsCredential({
    accountAddress: OWNER,
    workspaceId: first.workspaceId,
    label: "Prometheus",
    now: NOW,
  });
  const response = await getMetrics(
    new NextRequest("https://tokenless.example.test/api/assurance/v1/metrics", {
      headers: { authorization: `Bearer ${issued.token}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.match(response.headers.get("content-type") ?? "", /^application\/openmetrics-text; version=1\.0\.0/u);
  const output = await response.text();
  assert.match(output, new RegExp(first.scopeId, "u"));
  assert.doesNotMatch(output, new RegExp(second.scopeId, "u"));
});

test("feedback profiles contribute no assurance metrics", async () => {
  const setup = await metricsFixture("feedback");
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_review_request_profiles
          SET question_authority='agent_per_request',result_semantics='feedback',
              criterion=NULL,positive_label=NULL,negative_label=NULL
          WHERE workspace_id=? AND profile_id=?`,
    args: [setup.workspaceId, setup.binding.profileId],
  });

  const snapshot = await collectWorkspaceAssuranceMetrics({ workspaceId: setup.workspaceId, now: NOW });
  assert.equal(snapshot.reviewsRequested, 0);
  assert.equal(snapshot.reviewsCompleted, 0);
  assert.equal(snapshot.blocked, 0);
  assert.equal(snapshot.approvalRequired, 0);
  assert.deepEqual(snapshot.scopes, []);
});

test("scope series are capped at the fixed low-cardinality limit and expose truncation", async () => {
  const setup = await metricsFixture("cardinality");
  for (let index = 0; index < 100; index += 1) {
    const suffix = index.toString().padStart(3, "0");
    const scopeId = `aesc_metrics_cardinality_${suffix}`;
    const opportunityId = `aeop_metrics_cardinality_${suffix}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_evaluation_scopes
            (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
             workflow_key,risk_tier,audience_policy_hash,partition_commitment,
             execution_profile_hash,execution_profile_json,human_review_binding_id,human_review_binding_version,
             request_profile_id,request_profile_version,request_profile_hash,stage,completed_comparable_cases,
             stable_cases_since_stage,unreviewed_since_last_sample,stage_entered_at,updated_at)
            VALUES (?,?,?,?,?,1,?,?,?, ?,?,'{}',?,1,?,1,?,
                    'monitoring',60,30,4,?,?)`,
      args: [
        scopeId,
        setup.workspaceId,
        setup.agentId,
        setup.agentVersionId,
        setup.policyId,
        `cardinality-${suffix}`,
        "normal",
        HASH("a"),
        HASH("b"),
        HASH("c"),
        setup.binding.bindingId,
        setup.binding.profileId,
        setup.binding.profileHash,
        NOW,
        NOW,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,suggestion_ciphertext,suggestion_key_ref,
             declared_confidence_bps,metadata_commitment,metadata_complete,critical_risk,decision,
             review_rate_bps,selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
             reason_codes_json,status,source_evidence_reference,source_evidence_hash,human_review_binding_id,
             human_review_binding_version,request_profile_id,request_profile_version,request_profile_hash,
             created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,NULL,NULL,6500,?,true,false,'skip',1000,0,1234,
                    'sampler-cardinality-v1',?,?,'skipped',?,?,?,1,?,1,?,?,?)`,
      args: [
        opportunityId,
        setup.workspaceId,
        setup.agentId,
        setup.agentVersionId,
        scopeId,
        setup.policyId,
        `external-cardinality-${suffix}`,
        HASH("d"),
        HASH("e"),
        HASH("f"),
        "[]",
        `evidence/${opportunityId}`,
        HASH("1"),
        setup.binding.bindingId,
        setup.binding.profileId,
        setup.binding.profileHash,
        NOW,
        NOW,
      ],
    });
  }
  const snapshot = await collectWorkspaceAssuranceMetrics({ workspaceId: setup.workspaceId, now: NOW });
  assert.equal(snapshot.scopes.length, 100);
  assert.equal(snapshot.scopesTruncated, true);
  assert.match(renderAssuranceOpenMetrics(snapshot), /rateloop_assurance_scope_series_truncated 1/u);
});

test("OpenMetrics uses bounded labels and represents a missing evidence anchor as absent, never zero", () => {
  const output = renderAssuranceOpenMetrics({
    windowSeconds: 2_592_000,
    reviewsRequested: 2,
    reviewsCompleted: 1,
    blocked: 1,
    approvalRequired: 1,
    scopesTruncated: false,
    overrideDecisions: { decided: 2, overridden: 1, reversed: 0, overrideRateBps: 5_000 },
    evidenceAnchor: { state: "absent", lagSeconds: null },
    scopes: [
      {
        scope: 'aesc_scope_"one',
        stage: "high_coverage",
        eligible: 4,
        requested: 2,
        completed: 1,
        blocked: 1,
        approvalRequired: 1,
        comparable: 2,
        disagreements: 1,
        latencyCount: 2,
        latencyMilliseconds: 4_000,
      },
    ],
  });
  assert.match(
    output,
    /rateloop_assurance_sampling_rate_ratio\{scope="aesc_scope_\\"one",stage="high_coverage"\} 0\.5/u,
  );
  assert.match(output, /rateloop_assurance_verdict_latency_seconds\{[^\n]+\} 2/u);
  assert.match(output, /rateloop_assurance_disagreement_ratio\{[^\n]+\} 0\.5/u);
  assert.match(output, /rateloop_assurance_evidence_anchor_lag_seconds\{state="absent"\} NaN/u);
  assert.doesNotMatch(output, /rateloop_assurance_evidence_anchor_lag_seconds(?:\{[^}]+\})? 0(?:\n|$)/u);
  assert.doesNotMatch(output, /workspace=|agent=|workflow=|reason=/u);
  assert.equal(output.match(/# HELP rateloop_assurance_sampling_rate_ratio /gu)?.length, 1);
  assert.match(output, /# EOF\n$/u);
});

test("OpenMetrics reports a real evidence-anchor state and lag", () => {
  const output = renderAssuranceOpenMetrics({
    windowSeconds: 2_592_000,
    reviewsRequested: 0,
    reviewsCompleted: 0,
    blocked: 0,
    approvalRequired: 0,
    scopesTruncated: false,
    overrideDecisions: { decided: 0, overridden: 0, reversed: 0, overrideRateBps: null },
    evidenceAnchor: { state: "pending", lagSeconds: 75 },
    scopes: [],
  });
  assert.match(output, /rateloop_assurance_evidence_anchor_lag_seconds\{state="pending"\} 75/u);
});
