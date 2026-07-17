import {
  canonicalizeEvidenceValue,
  computeEvidenceAggregation,
  evidenceSigningKeyId,
  sha256EvidenceValue,
} from "../../scripts/assurance-evidence-core.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { exportAdaptiveCoverage } from "~~/lib/tokenless/adaptiveCoverageExport";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { collectWorkspaceAssuranceMetrics } from "~~/lib/tokenless/assuranceMetrics";
import {
  assertEvidenceGenerationRequest,
  generateAssuranceEvidencePacket,
  getAssuranceClientDecision,
  getAssuranceEvidencePacket,
  listAssuranceOverrideDecisions,
  recordAssuranceClientDecision,
  recordAssuranceOverrideDecision,
  verifyEvidenceExport,
} from "~~/lib/tokenless/evidencePackets";
import { canonicalizeHumanAssuranceDocument, hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const DECISION_OWNER = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const TENANT_KEY = Buffer.alloc(32, 7);
const NOW = new Date("2026-07-13T12:00:00.000Z");

type SourceFixture = {
  source: "customer_invited" | "rateloop_network";
  targetCount: number;
  paid?: boolean;
  responses: { choice: "baseline" | "candidate" | "tie"; validity: "valid" | "invalid" | "pending" }[];
};

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

test("aggregation keeps reviewer targets separate from multi-case judgments", () => {
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 6000,
    minimumValidResponses: 2,
  };
  const source = {
    source: "customer_invited",
    targetReviewerCount: 3,
    assignedReviewerCount: 3,
    paidReviewerCount: 0,
    respondingReviewerCount: 3,
    completeJudgmentSetReviewerCount: 3,
  };
  const caseCounts = (caseId: string, candidate: number, baseline: number) => ({
    caseId,
    overall: {
      targetReviewerCount: 3,
      assignedReviewerCount: 3,
      validReviewerCount: 3,
      invalidJudgmentCount: 0,
      pendingJudgmentCount: 0,
      suppressed: false,
      candidate,
      baseline,
      tie: 0,
    },
    sourceCounts: [
      {
        source: "customer_invited",
        targetReviewerCount: 3,
        assignedReviewerCount: 3,
        validReviewerCount: 3,
        invalidJudgmentCount: 0,
        pendingJudgmentCount: 0,
        suppressed: false,
        candidate,
        baseline,
        tie: 0,
      },
    ],
  });
  const aggregation = computeEvidenceAggregation(
    { reviewerSources: [source], cases: [caseCounts("case_a", 2, 1), caseCounts("case_b", 1, 2)] },
    2,
    passRule,
  );
  assert.equal(aggregation.reviewerCoverage.targetReviewerCount, 3);
  assert.equal(aggregation.reviewerCoverage.respondingReviewerCount, 3);
  assert.equal(aggregation.judgmentCoverage.caseCount, 2);
  assert.equal(aggregation.judgmentCoverage.targetExpectedJudgmentCount, 6);
  assert.equal(aggregation.judgmentCoverage.submittedJudgmentCount, 6);
  assert.equal(aggregation.cases[0].preference.candidateShareBps, 6667);
  assert.equal(aggregation.cases[1].preference.candidateShareBps, 3333);
  assert.equal(aggregation.suite.outcome, "fail");
  assert.equal("preference" in aggregation.reviewerCoverage, false);
  assert.doesNotMatch(JSON.stringify(aggregation), /wilson|interval/i);
});

function address(index: number) {
  return `0x${(1000 + index).toString(16).padStart(40, "0")}`;
}

async function insert(sql: string, args: unknown[]) {
  await dbClient.execute({ sql, args });
}

async function seedEvidenceFixture(input: {
  compensation: "paid" | "unpaid" | "mixed";
  minimumAggregationSize: number;
  sources: SourceFixture[];
  withChain?: boolean;
}) {
  const { workspaceId } = await createWorkspace({ name: "Evidence workspace", ownerAddress: OWNER });
  const projectId = "project_evidence";
  const suiteId = "suite_evidence";
  const rubricId = "rubric_evidence";
  const policyId = "policy_evidence";
  const runId = "run_evidence";
  const caseId = "case_evidence";
  const contentId = `0x${"ab".repeat(32)}`;
  const admissionPolicyHash = `0x${"cd".repeat(32)}`;
  const passRule = {
    metric: "candidate_preference_share_bps",
    operator: "gte",
    thresholdBps: 6000,
    minimumValidResponses: 3,
  };
  const rubric = { prompt: "Which is better?", failureTags: [], rationale: { mode: "optional" }, passRule };
  const suiteManifest = { kind: "suite_manifest", projectId, suiteId, version: 1, rubric, cases: [{ caseId }] };
  const suiteManifestHash = hashHumanAssuranceDocument(suiteManifest);
  const reviewerSource = input.sources.length > 1 ? "hybrid" : input.sources[0].source;
  const policy = {
    schemaVersion: "human-assurance-v1",
    policyId,
    version: 1,
    reviewerSource,
    compensation: input.compensation,
    cohorts: input.sources.map((source, index) => ({
      cohortId: `cohort_${index}`,
      minimumReviewers: source.targetCount,
    })),
    selection: "customer_named",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: { requirements: [] },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: input.minimumAggregationSize,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: input.compensation !== "unpaid",
  };
  const policyHash = hashHumanAssuranceDocument(policy);
  const runManifest = {
    schemaVersion: "human-assurance-run-orchestration-v1",
    kind: "run_orchestration_manifest",
    runId,
    projectId,
    suite: { suiteId, version: 1, manifestHash: suiteManifestHash },
    rubric: { rubricId, version: 1, passRule },
    audiencePolicy: { policyId, version: 1, manifestHash: policyHash, admissionPolicyHash },
  };
  const runManifestHash = hashHumanAssuranceDocument(runManifest);

  await insert(
    `INSERT INTO tokenless_assurance_projects
     (project_id, workspace_id, name, data_classification, status, retention_days, created_by, created_at, updated_at)
     VALUES (?, ?, 'Evidence project', 'confidential', 'active', 30, ?, ?, ?)`,
    [projectId, workspaceId, OWNER, NOW, NOW],
  );
  for (const [artifactId, role, marker] of [
    ["artifact_a", "baseline", "a"],
    ["artifact_b", "candidate", "b"],
  ] as const) {
    await insert(
      `INSERT INTO tokenless_assurance_artifacts
       (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
        redaction_status, renderer_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'application/json', 10, ?, 'approved', 'safe_json', ?, ?)`,
      [artifactId, projectId, role, role, `sha256:${marker.repeat(64)}`, `private:${artifactId}`, NOW, NOW],
    );
  }
  await insert(
    `INSERT INTO tokenless_assurance_rubrics
     (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json,
      pass_rule_json, rubric_json, created_at)
     VALUES (?, ?, 1, ?, '[]', ?, ?, ?, ?)`,
    [
      rubricId,
      projectId,
      rubric.prompt,
      JSON.stringify(rubric.rationale),
      JSON.stringify(passRule),
      JSON.stringify(rubric),
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_suites
     (suite_id, project_id, name, version, status, rubric_id, rubric_version,
      manifest_hash, manifest_json, frozen_at, created_at, updated_at)
     VALUES (?, ?, 'Evidence suite', 1, 'frozen', ?, 1, ?, ?, ?, ?, ?)`,
    [suiteId, projectId, rubricId, suiteManifestHash, canonicalizeHumanAssuranceDocument(suiteManifest), NOW, NOW, NOW],
  );
  await insert(
    `INSERT INTO tokenless_assurance_cases
     (case_id, project_id, suite_id, suite_version, position, title, instructions,
      baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json,
      status, created_at, updated_at, deterministic_checks_json)
     VALUES (?, ?, ?, 1, 1, 'Case', 'Compare', 'artifact_a', 'artifact_b', '[]', 'ready', ?, ?, '[]')`,
    [caseId, projectId, suiteId, NOW, NOW],
  );
  await insert(
    `INSERT INTO tokenless_assurance_audience_policies
     (policy_id, project_id, version, reviewer_source, compensation, cohorts_json, selection,
      fallbacks_json, required_qualifications_json, assurance_json, buyer_privacy_json,
      legal_eligibility_required, policy_hash, policy_json, created_at)
     VALUES (?, ?, 1, ?, ?, ?, 'customer_named', ?, '[]', ?, ?, ?, ?, ?, ?)`,
    [
      policyId,
      projectId,
      reviewerSource,
      input.compensation,
      JSON.stringify(policy.cohorts),
      JSON.stringify(policy.fallbacks),
      JSON.stringify(policy.assurance),
      JSON.stringify(policy.buyerPrivacy),
      input.compensation !== "unpaid",
      policyHash,
      canonicalizeHumanAssuranceDocument(policy),
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_runs
     (run_id, project_id, suite_id, suite_version, audience_policy_id, audience_policy_version,
      status, policy_hash, manifest_hash, manifest_json, created_by, created_at, updated_at, frozen_at, completed_at)
     VALUES (?, ?, ?, 1, ?, 1, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      projectId,
      suiteId,
      policyId,
      policyHash,
      runManifestHash,
      canonicalizeHumanAssuranceDocument(runManifest),
      OWNER,
      NOW,
      NOW,
      NOW,
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_assurance_run_cases
     (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
      blinding_commitment, blinding_secret_json, deterministic_checks_json,
      deterministic_checks_hash, deterministic_checks_status, content_id,
      admission_policy_hash, round_id, round_status, created_at, updated_at)
     VALUES (?, ?, 1, 'artifact_a', 'artifact_b', ?, '{}', '[]', ?, 'not_applicable', ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      caseId,
      hashHumanAssuranceDocument({ swap: false }),
      hashHumanAssuranceDocument([]),
      contentId,
      admissionPolicyHash,
      input.withChain ? "42" : null,
      input.withChain ? "terminal" : "offchain_complete",
      NOW,
      NOW,
    ],
  );

  let reviewerIndex = 0;
  for (const [sourceIndex, source] of input.sources.entries()) {
    const paidSource = source.paid ?? input.compensation === "paid";
    const cohortId = `cohort_${sourceIndex}`;
    const subpanelId = `subpanel_${sourceIndex}`;
    await insert(
      `INSERT INTO tokenless_assurance_cohorts
       (cohort_id, project_id, name, source, selection, capacity, active_reservations,
        qualification_rules_json, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'customer_named', ?, 0, '[]', 'active', ?, ?, ?)`,
      [cohortId, projectId, cohortId, source.source, source.targetCount, OWNER, NOW, NOW],
    );
    await insert(
      `INSERT INTO tokenless_assurance_run_subpanels
       (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
        target_count, active_reservations, policy_id, policy_version, policy_hash, run_manifest_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'customer_named', ?, 0, ?, 1, ?, ?, ?)`,
      [
        subpanelId,
        workspaceId,
        projectId,
        runId,
        cohortId,
        source.source,
        source.targetCount,
        policyId,
        policyHash,
        runManifestHash,
        NOW,
      ],
    );
    for (let index = 0; index < source.targetCount; index += 1) {
      const reviewer = address(++reviewerIndex);
      await insert(
        `INSERT INTO tokenless_assurance_cohort_reviewers
         (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
          maximum_active_assignments, active_reservations, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, '[]', 1, 0, 'active', ?, ?, ?)`,
        [projectId, cohortId, reviewer, OWNER, NOW, NOW],
      );
      await insert(
        `INSERT INTO tokenless_assurance_assignments
         (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
          reviewer_account_address, source, selection, status, confidentiality_terms_hash,
          confidentiality_accepted_at, qualification_provenance_json,
          assurance_snapshot_json, assurance_snapshot_hash, blinding_json,
          paid_assignment, paid_eligibility_checked_at, reservation_expires_at,
          assignment_expires_at, lease_issuer_account_address, lease_state,
          created_at, accepted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'customer_named', 'completed', ?, ?, '[]',
                 '{"assertions":[],"qualifications":[]}',
                 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                 '{"swap":false}',
                 ?, ?, ?, ?, ?, 'expired', ?, ?, ?)`,
        [
          `assignment_${sourceIndex}_${index}`,
          workspaceId,
          projectId,
          runId,
          subpanelId,
          cohortId,
          reviewer,
          source.source,
          hashHumanAssuranceDocument({ confidentiality: true }),
          NOW,
          paidSource,
          paidSource ? NOW : null,
          new Date(NOW.getTime() + 60_000),
          new Date(NOW.getTime() + 60_000),
          OWNER,
          NOW,
          NOW,
          NOW,
        ],
      );
      const response = source.responses[index];
      if (response) {
        await insert(
          `INSERT INTO tokenless_assurance_responses
           (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
            failure_tag_keys_json, rationale_ciphertext, rationale_key_ref,
            qualification_keys_json, assurance_capabilities_json, response_digest,
            settlement_reference, validity, submitted_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, ?)`,
          [
            `response_${sourceIndex}_${index}`,
            runId,
            caseId,
            reviewer,
            source.source,
            response.choice,
            response.choice === "baseline" ? '["regression"]' : "[]",
            `ciphertext:private-rationale-${sourceIndex}-${index}`,
            `key:${sourceIndex}:${index}`,
            hashHumanAssuranceDocument({ sourceIndex, index, response }),
            paidSource ? `https://sepolia.basescan.org/tx/0x${"88".repeat(32)}` : null,
            response.validity,
            NOW,
            NOW,
          ],
        );
      }
    }
  }

  if (input.withChain) {
    await insert(
      `INSERT INTO tokenless_agent_quotes
       (quote_id, request_hash, request_json, response_json, expires_at, created_at)
       VALUES ('quote_evidence', 'hash', '{}', '{}', ?, ?)`,
      [new Date(NOW.getTime() + 60_000), NOW],
    );
    await insert(
      `INSERT INTO tokenless_agent_asks
       (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
        status, created_at, updated_at)
       VALUES ('operation_evidence', 'idem_evidence', 'hash', 'quote_evidence', '{}', '{}', 'completed', ?, ?)`,
      [NOW, NOW],
    );
    await insert(
      `INSERT INTO tokenless_chain_executions
       (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
        deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
        funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic,
        state, submission_transaction_hash, round_id, receipt_block_number, receipt_block_hash,
        created_at, updated_at, confirmed_at)
       VALUES ('execution_evidence', 'operation_evidence', 'prepaid', 'payment_evidence',
               'tokenless-v2:test', 84532, 123, ?, ?, ?, ?, ?, ?, ?, '{}', 1000,
               'confirmed', ?, 42, 456, ?, ?, ?, ?)`,
      [
        `0x${"11".repeat(20)}`,
        `0x${"22".repeat(20)}`,
        `0x${"33".repeat(20)}`,
        `0x${"44".repeat(20)}`,
        `0x${"55".repeat(20)}`,
        contentId,
        hashHumanAssuranceDocument({ terms: true }),
        `0x${"66".repeat(32)}`,
        `0x${"77".repeat(32)}`,
        NOW,
        NOW,
        NOW,
      ],
    );
    await insert(
      `INSERT INTO tokenless_transparency_events
       (event_id, operation_key, workspace_id, deployment_key, round_id, sequence,
        event_type, evidence_hash, evidence_json, occurred_at, recorded_at)
       VALUES ('event_evidence', 'operation_evidence', ?, 'tokenless-v2:test', 42, 1,
               'round.finalized', ?, '{"private":"not exported"}', ?, ?)`,
      [workspaceId, hashHumanAssuranceDocument({ event: "settled" }), NOW, NOW],
    );
  }

  return {
    workspaceId,
    runId,
    admissionPolicyHash,
    reviewerAddresses: Array.from({ length: reviewerIndex }, (_, index) => address(index + 1)),
  };
}

async function bindPersistedAgentReviewContext(input: {
  workspaceId: string;
  runId: string;
  enforcementMode: "advisory" | "host_enforced";
  reasonCodes: string[];
}) {
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId: input.workspaceId,
    externalId: "evidence-context-agent",
    version: {
      displayName: "Evidence context agent",
      provider: "OpenAI",
      model: "gpt-test",
      modelVersion: "2026-07-17",
      environment: "production",
    },
  });
  const selectionPolicyId = "rpol_evidence_context";
  const selectionPolicyVersion = 3;
  await insert(
    `INSERT INTO tokenless_agent_review_policies
     (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
      agreement_threshold_bps,production_floor_bps,maximum_unreviewed_gap,rules_json,
      audience_policy_json,created_by,approved_by,created_at)
     VALUES (?,3,?,?,?,'adaptive',true,7000,1000,20,?,
             '{"reviewerSource":"public_network"}',?,?,?)`,
    [
      selectionPolicyId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify({ enforcementMode: input.enforcementMode }),
      OWNER,
      OWNER,
      NOW,
    ],
  );
  const binding = await seedReadyHumanReviewBinding({
    workspaceId: input.workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId: selectionPolicyId,
    policyVersion: selectionPolicyVersion,
    actor: OWNER,
  });
  const scopeId = "scope_evidence_context";
  await insert(
    `INSERT INTO tokenless_agent_evaluation_scopes
     (scope_id,workspace_id,agent_id,agent_version_id,policy_id,policy_version,workflow_key,risk_tier,
      audience_policy_hash,execution_profile_hash,execution_profile_json,human_review_binding_id,
      human_review_binding_version,request_profile_id,request_profile_version,request_profile_hash,
      partition_commitment,stage,completed_comparable_cases,stable_cases_since_stage,
      unreviewed_since_last_sample,stage_entered_at,updated_at)
     VALUES (?,?,?,?,?,3,'release','critical',?,?,?, ?,1,?,1,?,?,'monitoring',30,12,0,?,?)`,
    [
      scopeId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      selectionPolicyId,
      hashHumanAssuranceDocument({ audience: "public_network" }),
      hashHumanAssuranceDocument({ model: "gpt-test" }),
      JSON.stringify({ schemaVersion: "rateloop.execution-profile.v1", model: "gpt-test" }),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      hashHumanAssuranceDocument({ scopeId }),
      NOW,
      NOW,
    ],
  );
  const opportunityId = "aop_evidence_context";
  await insert(
    `INSERT INTO tokenless_agent_review_opportunities
     (opportunity_id,workspace_id,agent_id,agent_version_id,scope_id,policy_id,policy_version,
      external_opportunity_id,suggestion_commitment,declared_confidence_bps,metadata_commitment,
      metadata_complete,critical_risk,decision,review_rate_bps,selection_probability_bps,sample_bucket,
      sampler_key_version,sampler_commitment,reason_codes_json,status,run_id,source_evidence_reference,
      source_evidence_hash,human_review_binding_id,human_review_binding_version,request_profile_id,
      request_profile_version,request_profile_hash,created_at,updated_at)
     VALUES (?,?,?,?,?,?,3,'release-0001',?,6500,?,true,true,'required',1000,10000,42,
             'sampler-v1',?,?,'completed',?,'release/0001',?,?,1,?,1,?,?,?)`,
    [
      opportunityId,
      input.workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      scopeId,
      selectionPolicyId,
      hashHumanAssuranceDocument({ suggestion: "release" }),
      hashHumanAssuranceDocument({ metadata: "critical" }),
      hashHumanAssuranceDocument({ sample: 42 }),
      JSON.stringify(input.reasonCodes),
      input.runId,
      hashHumanAssuranceDocument({ source: "release-0001" }),
      binding.bindingId,
      binding.profileId,
      binding.profileHash,
      NOW,
      NOW,
    ],
  );
  await insert(
    `INSERT INTO tokenless_agent_review_opportunity_lifecycles
     (workspace_id,opportunity_id,state,state_revision,reason_codes_json,state_entered_at,terminal_at,
      created_at,updated_at)
     VALUES (?,?,'completed',3,?, ?,?,?,?)`,
    [input.workspaceId, opportunityId, JSON.stringify(input.reasonCodes), NOW, NOW, NOW, NOW],
  );
  const eventId = "hrtr_evidence_context_terminal";
  const transitionCommitment = hashHumanAssuranceDocument({ opportunityId, terminal: "completed", revision: 3 });
  await insert(
    `INSERT INTO tokenless_agent_review_opportunity_transition_events
     (event_id,workspace_id,opportunity_id,transition_key,from_state,to_state,from_revision,to_revision,
      reason_codes_json,actor_kind,actor_reference,details_json,transition_commitment,occurred_at)
     VALUES (?,?,?,'pending:completed:evidence','pending','completed',2,3,?,'service',
             'evidence-context-test','{}',?,?)`,
    [eventId, input.workspaceId, opportunityId, JSON.stringify(input.reasonCodes), transitionCommitment, NOW],
  );
  return { binding, eventId, opportunityId, selectionPolicyId, selectionPolicyVersion, transitionCommitment };
}

test("evidence derives private aggregates, verifies only against trusted pins, and is reproducible offline", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 3,
    sources: [
      {
        source: "customer_invited",
        targetCount: 6,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
          { choice: "baseline", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    now: NOW,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  assert.equal(packet.payload.schemaVersion, "rateloop.human-assurance.evidence.v3");
  assert.deepEqual(packet.payload.reviewContext.selectionTrigger, {
    kind: "owner_required",
    source: "explicit_workspace_assurance_run",
    reasonCodes: ["explicit_workspace_assurance_run"],
  });
  assert.deepEqual(packet.payload.reviewContext.gate, {
    type: "not_applicable",
    policyReference: null,
    stopGateEvidenceReference: null,
    statement: "This workspace-started assurance run was not bound to an agent output stop gate.",
  });
  assert.equal(packet.payload.reviewContext.versions.audiencePolicy.version, 1);
  assert.deepEqual(packet.payload.reviewContext.versions.admissionPolicies, [
    {
      admissionPolicyHash: `0x${"cd".repeat(32)}`,
      derivedFrom: {
        kind: "assurance_audience_policy",
        id: "policy_evidence",
        version: 1,
        hash: packet.payload.frozen.policyHash,
      },
    },
  ]);
  assert.deepEqual(packet.payload.frozen.admissionPolicies, packet.payload.reviewContext.versions.admissionPolicies);
  assert.deepEqual(packet.payload.reviewContext.reviewerQualifications, {
    taxonomy: "explicit_qualification_categories",
    orderedTiers: false,
    minimumAggregationSize: 3,
    categories: [],
    unqualified: { suppressed: false, reviewerCount: 6 },
  });
  assert.deepEqual(packet.payload.reviewContext.period.coverage, {
    caseCount: 1,
    targetExpectedJudgmentCount: 6,
    submittedJudgmentCount: 6,
    respondingReviewerCount: 6,
    targetReviewerCount: 6,
  });
  assert.deepEqual(packet.payload.reviewContext.period.responseSubmissionLatencyFromPeriodStartMs, {
    count: 6,
    minimum: 0,
    median: 0,
    p95: 0,
    maximum: 0,
  });
  assert.equal(packet.payload.aggregation.reviewerCoverage.targetReviewerCount, 6);
  assert.equal(packet.payload.aggregation.reviewerCoverage.respondingReviewerCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.targetExpectedJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.submittedJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.validJudgmentCount, 6);
  assert.equal(packet.payload.aggregation.judgmentCoverage.invalidJudgmentCount, 0);
  assert.equal(packet.payload.aggregation.judgmentCoverage.missingTargetJudgmentCount, 0);
  assert.equal(packet.payload.aggregation.cases[0].preference.candidateShareBps, 5000);
  assert.equal(packet.payload.aggregation.cases[0].preference.method, "descriptive_case_share");
  assert.equal(packet.payload.aggregation.suite.outcome, "fail");
  assert.doesNotMatch(JSON.stringify(packet.payload.aggregation), /wilson|interval/i);
  assert.equal(packet.payload.settlement.mode, "no_onchain_settlement_unpaid_invited");
  assert.equal(packet.payload.settlement.links.length, 0);
  assert.match(packet.payload.tenantCommitment, /^hmac-sha256:[0-9a-f]{64}$/);
  const attestationJob = await dbClient.execute({
    sql: `SELECT artifact_kind,artifact_digest,state FROM tokenless_assurance_attestation_jobs
          WHERE workspace_id=? AND artifact_digest=?`,
    args: [fixture.workspaceId, packet.packetDigest],
  });
  assert.deepEqual(attestationJob.rows[0], {
    artifact_kind: "decision_packet",
    artifact_digest: packet.packetDigest,
    state: "pending",
  });
  const serialized = JSON.stringify(packet);
  assert.doesNotMatch(serialized, new RegExp(fixture.workspaceId));
  assert.doesNotMatch(serialized, /ciphertext:private-rationale|key:0:0/);
  for (const reviewer of fixture.reviewerAddresses) assert.doesNotMatch(serialized, new RegExp(reviewer));

  assert.deepEqual(verifyEvidenceExport(packet).errors, ["missing_trust_anchor"]);
  const trusted = verifyEvidenceExport(packet, {
    expectedPublicKey: packet.signing.publicKey,
    expectedKeyId: packet.signing.keyId,
  });
  assert.equal(trusted.valid, true);
  const semanticallyInvalidPayload = structuredClone(packet.payload);
  semanticallyInvalidPayload.reviewContext.gate.type = "advisory";
  const semanticallyInvalidDocument = { payload: semanticallyInvalidPayload, signing: packet.signing };
  const semanticallyInvalidPacket = {
    ...semanticallyInvalidDocument,
    packetDigest: sha256EvidenceValue(semanticallyInvalidDocument),
    signature: sign(
      null,
      Buffer.from(canonicalizeEvidenceValue(semanticallyInvalidDocument)),
      signer.privateKey,
    ).toString("base64url"),
  };
  assert.ok(
    verifyEvidenceExport(semanticallyInvalidPacket, {
      expectedPublicKey: packet.signing.publicKey,
      expectedKeyId: packet.signing.keyId,
    }).errors.includes("review_context_invalid"),
  );
  const legacyPayload: Record<string, any> = {
    ...packet.payload,
    schemaVersion: "rateloop.human-assurance.evidence.v2",
  };
  delete legacyPayload.reviewContext;
  const legacyDocument = { payload: legacyPayload, signing: packet.signing };
  const legacyPacket = {
    ...legacyDocument,
    packetDigest: sha256EvidenceValue(legacyDocument),
    signature: sign(null, Buffer.from(canonicalizeEvidenceValue(legacyDocument)), signer.privateKey).toString(
      "base64url",
    ),
  };
  assert.equal(
    verifyEvidenceExport(legacyPacket, {
      expectedPublicKey: packet.signing.publicKey,
      expectedKeyId: packet.signing.keyId,
    }).valid,
    true,
  );
  assert.equal(
    (await getAssuranceEvidencePacket({ accountAddress: OWNER, ...fixture })).packetDigest,
    packet.packetDigest,
  );

  const attacker = generateKeyPairSync("ed25519");
  const attackerPublicKey = createPublicKey(attacker.privateKey)
    .export({ format: "der", type: "spki" })
    .toString("base64url");
  const forgedDocument = {
    payload: packet.payload,
    signing: { algorithm: "Ed25519", keyId: evidenceSigningKeyId(attackerPublicKey), publicKey: attackerPublicKey },
  };
  const forged = {
    ...forgedDocument,
    packetDigest: sha256EvidenceValue(forgedDocument),
    signature: sign(null, Buffer.from(canonicalizeEvidenceValue(forgedDocument)), attacker.privateKey).toString(
      "base64url",
    ),
  };
  assert.ok(verifyEvidenceExport(forged).errors.includes("missing_trust_anchor"));
  assert.equal(verifyEvidenceExport(forged, { expectedPublicKey: packet.signing.publicKey }).valid, false);
  assert.ok(
    verifyEvidenceExport(forged, { expectedPublicKey: packet.signing.publicKey }).errors.includes(
      "untrusted_signing_key",
    ),
  );
  assert.equal(verifyEvidenceExport(packet, { expectedKeyId: "ed25519:000000000000000000000000" }).valid, false);
  assert.equal(
    verifyEvidenceExport(packet, {
      expectedPublicKey: packet.signing.publicKey,
      expectedKeyId: "ed25519:000000000000000000000000",
    }).valid,
    false,
  );

  const directory = await mkdtemp(join(tmpdir(), "rateloop-evidence-"));
  try {
    const packetPath = join(directory, "packet.json");
    const keyPath = join(directory, "trusted-public-key.txt");
    await writeFile(packetPath, JSON.stringify(packet));
    await writeFile(keyPath, packet.signing.publicKey);
    const script = fileURLToPath(new URL("../../scripts/verify-assurance-evidence.mjs", import.meta.url));
    const missingPin = spawnSync(process.execPath, [script, packetPath], { encoding: "utf8" });
    assert.equal(missingPin.status, 1);
    assert.match(missingPin.stdout, /missing_trust_anchor/);
    const correctPin = spawnSync(process.execPath, [script, packetPath, "--public-key", keyPath], {
      encoding: "utf8",
    });
    assert.equal(correctPin.status, 0, correctPin.stderr);
    assert.equal(JSON.parse(correctPin.stdout).valid, true);
    const fingerprintPin = spawnSync(process.execPath, [script, packetPath, "--key-id", packet.signing.keyId], {
      encoding: "utf8",
    });
    assert.equal(fingerprintPin.status, 0, fingerprintPin.stderr);
    const wrongPin = spawnSync(process.execPath, [script, packetPath, "--public-key", attackerPublicKey], {
      encoding: "utf8",
    });
    assert.equal(wrongPin.status, 1);
    assert.match(wrongPin.stdout, /untrusted_signing_key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("evidence omits qualification labels held by fewer reviewers than the privacy threshold", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 3,
    sources: [
      {
        source: "customer_invited",
        targetCount: 4,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  await insert(`UPDATE tokenless_assurance_responses SET qualification_keys_json=? WHERE response_id='response_0_0'`, [
    JSON.stringify(["code-review:typescript", "finance:broker-dealer-supervision"]),
  ]);
  for (const responseId of ["response_0_1", "response_0_2"]) {
    await insert(`UPDATE tokenless_assurance_responses SET qualification_keys_json=? WHERE response_id=?`, [
      JSON.stringify(["code-review:typescript"]),
      responseId,
    ]);
  }

  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    now: NOW,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });

  assert.deepEqual(packet.payload.reviewContext.reviewerQualifications, {
    taxonomy: "explicit_qualification_categories",
    orderedTiers: false,
    minimumAggregationSize: 3,
    categories: [{ key: "code-review:typescript", suppressed: false, reviewerCount: 3 }],
    unqualified: { suppressed: true },
  });
  assert.doesNotMatch(JSON.stringify(packet.payload), /finance:broker-dealer-supervision/);
});

test("evidence binds an agent-triggered review to its frozen trigger, policy/profile versions, and gate transition", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 1,
    sources: [
      {
        source: "customer_invited",
        targetCount: 1,
        responses: [{ choice: "candidate", validity: "valid" }],
      },
    ],
  });
  const context = await bindPersistedAgentReviewContext({
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    enforcementMode: "host_enforced",
    reasonCodes: ["sampled", "critical_risk"],
  });
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    now: NOW,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });

  assert.deepEqual(packet.payload.reviewContext.selectionTrigger, {
    kind: "critical_risk",
    source: "persisted_agent_review_opportunity",
    opportunityId: context.opportunityId,
    reasonCodes: ["critical_risk", "sampled"],
    selectionProbabilityBps: 10_000,
    sampleBucket: 42,
  });
  assert.deepEqual(packet.payload.reviewContext.gate, {
    type: "blocking",
    policyReference: {
      id: context.selectionPolicyId,
      version: context.selectionPolicyVersion,
      enforcementMode: "host_enforced",
    },
    stopGateEvidenceReference: {
      kind: "human_review_lifecycle_transition",
      opportunityId: context.opportunityId,
      lifecycleState: "completed",
      lifecycleRevision: 3,
      transitionEventId: context.eventId,
      transitionCommitment: context.transitionCommitment,
    },
    statement:
      "The policy required host enforcement and is bound to the persisted review lifecycle; this packet does not independently prove that the host blocked output.",
  });
  assert.deepEqual(packet.payload.reviewContext.versions.selectionPolicy, {
    id: context.selectionPolicyId,
    version: context.selectionPolicyVersion,
    mode: "adaptive",
  });
  assert.deepEqual(packet.payload.reviewContext.versions.requestProfile, {
    id: context.binding.profileId,
    version: context.binding.profileVersion,
    hash: context.binding.profileHash,
  });
  assert.deepEqual(packet.payload.reviewContext.versions.admissionPolicies, [
    {
      admissionPolicyHash: fixture.admissionPolicyHash,
      derivedFrom: {
        kind: "assurance_audience_policy",
        id: "policy_evidence",
        version: 1,
        hash: packet.payload.frozen.policyHash,
      },
    },
  ]);
});

test("evidence reports an advisory gate only when the persisted selection policy is advisory", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 1,
    sources: [
      {
        source: "customer_invited",
        targetCount: 1,
        responses: [{ choice: "candidate", validity: "valid" }],
      },
    ],
  });
  const context = await bindPersistedAgentReviewContext({
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    enforcementMode: "advisory",
    reasonCodes: ["maximum_gap"],
  });
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: generateKeyPairSync("ed25519").privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });

  assert.equal(packet.payload.reviewContext.selectionTrigger.kind, "maximum_gap");
  assert.equal(packet.payload.reviewContext.gate.type, "advisory");
  assert.deepEqual(packet.payload.reviewContext.gate.policyReference, {
    id: context.selectionPolicyId,
    version: context.selectionPolicyVersion,
    enforcementMode: "advisory",
  });
  assert.equal(packet.payload.reviewContext.gate.stopGateEvidenceReference.transitionEventId, context.eventId);
  assert.match(packet.payload.reviewContext.gate.statement, /does not itself prove/u);
});

test("evidence records an always-review decision as a policy rule instead of owner-required", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 1,
    sources: [
      {
        source: "customer_invited",
        targetCount: 1,
        responses: [{ choice: "candidate", validity: "valid" }],
      },
    ],
  });
  const context = await bindPersistedAgentReviewContext({
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    enforcementMode: "advisory",
    reasonCodes: ["always_review"],
  });
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: generateKeyPairSync("ed25519").privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });

  assert.deepEqual(packet.payload.reviewContext.selectionTrigger, {
    kind: "policy_rule",
    source: "persisted_agent_review_opportunity",
    opportunityId: context.opportunityId,
    reasonCodes: ["always_review"],
    selectionProbabilityBps: 10_000,
    sampleBucket: 42,
  });
});

test("evidence keeps mixed paid and unpaid source panels separate and links only stored settlement evidence", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "mixed",
    minimumAggregationSize: 3,
    withChain: true,
    sources: [
      {
        source: "customer_invited",
        paid: false,
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
      {
        source: "rateloop_network",
        paid: true,
        targetCount: 2,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "tie", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  assert.deepEqual(
    packet.payload.aggregation.reviewerCoverage.sourceSubpanels.map((panel: Record<string, unknown>) => panel.source),
    ["customer_invited", "rateloop_network"],
  );
  assert.equal(packet.payload.aggregation.reviewerCoverage.paidReviewerCount, 2);
  assert.deepEqual(
    packet.payload.aggregation.reviewerCoverage.sourceSubpanels.map(
      (panel: Record<string, unknown>) => panel.paidReviewerCount,
    ),
    [0, 2],
  );
  assert.equal(packet.payload.aggregation.cases[0].sourceSubpanels[1].suppressed, true);
  assert.equal(packet.payload.aggregation.cases[0].sourceSubpanels[1].preference, null);
  assert.equal("candidate" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal("baseline" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal("tie" in packet.payload.recomputation.cases[0].sourceCounts[1], false);
  assert.equal(packet.payload.settlement.mode, "onchain_evidence_recorded");
  assert.deepEqual(packet.payload.settlement.links, [`https://sepolia.basescan.org/tx/0x${"88".repeat(32)}`]);
  assert.equal(packet.payload.chainEvidence[0].execution.deploymentKey, "tokenless-v2:test");
  assert.equal(packet.payload.chainEvidence[0].execution.roundCreationTransactionHash, `0x${"66".repeat(32)}`);
  assert.equal(packet.payload.chainEvidence[0].indexedEvents[0].eventType, "round.finalized");
  assert.doesNotMatch(JSON.stringify(packet), /\"private\":\"not exported\"/);
});

test("client sign-off is decision-owner scoped, separate, and bound to the measured packet", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  await insert(
    "INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at) VALUES (?, ?, 'member', ?), (?, ?, 'member', ?)",
    [fixture.workspaceId, DECISION_OWNER, NOW, fixture.workspaceId, MEMBER, NOW],
  );
  await insert(
    `INSERT INTO tokenless_workspace_member_governance
     (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
     VALUES (?, ?, 'decision_owner', ?, ?, ?)`,
    [fixture.workspaceId, DECISION_OWNER, OWNER, NOW, NOW],
  );
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  await assert.rejects(
    () => recordAssuranceClientDecision({ accountAddress: MEMBER, ...fixture, decision: "go" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_decision_forbidden",
  );
  const decision = await recordAssuranceClientDecision({
    accountAddress: DECISION_OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    decision: "revise",
    note: "Address the documented regression before release.",
    now: NOW,
  });
  assert.equal(decision.evidencePacketDigest, packet.packetDigest);
  assert.equal(
    (
      await getAssuranceClientDecision({
        accountAddress: OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
      })
    )?.decision,
    "revise",
  );
  assert.equal(
    (
      await recordAssuranceClientDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        decision: "revise",
        note: "Address the documented regression before release.",
      })
    ).decisionDigest,
    decision.decisionDigest,
  );
  await assert.rejects(
    () =>
      recordAssuranceClientDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        decision: "go",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_decision_conflict",
  );
  const stored = await dbClient.execute(
    "SELECT result_json FROM tokenless_assurance_evidence_packets WHERE run_id = 'run_evidence'",
  );
  assert.doesNotMatch(String(stored.rows[0]?.result_json), /revise|decision_owner/);
});

test("packet generation rejects a completed label with unaccounted reviewer-case judgments", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  await assert.rejects(
    () =>
      generateAssuranceEvidencePacket({
        accountAddress: OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        signer: { privateKey: signer.privateKey },
        tenantCommitmentKey: TENANT_KEY,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_run_not_terminal",
  );
});

test("callers cannot inject measured outcome fields", () => {
  assert.doesNotThrow(() => assertEvidenceGenerationRequest({}));
  assert.throws(
    () => assertEvidenceGenerationRequest({ candidateShareBps: 10_000 }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "caller_metrics_rejected",
  );
});

test("override records are decision-scoped, append-only, audit-chained, and aggregate into metrics and exports", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  await insert(
    "INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at) VALUES (?, ?, 'member', ?), (?, ?, 'member', ?)",
    [fixture.workspaceId, DECISION_OWNER, NOW, fixture.workspaceId, MEMBER, NOW],
  );
  await insert(
    `INSERT INTO tokenless_workspace_member_governance
     (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
     VALUES (?, ?, 'decision_owner', ?, ?, ?)`,
    [fixture.workspaceId, DECISION_OWNER, OWNER, NOW, NOW],
  );
  const signer = generateKeyPairSync("ed25519");
  const packet = await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  // Packets freeze before overrides exist: the packet carries counts only.
  assert.deepEqual(packet.payload.overrideDecisions, {
    atGeneration: { recorded: 0, byOutcome: { accepted: 0, disregarded: 0, overridden: 0, reversed: 0 } },
    recordedSeparately: true,
  });

  await assert.rejects(
    () =>
      recordAssuranceOverrideDecision({
        accountAddress: MEMBER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        outcome: "accepted",
        reasons: "Members cannot record oversight override decisions.",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_decision_forbidden",
  );
  await assert.rejects(
    () =>
      recordAssuranceOverrideDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        outcome: "accepted",
        reasons: "too short",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_override_decision",
  );
  await assert.rejects(
    () =>
      recordAssuranceOverrideDecision({
        accountAddress: DECISION_OWNER,
        workspaceId: fixture.workspaceId,
        runId: fixture.runId,
        outcome: "escalated",
        reasons: "Unsupported outcomes fail closed before any write.",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_override_decision",
  );

  const first = await recordAssuranceOverrideDecision({
    accountAddress: DECISION_OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    outcome: "accepted",
    reasons: "Panel verdict matches the observed output quality.",
    now: NOW,
  });
  assert.equal(first.supersedesRecordId, null);
  assert.equal(first.evidencePacketDigest, packet.packetDigest);
  assert.match(first.recordDigest, /^sha256:[0-9a-f]{64}$/u);

  const second = await recordAssuranceOverrideDecision({
    accountAddress: DECISION_OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    outcome: "reversed",
    reasons: "The output shipped, then failed in production; decision reversed.",
    correctiveAction: "Ticket OPS-1204: retrain the routing prompt.",
    now: new Date(NOW.getTime() + 60_000),
  });
  assert.equal(second.supersedesRecordId, first.recordId);

  // Append-only: the first record still exists unchanged and is marked superseded.
  const listed = await listAssuranceOverrideDecisions({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
  });
  assert.deepEqual(
    listed.map(record => [record.outcome, record.current]),
    [
      ["reversed", true],
      ["accepted", false],
    ],
  );
  assert.equal(listed[1]?.reasons, "Panel verdict matches the observed output quality.");
  assert.equal(listed[0]?.correctiveAction, "Ticket OPS-1204: retrain the routing prompt.");

  const audit = await dbClient.execute({
    sql: `SELECT action, metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'oversight.override_recorded' ORDER BY sequence ASC`,
    args: [fixture.workspaceId],
  });
  assert.equal(audit.rowCount, 2);
  assert.match(String(audit.rows[1]?.metadata_json), /"outcome":"reversed"/u);
  assert.doesNotMatch(String(audit.rows[1]?.metadata_json), /failed in production/u);

  // Only the current record enters aggregates: 1 decided, 1 reversed.
  const metrics = await collectWorkspaceAssuranceMetrics({
    workspaceId: fixture.workspaceId,
    now: new Date(NOW.getTime() + 120_000),
  });
  assert.deepEqual(metrics.overrideDecisions, {
    decided: 1,
    overridden: 0,
    reversed: 1,
    overrideRateBps: 10_000,
  });

  const exported = await exportAdaptiveCoverage({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    from: new Date(NOW.getTime() - 86_400_000),
    to: new Date(NOW.getTime() + 120_000),
    now: new Date(NOW.getTime() + 120_000),
  });
  assert.deepEqual(exported.overrideDecisions, {
    decided: 1,
    byOutcome: { accepted: 0, disregarded: 0, overridden: 0, reversed: 1 },
    overrideRateBps: 10_000,
  });
  assert.doesNotMatch(JSON.stringify(exported.overrideDecisions), /failed in production|OPS-1204/u);
});

test("override routes are session-scoped and mutations stay same-origin with an exact field allowlist", () => {
  const source = readFileSync(
    new URL(
      "../../app/api/account/workspaces/[workspaceId]/assurance/runs/[runId]/evidence/overrides/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /requireBrowserSession\(request\)/u);
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(source, /listAssuranceOverrideDecisions/u);
  assert.match(source, /recordAssuranceOverrideDecision/u);
  assert.match(source, /POST_KEYS/u);
  assert.match(source, /private, no-store/u);
});

test("sampled runs require an explained decision even for go", async () => {
  const fixture = await seedEvidenceFixture({
    compensation: "unpaid",
    minimumAggregationSize: 2,
    sources: [
      {
        source: "customer_invited",
        targetCount: 3,
        responses: [
          { choice: "candidate", validity: "valid" },
          { choice: "candidate", validity: "valid" },
          { choice: "baseline", validity: "valid" },
        ],
      },
    ],
  });
  const signer = generateKeyPairSync("ed25519");
  await generateAssuranceEvidencePacket({
    accountAddress: OWNER,
    workspaceId: fixture.workspaceId,
    runId: fixture.runId,
    signer: { privateKey: signer.privateKey },
    tenantCommitmentKey: TENANT_KEY,
  });
  const originalRate = process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS;
  process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS = "10000";
  try {
    await assert.rejects(
      () =>
        recordAssuranceClientDecision({
          accountAddress: OWNER,
          workspaceId: fixture.workspaceId,
          runId: fixture.runId,
          decision: "go",
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "decision_explanation_required",
    );
    await assert.rejects(
      () =>
        recordAssuranceClientDecision({
          accountAddress: OWNER,
          workspaceId: fixture.workspaceId,
          runId: fixture.runId,
          decision: "go",
          note: "short",
        }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "decision_explanation_required",
    );
    const explained = await recordAssuranceClientDecision({
      accountAddress: OWNER,
      workspaceId: fixture.workspaceId,
      runId: fixture.runId,
      decision: "go",
      note: "Unanimity on quorum cases and passing calibration justify release.",
      now: NOW,
    });
    assert.equal(explained.decision, "go");
    assert.match(String(explained.note), /justify release/);
  } finally {
    if (originalRate === undefined) delete process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS;
    else process.env.TOKENLESS_DECISION_EXPLANATION_RATE_BPS = originalRate;
  }
});
