import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  MAX_CASE_IMPORT_BYTES,
  bindAssuranceCaseRound,
  buildBlindedArtifactVariants,
  evaluateDeterministicChecks,
  freezeAssuranceRunOrchestration,
  getAssuranceRunAggregateState,
  importAssuranceCases,
  parseAssuranceCaseImport,
  recordDeterministicCheckResult,
  verifyBlindingCommitment,
} from "~~/lib/tokenless/assuranceRunOrchestration";
import {
  createAssuranceAudiencePolicy,
  createAssuranceProject,
  createAssuranceRun,
  createAssuranceSuite,
  freezeAssuranceSuite,
  markAssuranceCaseReady,
  transitionAssuranceRun,
} from "~~/lib/tokenless/humanAssurance";
import { type ProductPrincipal, createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function rubric() {
  return {
    prompt: "Which artifact is better?",
    failureTags: [{ key: "incorrect", label: "Incorrect" }],
    rationale: { mode: "required" as const, minLength: 5, maxLength: 500 },
    passRule: {
      metric: "candidate_preference_share_bps" as const,
      operator: "gte" as const,
      thresholdBps: 6000,
      minimumValidResponses: 2,
    },
  };
}

function policy() {
  return {
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "client_panel", minimumReviewers: 2, maximumReviewers: 5 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [{ key: "product_expert", operator: "attested" as const, value: true }],
    assurance: {
      requirements: [
        {
          capability: "customer_invitation" as const,
          reviewerSources: ["customer_invited" as const],
          allowedProviders: ["rateloop:invitation"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 2,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

async function principalFixture() {
  const { workspaceId } = await createWorkspace({ name: "Run orchestration", ownerAddress: OWNER });
  const { apiKeyId } = await createWorkspaceApiKey({ workspaceId, name: "orchestration test" });
  const principal: ProductPrincipal = { kind: "api_key", apiKeyId, workspaceId, role: "member" };
  const { projectId } = await createAssuranceProject({
    principal,
    name: "Release gate",
    dataClassification: "confidential",
    retentionDays: 90,
  });
  return { principal, projectId, workspaceId };
}

async function seedCompletedPaidPanel(input: {
  manifestHash: string;
  policyHash: string;
  policyId: string;
  projectId: string;
  runId: string;
  workspaceId: string;
}) {
  const now = new Date();
  const cohortId = `${input.runId}_cohort`;
  const subpanelId = `${input.runId}_subpanel`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id, project_id, name, source, selection, capacity, active_reservations,
           qualification_rules_json, status, created_by, created_at, updated_at)
          VALUES (?, ?, 'Client panel', 'customer_invited', 'customer_named', 2, 0,
                  '[]', 'active', ?, ?, ?)`,
    args: [cohortId, input.projectId, OWNER, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
           target_count, active_reservations, policy_id, policy_version, policy_hash,
           run_manifest_hash, created_at)
          VALUES (?, ?, ?, ?, ?, 'customer_invited', 'customer_named', 2, 0, ?, 1, ?, ?, ?)`,
    args: [
      subpanelId,
      input.workspaceId,
      input.projectId,
      input.runId,
      cohortId,
      input.policyId,
      input.policyHash,
      input.manifestHash,
      now,
    ],
  });
  for (const index of [0, 1]) {
    const reviewer = `0x${String(index + 2).repeat(40)}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_cohort_reviewers
            (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
             maximum_active_assignments, active_reservations, status, created_by, created_at, updated_at)
            VALUES (?, ?, ?, '[]', 1, 0, 'active', ?, ?, ?)`,
      args: [input.projectId, cohortId, reviewer, OWNER, now, now],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_assignments
            (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
             reviewer_account_address, source, selection, status, confidentiality_terms_hash,
             confidentiality_accepted_at, qualification_provenance_json,
             assurance_snapshot_json, assurance_snapshot_hash, blinding_json,
             paid_assignment, paid_eligibility_checked_at, reservation_expires_at,
             assignment_expires_at, lease_issuer_account_address, lease_state,
             created_at, accepted_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'customer_invited', 'customer_named', 'completed', ?, ?,
                    '[]', '{"assertions":[],"qualifications":[]}',
                    'sha256:0000000000000000000000000000000000000000000000000000000000000000',
                    '{}', true, ?, ?, ?, ?, 'expired', ?, ?, ?)`,
      args: [
        `${input.runId}_assignment_${index}`,
        input.workspaceId,
        input.projectId,
        input.runId,
        subpanelId,
        cohortId,
        reviewer,
        `sha256:${"c".repeat(64)}`,
        now,
        now,
        new Date(now.getTime() + 60_000),
        new Date(now.getTime() + 60_000),
        OWNER,
        now,
        now,
        now,
      ],
    });
  }
}

async function seedRoundCreationEvidence(input: { contentId: string; runId: string }) {
  const now = new Date();
  const operationKey = `${input.runId}_operation`;
  const quoteId = `${input.runId}_quote`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES (?, 'request_hash', '{}', '{}', ?, ?)`,
    args: [quoteId, new Date(now.getTime() + 60_000), now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json,
           status, sandbox, created_at, updated_at)
          VALUES (?, ?, 'request_hash', ?, '{}', '{}', 'completed', false, ?, ?)`,
    args: [operationKey, `${input.runId}_idempotency`, quoteId, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id,
           deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address,
           funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic,
           state, submission_transaction_hash, round_id, receipt_block_number, receipt_block_hash,
           created_at, updated_at, confirmed_at)
          VALUES (?, ?, 'prepaid', 'payment', 'tokenless-v2:test', 84532, 123, ?, ?, ?, ?, ?, ?, ?, '{}',
                  1000, 'confirmed', ?, 42, 456, ?, ?, ?, ?)`,
    args: [
      `${input.runId}_execution`,
      operationKey,
      `0x${"1".repeat(40)}`,
      `0x${"2".repeat(40)}`,
      `0x${"3".repeat(40)}`,
      `0x${"4".repeat(40)}`,
      `0x${"5".repeat(40)}`,
      input.contentId,
      `sha256:${"d".repeat(64)}`,
      `0x${"6".repeat(64)}`,
      `0x${"7".repeat(64)}`,
      now,
      now,
      now,
    ],
  });
  return operationKey;
}

async function seedTerminalSettlementEvent(input: { operationKey: string; runId: string; workspaceId: string }) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_transparency_events
          (event_id, operation_key, workspace_id, deployment_key, round_id, sequence,
           event_type, evidence_hash, evidence_json, occurred_at, recorded_at)
          VALUES (?, ?, ?, 'tokenless-v2:test', 42, 1, 'round.finalized', ?, '{}', ?, ?)`,
    args: [`${input.runId}_event`, input.operationKey, input.workspaceId, `sha256:${"e".repeat(64)}`, now, now],
  });
}

async function seedArtifact(input: {
  artifactId: string;
  projectId: string;
  role: "baseline" | "candidate" | "context";
  digestCharacter: string;
}) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes,
           storage_ref, redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'application/json', 128, ?, 'approved', 'safe_json', ?, ?)`,
    args: [
      input.artifactId,
      input.projectId,
      input.role,
      input.role,
      `sha256:${input.digestCharacter.repeat(64)}`,
      `blob:${input.artifactId}`,
      now,
      now,
    ],
  });
}

async function frozenSuiteFixture(principal: ProductPrincipal, projectId: string) {
  const suite = await createAssuranceSuite({ principal, projectId, name: "A/B quality", rubric: rubric() });
  await Promise.all([
    seedArtifact({ artifactId: "artifact_base", projectId, role: "baseline", digestCharacter: "a" }),
    seedArtifact({ artifactId: "artifact_candidate", projectId, role: "candidate", digestCharacter: "b" }),
    seedArtifact({ artifactId: "artifact_context", projectId, role: "context", digestCharacter: "c" }),
  ]);
  const imported = await importAssuranceCases({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    format: "json",
    payload: JSON.stringify({
      cases: [
        {
          title: "Support answer",
          instructions: "Compare the two answers against the policy.",
          baselineArtifactId: "artifact_base",
          candidateArtifactId: "artifact_candidate",
          contextArtifactIds: ["artifact_context"],
          objectiveReference: "support-policy-v3",
          deterministicChecks: [
            { key: "schema", path: "schema.valid", operator: "equals", expected: true },
            { key: "latency", path: "latencyMs", operator: "number_lte", expected: 500 },
          ],
        },
      ],
    }),
  });
  await markAssuranceCaseReady({ principal, caseId: imported.cases[0].caseId });
  await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
  return { ...suite, caseId: imported.cases[0].caseId };
}

test("CSV and JSON case imports are equivalent and fail closed on unsafe input", () => {
  const json = parseAssuranceCaseImport({
    format: "json",
    payload: JSON.stringify([
      {
        title: "Case one",
        instructions: "Compare both artifacts carefully.",
        baselineArtifactId: "artifact_base",
        candidateArtifactId: "artifact_candidate",
        contextArtifactIds: [],
        deterministicChecks: [],
      },
    ]),
  });
  const csv = parseAssuranceCaseImport({
    format: "csv",
    payload:
      "title,instructions,baselineArtifactId,candidateArtifactId,contextArtifactIds,deterministicChecks\n" +
      'Case one,Compare both artifacts carefully.,artifact_base,artifact_candidate,[],"[]"\n',
  });
  assert.deepEqual(csv, json);
  assert.throws(
    () =>
      parseAssuranceCaseImport({
        format: "json",
        payload: JSON.stringify([{ ...json[0], unsupported: true }]),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_run_orchestration",
  );
  assert.throws(
    () => parseAssuranceCaseImport({ format: "json", payload: " ".repeat(MAX_CASE_IMPORT_BYTES + 1) }),
    (error: unknown) => error instanceof TokenlessServiceError && error.status === 413,
  );
  assert.throws(
    () =>
      parseAssuranceCaseImport({
        format: "csv",
        payload:
          "title,instructions,baselineArtifactId,candidateArtifactId,contextArtifactIds,deterministicChecks\n" +
          '"Case one"unexpected,Compare carefully.,artifact_base,artifact_candidate,[],"[]"\n',
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_run_orchestration",
  );
});

test("deterministic checks emit hashes instead of leaking observed values", () => {
  const evaluation = evaluateDeterministicChecks(
    [
      { key: "schema", path: "schema.valid", operator: "equals", expected: true },
      { key: "latency", path: "latencyMs", operator: "number_lte", expected: 500 },
      { key: "region", path: "region", operator: "one_of", expected: ["eu", "us"] },
    ],
    { schema: { valid: true }, latencyMs: 350, region: "eu", privatePayload: "never return me" },
  );
  assert.equal(evaluation.status, "passed");
  assert.ok(evaluation.results.every(result => /^sha256:[0-9a-f]{64}$/.test(result.observedHash)));
  assert.doesNotMatch(JSON.stringify(evaluation), /never return me/);
});

test("blinding commitment hides the label and opens only with the server secret", () => {
  const variants = buildBlindedArtifactVariants({
    runId: "run_1",
    caseId: "case_1",
    baselineArtifactId: "baseline_1",
    candidateArtifactId: "candidate_1",
    entropy: Buffer.alloc(32, 7),
  });
  assert.match(variants.blindingCommitment, /^sha256:[0-9a-f]{64}$/);
  assert.equal(verifyBlindingCommitment({ runId: "run_1", caseId: "case_1", ...variants }), true);
  assert.equal(verifyBlindingCommitment({ runId: "run_1", caseId: "case_1", ...variants, secretJson: "{}" }), false);
});

test("run orchestration freezes rubric, blinded cases, policy hash, rounds, aggregate state, and rerun lineage", async () => {
  const { principal, projectId, workspaceId } = await principalFixture();
  const suite = await frozenSuiteFixture(principal, projectId);
  const audience = await createAssuranceAudiencePolicy({ principal, projectId, policy: policy() });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
  });
  const frozen = await freezeAssuranceRunOrchestration({ principal, runId: run.runId });
  assert.match(frozen.manifestHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(frozen.manifest.audiencePolicy.admissionPolicyHash, /^0x[0-9a-f]{64}$/);
  assert.equal(frozen.manifest.rubric.passRule.minimumValidResponses, 2);
  assert.equal(frozen.manifest.rerun.ordinal, 1);
  assert.equal(frozen.manifest.aggregate.totalCases, 1);
  await seedCompletedPaidPanel({
    manifestHash: frozen.manifestHash,
    policyHash: audience.policyHash,
    policyId: audience.policy.policyId,
    projectId,
    runId: run.runId,
    workspaceId,
  });
  const publicManifest = JSON.stringify(frozen.manifest);
  assert.doesNotMatch(publicManifest, /baselineVariant|nonce|blinding_secret/i);

  const planned = await dbClient.execute({
    sql: `SELECT * FROM tokenless_assurance_run_cases WHERE run_id = ? AND case_id = ?`,
    args: [run.runId, suite.caseId],
  });
  const plan = planned.rows[0] as Record<string, unknown>;
  assert.match(String(plan.content_id), /^0x[0-9a-f]{64}$/);
  assert.equal(
    verifyBlindingCommitment({
      runId: run.runId,
      caseId: suite.caseId,
      variantAArtifactId: String(plan.variant_a_artifact_id),
      variantBArtifactId: String(plan.variant_b_artifact_id),
      blindingCommitment: String(plan.blinding_commitment),
      secretJson: String(plan.blinding_secret_json),
    }),
    true,
  );

  const deterministic = await recordDeterministicCheckResult({
    principal,
    runId: run.runId,
    caseId: suite.caseId,
    observed: { schema: { valid: true }, latencyMs: 420 },
  });
  assert.equal(deterministic.status, "passed");
  const binding = await bindAssuranceCaseRound({
    principal,
    runId: run.runId,
    caseId: suite.caseId,
    roundId: "42",
    status: "finalized",
  });
  assert.equal(binding.contentId, plan.content_id);
  assert.equal(binding.admissionPolicyHash, frozen.manifest.audiencePolicy.admissionPolicyHash);
  const operationKey = await seedRoundCreationEvidence({ contentId: String(plan.content_id), runId: run.runId });
  await assert.rejects(
    () =>
      bindAssuranceCaseRound({
        principal,
        runId: run.runId,
        caseId: suite.caseId,
        roundId: "42",
        status: "open",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_round_transition",
  );

  const now = new Date();
  for (const [index, choice] of ["candidate", "candidate"].entries()) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_responses
            (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
             failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
             response_digest, settlement_reference, validity, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, 'customer_invited', ?, '[]', '[]', '[]', ?, ?, 'valid', ?, ?)`,
      args: [
        `response_${index}`,
        run.runId,
        suite.caseId,
        `reviewer_${index}`,
        choice,
        `digest_${index}`,
        `https://sepolia.basescan.org/tx/0x${"8".repeat(64)}`,
        now,
        now,
      ],
    });
  }
  const aggregate = await getAssuranceRunAggregateState({ principal, runId: run.runId });
  assert.equal(aggregate.decision, "passed");
  assert.equal(aggregate.candidatePreferenceShareBps, 10_000);
  assert.deepEqual(aggregate.roundStates, { finalized: 1 });
  assert.equal(aggregate.deterministicChecks.passed, 1);

  for (const status of ["recruiting", "collecting", "aggregating"] as const) {
    await transitionAssuranceRun({ principal, runId: run.runId, status });
  }
  await assert.rejects(
    () => transitionAssuranceRun({ principal, runId: run.runId, status: "completed" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_paid_settlement_incomplete",
  );
  await seedTerminalSettlementEvent({ operationKey, runId: run.runId, workspaceId });
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_responses SET settlement_reference = NULL WHERE response_id = 'response_0'`,
    args: [],
  });
  await assert.rejects(
    () => transitionAssuranceRun({ principal, runId: run.runId, status: "completed" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_paid_settlement_incomplete",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_responses SET settlement_reference = ? WHERE response_id = 'response_0'`,
    args: [`https://sepolia.basescan.org/tx/0x${"9".repeat(64)}`],
  });
  await transitionAssuranceRun({ principal, runId: run.runId, status: "completed" });
  const rerun = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
    previousRunId: run.runId,
  });
  const rerunFrozen = await freezeAssuranceRunOrchestration({ principal, runId: rerun.runId });
  assert.equal(rerunFrozen.manifest.rerun.previousRunId, run.runId);
  assert.equal(rerunFrozen.manifest.rerun.rootRunId, run.runId);
  assert.equal(rerunFrozen.manifest.rerun.previousManifestHash, frozen.manifestHash);
  assert.equal(rerunFrozen.manifest.rerun.ordinal, 2);
});

test("orchestration refuses to freeze definitions after a response exists", async () => {
  const { principal, projectId } = await principalFixture();
  const suite = await frozenSuiteFixture(principal, projectId);
  const audience = await createAssuranceAudiencePolicy({ principal, projectId, policy: policy() });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
  });
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_responses
          (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
           failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
           response_digest, validity, submitted_at, updated_at)
          VALUES ('response_early', ?, ?, 'reviewer_early', 'sandbox', 'candidate',
                  '[]', '[]', '[]', 'digest_early', 'valid', ?, ?)`,
    args: [run.runId, suite.caseId, now, now],
  });
  await assert.rejects(
    () => freezeAssuranceRunOrchestration({ principal, runId: run.runId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_responses_already_exist",
  );
});
