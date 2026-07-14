import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { __setAssuranceResponseKeyringsForTests, submitAssuranceResponses } from "~~/lib/tokenless/assuranceResponses";
import { freezeAssuranceRunOrchestration } from "~~/lib/tokenless/assuranceRunOrchestration";
import {
  createProjectCohort,
  createReviewerInvitation,
  prepareRunAudience,
  redeemReviewerInvitationWithBaseAccount,
  reserveAudienceAssignment,
} from "~~/lib/tokenless/audienceAssignments";
import {
  addAssuranceCase,
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
const REVIEWER = "0x2222222222222222222222222222222222222222";
const TERMS_HASH = `sha256:${"a".repeat(64)}`;
const RATIONALE_KEY = Buffer.alloc(32, 7);
const MAPPING_KEY = Buffer.alloc(32, 9);

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setAssuranceResponseKeyringsForTests({
    rationale: { currentVersion: "rationale-test-v1", keys: new Map([["rationale-test-v1", RATIONALE_KEY]]) },
    reviewerMapping: { currentVersion: "mapping-test-v1", keys: new Map([["mapping-test-v1", MAPPING_KEY]]) },
  });
});

afterEach(() => {
  __setAssuranceResponseKeyringsForTests(null);
  __setDatabaseResourcesForTests(null);
});

async function seedArtifact(projectId: string, artifactId: string, role: "baseline" | "candidate", marker: string) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes,
           storage_ref, redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'text/plain', 16, ?, 'approved', 'plain_text', ?, ?)`,
    args: [artifactId, projectId, role, artifactId, `sha256:${marker.repeat(64)}`, `test:${artifactId}`, now, now],
  });
}

async function fixture(input: { paid?: boolean; rubricMinimum?: number } = {}) {
  const { workspaceId } = await createWorkspace({ name: "Response test", ownerAddress: OWNER });
  if (input.paid) {
    const now = new Date();
    await dbClient.execute({
      sql: `UPDATE tokenless_workspace_subscriptions
            SET plan_key = 'early_access', price_version = 'early_access_usd_99_2026_07',
                provider_status = 'active', current_period_start = ?, current_period_end = ?, updated_at = ?
            WHERE workspace_id = ?`,
      args: [new Date(now.getTime() - 60_000), new Date(now.getTime() + 86_400_000), now, workspaceId],
    });
  }
  const { apiKeyId } = await createWorkspaceApiKey({ workspaceId, name: "response fixture" });
  const principal: ProductPrincipal = { kind: "api_key", apiKeyId, workspaceId, role: "member" };
  const { projectId } = await createAssuranceProject({
    principal,
    name: "Support release gate",
    dataClassification: "confidential",
    retentionDays: 30,
  });
  const suite = await createAssuranceSuite({
    principal,
    projectId,
    name: "Two blinded cases",
    rubric: {
      prompt: "Which response is more correct?",
      failureTags: [
        { key: "incorrect", label: "Incorrect" },
        { key: "unsafe", label: "Unsafe" },
      ],
      rationale: { mode: "required", minLength: input.rubricMinimum ?? 10, maxLength: 2_000 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6_000,
        minimumValidResponses: 1,
      },
    },
  });
  const caseInputs = [
    {
      baseline: `response_base_1_${projectId}`,
      candidate: `response_candidate_1_${projectId}`,
      marker: ["b", "c"],
    },
    {
      baseline: `response_base_2_${projectId}`,
      candidate: `response_candidate_2_${projectId}`,
      marker: ["d", "e"],
    },
  ];
  const caseIds: string[] = [];
  for (const [index, value] of caseInputs.entries()) {
    await seedArtifact(projectId, value.baseline, "baseline", value.marker[0]!);
    await seedArtifact(projectId, value.candidate, "candidate", value.marker[1]!);
    const created = await addAssuranceCase({
      principal,
      suiteId: suite.suiteId,
      suiteVersion: suite.version,
      title: `Support case ${index + 1}`,
      instructions: "Compare both answers against the frozen support policy.",
      baselineArtifactId: value.baseline,
      candidateArtifactId: value.candidate,
    });
    await markAssuranceCaseReady({ principal, caseId: created.caseId });
    caseIds.push(created.caseId);
  }
  await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
  const cohort = await createProjectCohort({
    accountAddress: OWNER,
    workspaceId,
    projectId,
    name: "Named customer reviewers",
    source: "customer_invited",
    selection: "customer_named",
    capacity: 2,
  });
  const invitation = await createReviewerInvitation({
    accountAddress: OWNER,
    workspaceId,
    projectId,
    cohortId: cohort.cohortId,
    intendedAccountAddress: REVIEWER,
  });
  await redeemReviewerInvitationWithBaseAccount({ token: invitation.token, baseAccountAddress: REVIEWER });
  const audience = await createAssuranceAudiencePolicy({
    principal,
    projectId,
    policy: {
      reviewerSource: "customer_invited",
      compensation: input.paid ? "paid" : "unpaid",
      cohorts: [{ cohortId: cohort.cohortId, minimumReviewers: 1, maximumReviewers: 2 }],
      selection: "customer_named",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [{ key: "customer_invitation", operator: "attested", value: true }],
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
        visibleFields: ["reviewer_source", "qualification_summary"],
        minimumAggregationSize: 2,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: Boolean(input.paid),
    },
  });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
  });
  await freezeAssuranceRunOrchestration({ principal, runId: run.runId });
  const [subpanel] = await prepareRunAudience({ accountAddress: OWNER, workspaceId, projectId, runId: run.runId });
  const reserved = await reserveAudienceAssignment({
    accountAddress: OWNER,
    workspaceId,
    projectId,
    runId: run.runId,
    subpanelId: subpanel!.subpanelId!,
    confidentialityTermsHash: TERMS_HASH,
    reviewerAccountAddress: REVIEWER,
  });
  const now = new Date();
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_assignments
          SET status = 'accepted', confidentiality_accepted_at = ?, accepted_at = ?,
              assignment_expires_at = ?, lease_state = 'issued', voucher_marker = ?, updated_at = ?
          WHERE assignment_id = ?`,
    args: [
      now,
      now,
      new Date(now.getTime() + 3_600_000),
      input.paid ? "eligibility:test" : null,
      now,
      reserved.assignmentId,
    ],
  });
  await transitionAssuranceRun({ principal, runId: run.runId, status: "recruiting" });
  const runCases = await dbClient.execute({
    sql: `SELECT rc.case_id, rc.variant_a_artifact_id, rc.variant_b_artifact_id,
                 c.baseline_artifact_id, c.candidate_artifact_id
          FROM tokenless_assurance_run_cases rc JOIN tokenless_assurance_cases c ON c.case_id = rc.case_id
          WHERE rc.run_id = ? ORDER BY rc.position`,
    args: [run.runId],
  });
  return { assignmentId: reserved.assignmentId, principal, runId: run.runId, runCases: runCases.rows };
}

function requestFor(runCases: QueryRow[], rationaleSuffix = "") {
  return runCases.map((raw, index) => {
    const row = raw as Record<string, unknown>;
    const selectedArtifactId = String(index === 0 ? row.variant_a_artifact_id : row.variant_b_artifact_id);
    return {
      caseId: String(row.case_id),
      displayedOption: (index === 0 ? "A" : "B") as "A" | "B",
      selectedArtifactId,
      failureTagKeys: index === 0 ? ["incorrect"] : [],
      rationale: `The selected response follows the frozen instructions more precisely ${index}.${rationaleSuffix}`,
    };
  });
}

function decryptStoredRationale(row: Record<string, unknown>, rationale: string) {
  const [version, nonce, tag, ciphertext] = String(row.rationale_ciphertext).split(".");
  assert.equal(version, "v1");
  const digest = `sha256:${createHash("sha256").update(rationale).digest("hex")}`;
  const aad = `assurance_rationale:${row.run_id}:${row.case_id}:${row.reviewer_key}:${digest}`;
  const decipher = createDecipheriv("aes-256-gcm", RATIONALE_KEY, Buffer.from(nonce!, "base64url"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag!, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext!, "base64url")), decipher.final()]).toString("utf8");
}

type QueryRow = Record<string, unknown>;

test("unpaid assigned responses persist atomically with encrypted rationale, pseudonym, canonical choices, and replay", async () => {
  const seeded = await fixture();
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_assignments SET qualification_provenance_json = '[]' WHERE assignment_id = ?",
    args: [seeded.assignmentId],
  });
  const responses = requestFor(seeded.runCases);
  const accepted = await submitAssuranceResponses({
    assignmentId: seeded.assignmentId,
    baseAccountAddress: REVIEWER,
    idempotencyKey: "response:test:unpaid",
    responses,
  });
  assert.deepEqual(accepted, {
    assignmentId: seeded.assignmentId,
    accepted: true,
    replay: false,
    responseCount: 2,
    compensation: "unpaid",
    settlementStatus: "not_applicable",
  });
  const stored = await dbClient.execute({
    sql: `SELECT * FROM tokenless_assurance_responses WHERE run_id = ? ORDER BY case_id`,
    args: [seeded.runId],
  });
  assert.equal(stored.rowCount, 2);
  for (const [index, response] of responses.entries()) {
    const row = stored.rows.find(value => value.case_id === response.caseId)! as QueryRow;
    assert.match(String(row.reviewer_key), /^hmac-sha256:mapping-test-v1:[0-9a-f]{64}$/);
    assert.doesNotMatch(String(row.reviewer_key), new RegExp(REVIEWER.slice(2), "i"));
    assert.doesNotMatch(String(row.rationale_ciphertext), new RegExp(response.rationale));
    assert.equal(decryptStoredRationale(row, response.rationale), response.rationale);
    assert.equal(row.rationale_key_ref, "assurance_rationale:rationale-test-v1");
    assert.equal(row.settlement_reference, null);
    assert.equal(row.validity, "valid");
    assert.deepEqual(JSON.parse(String(row.qualification_keys_json)), ["customer_invitation"]);
    assert.deepEqual(JSON.parse(String(row.assurance_capabilities_json)), ["customer_invitation"]);
    const caseRow = seeded.runCases[index] as QueryRow;
    const expectedChoice = response.selectedArtifactId === caseRow.baseline_artifact_id ? "baseline" : "candidate";
    assert.equal(row.choice, expectedChoice);
  }
  const assignment = await dbClient.execute({
    sql: "SELECT status, lease_state FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [seeded.assignmentId],
  });
  assert.deepEqual(assignment.rows[0], { status: "completed", lease_state: "expired" });
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_runs SET status = 'aggregating' WHERE run_id = ?",
    args: [seeded.runId],
  });
  __setAssuranceResponseKeyringsForTests({
    rationale: {
      currentVersion: "rationale-test-v2",
      keys: new Map([
        ["rationale-test-v1", RATIONALE_KEY],
        ["rationale-test-v2", Buffer.alloc(32, 11)],
      ]),
    },
    reviewerMapping: {
      currentVersion: "mapping-test-v2",
      keys: new Map([
        ["mapping-test-v1", MAPPING_KEY],
        ["mapping-test-v2", Buffer.alloc(32, 13)],
      ]),
    },
  });
  const replay = await submitAssuranceResponses({
    assignmentId: seeded.assignmentId,
    baseAccountAddress: REVIEWER,
    idempotencyKey: "response:test:unpaid:retry",
    responses,
    now: new Date("2099-01-01T00:00:00.000Z"),
  });
  assert.equal(replay.replay, true);
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:unpaid:conflict",
        responses: requestFor(seeded.runCases, " changed"),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_response_conflict",
  );
  await dbClient.execute({
    sql: `UPDATE tokenless_assurance_run_subpanels SET policy_hash = ?
          WHERE run_id = ?`,
    args: [`sha256:${"f".repeat(64)}`, seeded.runId],
  });
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:binding",
        responses,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_run_binding_mismatch",
  );
});

test("response batches reject missing cases and unknown rubric tags before completing the assignment", async () => {
  const seeded = await fixture();
  const responses = requestFor(seeded.runCases);
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:missing",
        responses: responses.slice(0, 1),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "incomplete_assurance_response",
  );
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:tag",
        responses: responses.map((value, index) =>
          index === 0 ? { ...value, failureTagKeys: ["not_in_frozen_rubric"] } : value,
        ),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_failure_tags",
  );
  const assignment = await dbClient.execute({
    sql: "SELECT status FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [seeded.assignmentId],
  });
  assert.equal(assignment.rows[0]?.status, "accepted");
  assert.equal(
    (await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_responses")).rows[0]?.count,
    0,
  );
});

test("response rationale must satisfy the frozen rubric minimum as well as the global safety bounds", async () => {
  const seeded = await fixture({ rubricMinimum: 50 });
  const responses = requestFor(seeded.runCases);
  responses[0] = { ...responses[0]!, rationale: "Globally valid rationale." };
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:frozen-rationale",
        responses,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_rationale",
  );
  const assignment = await dbClient.execute({
    sql: "SELECT status FROM tokenless_assurance_assignments WHERE assignment_id = ?",
    args: [seeded.assignmentId],
  });
  assert.equal(assignment.rows[0]?.status, "accepted");
});

test("paid assurance responses fail closed before assignments can claim a terminal state", async () => {
  await assert.rejects(
    () => fixture({ paid: true }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_assignment_settlement_unavailable",
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_assignments")).rows[0]?.count),
    0,
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_responses")).rows[0]?.count),
    0,
  );

  const seeded = await fixture();
  const storedPolicy = await dbClient.execute({
    sql: `SELECT ap.policy_id, ap.policy_json FROM tokenless_assurance_audience_policies ap
          JOIN tokenless_assurance_runs r
            ON r.audience_policy_id = ap.policy_id AND r.audience_policy_version = ap.version
          WHERE r.run_id = ?`,
    args: [seeded.runId],
  });
  const paidPolicy = { ...JSON.parse(String(storedPolicy.rows[0]?.policy_json)), compensation: "paid" };
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET policy_json = ? WHERE policy_id = ?",
    args: [JSON.stringify(paidPolicy), storedPolicy.rows[0]?.policy_id],
  });
  await assert.rejects(
    () =>
      submitAssuranceResponses({
        assignmentId: seeded.assignmentId,
        baseAccountAddress: REVIEWER,
        idempotencyKey: "response:test:paid-gate",
        responses: requestFor(seeded.runCases),
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "assurance_assignment_settlement_unavailable",
  );
  assert.equal(
    Number((await dbClient.execute("SELECT COUNT(*) AS count FROM tokenless_assurance_responses")).rows[0]?.count),
    0,
  );
  assert.equal(
    (
      await dbClient.execute({
        sql: "SELECT status FROM tokenless_assurance_assignments WHERE assignment_id = ?",
        args: [seeded.assignmentId],
      })
    ).rows[0]?.status,
    "accepted",
  );
});
