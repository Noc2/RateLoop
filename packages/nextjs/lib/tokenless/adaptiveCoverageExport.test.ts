import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/account/workspaces/[workspaceId]/assurance/coverage/export/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { __adaptiveCoverageExportTestUtils, exportAdaptiveCoverage } from "~~/lib/tokenless/adaptiveCoverageExport";
import { createWorkspaceAgent, updateWorkspaceAgentCapabilityStatement } from "~~/lib/tokenless/agentRegistry";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const APP_ORIGIN = "https://tokenless.example.test";
const ADMIN = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const OUTSIDER = "0x4444444444444444444444444444444444444444";
const FROM = new Date("2026-07-01T00:00:00.000Z");
const TO = new Date("2026-07-02T00:00:00.000Z");
const SNAPSHOT = new Date("2026-07-03T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_coverage_export_owner_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({
    name: `Coverage export ${label}`,
    ownerAddress: identity.principalId,
  });
  const agent = await createWorkspaceAgent({
    accountAddress: identity.principalId,
    workspaceId,
    externalId: `coverage-export-${label}`,
    version: {
      displayName: `Coverage export ${label}`,
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: "2026-07-16",
      environment: "production",
    },
  });
  const policyId = `arp_coverage_${label}`;
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
      JSON.stringify({
        enforcementMode: "advisory",
        requiredRiskTiers: ["high"],
        criticalRiskTiers: ["critical"],
        minimumConfidenceBps: 7_000,
        maximumLatencyMs: 120_000,
      }),
      JSON.stringify({ reviewerSource: "public_network" }),
      identity.principalId,
      identity.principalId,
      new Date("2026-06-01T00:00:00.000Z"),
    ],
  });
  const binding = await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: identity.principalId,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'admin',?),(?,?,'member',?)`,
    args: [workspaceId, ADMIN, SNAPSHOT, workspaceId, MEMBER, SNAPSHOT],
  });

  const scopeId = `aesc_coverage_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_scopes
          (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,
           workflow_key,risk_tier,audience_policy_hash,partition_commitment,
           execution_profile_hash,execution_profile_json,human_review_binding_id,human_review_binding_version,
           request_profile_id,request_profile_version,request_profile_hash,stage,completed_comparable_cases,
           stable_cases_since_stage,unreviewed_since_last_sample,stage_entered_at,updated_at)
          VALUES (?,?,?,?,?,1,'support-reply','normal',?,?,?,'{}',?,1,?,1,?,
                  'high_coverage',60,30,4,?,?)`,
    args: [
      scopeId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      policyId,
      HASH("a"),
      HASH("b"),
      HASH("c"),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      new Date("2026-06-30T00:00:00.000Z"),
      SNAPSHOT,
    ],
  });

  const opportunityId = `aeop_coverage_${label}`;
  const insertOpportunity = async (id: string, externalId: string, createdAt: Date, ciphertext: string | null) => {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_agent_review_opportunities
            (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
             external_opportunity_id,suggestion_commitment,suggestion_ciphertext,suggestion_key_ref,
             declared_confidence_bps,metadata_commitment,metadata_complete,critical_risk,decision,
             review_rate_bps,selection_probability_bps,sample_bucket,sampler_key_version,sampler_commitment,
             reason_codes_json,status,source_evidence_reference,source_evidence_hash,human_review_binding_id,
             human_review_binding_version,request_profile_id,request_profile_version,request_profile_hash,
             created_at,updated_at)
            VALUES (?,?,?,?,?,?,1,?,?,?,?,6500,?,true,false,'required',5000,10000,1234,
                    'sampler-coverage-v1',?,?,'completed',?,?,?,1,?,1,?,?,?)`,
      args: [
        id,
        workspaceId,
        agent.agentId,
        agent.currentVersion.versionId,
        scopeId,
        policyId,
        externalId,
        HASH("d"),
        ciphertext,
        ciphertext ? "key/coverage-export" : null,
        HASH("e"),
        HASH("f"),
        JSON.stringify(["low_confidence"]),
        `evidence/${id}`,
        HASH("1"),
        binding.bindingId,
        binding.profileId,
        binding.profileHash,
        createdAt,
        createdAt,
      ],
    });
  };
  await insertOpportunity(opportunityId, `external-${label}-inside`, FROM, "private-ciphertext-must-not-export");
  await insertOpportunity(`aeop_coverage_${label}_outside`, `external-${label}-outside`, TO, null);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_observations
          (observation_id,workspace_id,scope_id,opportunity_id,execution_id,operation_key,run_id,
           evidence_reference,source_payload_hash,agent_outcome_commitment,human_outcome_commitment,
           agreement,comparable,responding_human_count,human_human_agreement_bps,latency_ms,cost_atomic,
           finalized_at,created_at)
          VALUES (?,?,?,?,NULL,NULL,NULL,?,?,?,?,'agree',true,3,9200,45000,'3000000',?,?)`,
    args: [
      `aeob_coverage_${label}`,
      workspaceId,
      scopeId,
      opportunityId,
      `evidence/${opportunityId}/result`,
      HASH("2"),
      HASH("3"),
      HASH("4"),
      FROM,
      FROM,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_evaluation_rollups
          (rollup_id,workspace_id,scope_id,window_start,window_end,opportunity_count,reviewed_count,
           comparable_count,agreement_count,agreement_bps,agreement_lower_95_bps,metrics_json,
           source_commitment,rebuilt_at)
          VALUES (?,?,?, ?,?,10,5,5,4,8000,6500,?,?,?)`,
    args: [
      `aeru_coverage_${label}`,
      workspaceId,
      scopeId,
      FROM,
      new Date("2026-07-01T12:00:00.000Z"),
      JSON.stringify({ reviewRateBps: 5_000, stage: "high_coverage" }),
      HASH("5"),
      new Date("2026-07-01T12:01:00.000Z"),
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policy_events
          (event_id,workspace_id,scope_id,policy_id,policy_version,event_type,from_stage,to_stage,
           reason_codes_json,actor_type,actor_reference,event_commitment,created_at)
          VALUES (?,?,?, ?,1,'stage_changed','calibrating','high_coverage',?,'service','adaptive-review',?,?),
                 (?,?,?, ?,1,'forced_review',NULL,NULL,?,'service','adaptive-review',?,?)`,
    args: [
      `arpe_coverage_${label}_stage`,
      workspaceId,
      scopeId,
      policyId,
      JSON.stringify(["two_stable_windows"]),
      HASH("6"),
      new Date("2026-07-01T09:00:00.000Z"),
      `arpe_coverage_${label}_forced`,
      workspaceId,
      scopeId,
      policyId,
      JSON.stringify(["critical_risk"]),
      HASH("7"),
      new Date("2026-07-01T11:00:00.000Z"),
    ],
  });
  return { agent, binding, identity, opportunityId, policyId, scopeId, session, workspaceId };
}

test("owner export is bounded, canonical, complete, and records its digest in the audit chain", async () => {
  const setup = await fixture("service");
  const input = {
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    from: FROM,
    to: TO,
    now: SNAPSHOT,
  };
  const exported = await exportAdaptiveCoverage(input);
  assert.equal(exported.schemaVersion, "rateloop.assurance-coverage-export.v1");
  assert.deepEqual(exported.boundaries, {
    startInclusive: FROM.toISOString(),
    endExclusive: TO.toISOString(),
    snapshotAt: SNAPSHOT.toISOString(),
  });
  assert.deepEqual(
    { ...exported.retention, effectiveAt: undefined },
    {
      schemaVersion: "rateloop.workspace-evidence-retention.v1",
      policyVersion: 1,
      evidenceRetentionMonths: 12,
      auditRetentionMonths: 12,
      minimumRetentionMonths: 6,
      basis: {
        floor: "six_calendar_months",
        reasons: ["eu_ai_act_article_26_6_deployer_log_minimum", "workspace_assurance_evidence_policy"],
      },
      effectiveAt: undefined,
    },
  );
  assert.ok(Number.isFinite(Date.parse(exported.retention.effectiveAt)));
  assert.deepEqual(exported.counts, {
    scopes: 1,
    decisions: 1,
    observations: 1,
    rollups: 1,
    stageTransitions: 1,
  });
  const scope = exported.scopes[0];
  assert.ok(scope);
  assert.equal(scope.scopeId, setup.scopeId);
  assert.equal(scope.currentState.stage, "high_coverage");
  assert.deepEqual(scope.forcedReviewRules, {
    everyEligibleOutput: false,
    manualOwnerHandoff: false,
    criticalRisk: true,
    criticalRiskTiers: ["critical"],
    incompleteMetadata: true,
    requiredRiskTiers: [],
    minimumConfidenceBps: 7_000,
    maximumUnreviewedGap: 20,
    calibrationStage: true,
  });
  assert.deepEqual(scope.decisions[0]?.reasonCodes, ["low_confidence"]);
  assert.equal(scope.observations[0]?.humanHumanAgreementBps, 9_200);
  assert.equal(scope.rollups[0]?.metrics.stage, "high_coverage");
  assert.deepEqual(scope.stageTransitions[0]?.reasonCodes, ["two_stable_windows"]);
  const encoded = JSON.stringify(exported);
  assert.doesNotMatch(encoded, /private-ciphertext-must-not-export/u);
  assert.doesNotMatch(encoded, /outside/u);

  const { exportDigest, ...payload } = exported;
  assert.equal(exportDigest, __adaptiveCoverageExportTestUtils.sha256(payload));
  const attestationJob = await dbClient.execute({
    sql: `SELECT artifact_kind,artifact_digest,state FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_digest=?`,
    args: [setup.workspaceId, exportDigest],
  });
  assert.deepEqual(attestationJob.rows[0], {
    artifact_kind: "coverage_export_head",
    artifact_digest: exportDigest,
    state: "pending",
  });
  const replay = await exportAdaptiveCoverage(input);
  assert.equal(replay.exportDigest, exportDigest);

  const audit = await dbClient.execute({
    sql: `SELECT action,actor_kind,actor_reference,metadata_json
          FROM tokenless_audit_events WHERE workspace_id=? ORDER BY sequence`,
    args: [setup.workspaceId],
  });
  assert.equal(audit.rowCount, 2);
  assert.ok(audit.rows.every(row => row.action === "assurance.coverage_export"));
  assert.ok(audit.rows.every(row => row.actor_kind === "principal"));
  assert.ok(audit.rows.every(row => row.actor_reference === setup.identity.principalId));
  assert.ok(
    audit.rows.every(
      row => (JSON.parse(String(row.metadata_json)) as { exportDigest: string }).exportDigest === exportDigest,
    ),
  );
});

test("the export carries privacy-safe oversight designation summaries without competence free text", async () => {
  const setup = await fixture("oversight");
  const empty = await exportAdaptiveCoverage({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    from: FROM,
    to: TO,
    now: SNAPSHOT,
  });
  assert.deepEqual(empty.oversightDesignations, {
    role: "decision_owner",
    counts: { total: 0, active: 0, expired: 0, revoked: 0 },
    designations: [],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_oversight_attestations
          (attestation_id,workspace_id,account_address,competence_basis,training_records_json,
           authority_scope,attested_by,attested_at,expires_at,status,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)`,
    args: [
      "ovat_coverage_oversight",
      setup.workspaceId,
      ADMIN,
      "Free-text competence basis that must never leave the workspace UI.",
      JSON.stringify([{ name: "Oversight calibration", completedAt: "2026-06-01T00:00:00.000Z", scope: "support" }]),
      "both",
      setup.identity.principalId,
      new Date("2026-06-15T00:00:00.000Z"),
      new Date("2027-06-15T00:00:00.000Z"),
      new Date("2026-06-15T00:00:00.000Z"),
      new Date("2026-06-15T00:00:00.000Z"),
    ],
  });
  const exported = await exportAdaptiveCoverage({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    from: FROM,
    to: TO,
    now: SNAPSHOT,
  });
  assert.deepEqual(exported.oversightDesignations, {
    role: "decision_owner",
    counts: { total: 1, active: 1, expired: 0, revoked: 0 },
    designations: [
      {
        memberReference: ADMIN,
        role: "decision_owner",
        authorityScope: "both",
        status: "active",
        attestedAt: "2026-06-15T00:00:00.000Z",
        expiresAt: "2027-06-15T00:00:00.000Z",
        trainingRecordNames: ["Oversight calibration"],
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(exported), /never leave the workspace UI/u);
});

test("only active workspace owners and admins can export and windows fail closed", async () => {
  const setup = await fixture("authorization");
  const adminExport = await exportAdaptiveCoverage({
    accountAddress: ADMIN,
    workspaceId: setup.workspaceId,
    from: FROM,
    to: TO,
    now: SNAPSHOT,
  });
  assert.equal(adminExport.counts.scopes, 1);
  for (const accountAddress of [MEMBER, OUTSIDER]) {
    await assert.rejects(
      () =>
        exportAdaptiveCoverage({ accountAddress, workspaceId: setup.workspaceId, from: FROM, to: TO, now: SNAPSHOT }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
    );
  }
  await assert.rejects(
    () =>
      exportAdaptiveCoverage({
        accountAddress: setup.identity.principalId,
        workspaceId: setup.workspaceId,
        from: new Date("2025-06-30T00:00:00.000Z"),
        to: TO,
        now: SNAPSHOT,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_coverage_export_window",
  );
});

test("GET returns the authenticated attachment and rejects ambiguous export boundaries", async () => {
  const setup = await fixture("route");
  const path = `/api/account/workspaces/${setup.workspaceId}/assurance/coverage/export`;
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId }) };
  const request = (query = "", token: string | null = setup.session.token) =>
    new NextRequest(`${APP_ORIGIN}${path}${query}`, {
      headers: token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {},
    });

  const response = await GET(
    request(`?from=${encodeURIComponent(FROM.toISOString())}&to=${encodeURIComponent(TO.toISOString())}`),
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="rateloop-assurance-coverage.json"');
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.equal(body.workspaceId, setup.workspaceId);
  assert.equal(body.boundaries.startInclusive, FROM.toISOString());
  assert.equal(body.boundaries.endExclusive, TO.toISOString());

  const unknown = await GET(request("?scope=all"), context);
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).code, "invalid_coverage_export_window");
  const duplicate = await GET(request(`?from=${FROM.toISOString()}&from=${FROM.toISOString()}`), context);
  assert.equal(duplicate.status, 400);
  assert.equal((await duplicate.json()).code, "invalid_coverage_export_window");
  const unauthenticated = await GET(request("", null), context);
  assert.equal(unauthenticated.status, 401);
});

test("the export carries per-agent capability statements with host-reported labeling and no deciding accounts", async () => {
  const setup = await fixture("capability");
  await updateWorkspaceAgentCapabilityStatement({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    agentId: setup.agent.agentId,
    statement: {
      intendedPurpose: "Answer routine support questions.",
      knownLimitations: "Weak on billing disputes.",
      doNotUseConditions: "Never for legal or medical questions.",
    },
    now: new Date("2026-07-01T10:00:00.000Z"),
  });
  const exported = await exportAdaptiveCoverage({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    from: FROM,
    to: TO,
    now: SNAPSHOT,
  });
  assert.equal(exported.capabilityStatements.length, 1);
  const statement = exported.capabilityStatements[0]!;
  assert.equal(statement.agentId, setup.agent.agentId);
  assert.deepEqual(statement.ownerStatement, {
    intendedPurpose: "Answer routine support questions.",
    knownLimitations: "Weak on billing disputes.",
    doNotUseConditions: "Never for legal or medical questions.",
    updatedAt: "2026-07-01T10:00:00.000Z",
  });
  assert.equal(statement.declared.provider, "OpenAI");
  assert.equal(statement.declared.model, "gpt-5");
  assert.equal(statement.declared.verification, "host_reported_not_independently_verified");
  assert.deepEqual(statement.observedScopes, [
    { scopeId: `aesc_coverage_capability`, workflowKey: "support-reply", riskTier: "normal", stage: "high_coverage" },
  ]);
  // The account that stated the capability card never enters the export.
  assert.doesNotMatch(JSON.stringify(exported.capabilityStatements), new RegExp(setup.identity.principalId, "u"));
});
