import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
import { recordAssuranceOverrideDecision } from "~~/lib/tokenless/evidencePackets";
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
import { getOversightRunCaseView } from "~~/lib/tokenless/oversightCaseView";
import { type ProductPrincipal, createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const REVIEWER = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x5555555555555555555555555555555555555555";
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

/** Invited-lane run with two cases and one submitted response batch. */
async function fixture() {
  const { workspaceId } = await createWorkspace({ name: "Case view", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, new Date()],
  });
  const { apiKeyId } = await createWorkspaceApiKey({ workspaceId, name: "case view fixture" });
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
      rationale: { mode: "required", minLength: 10, maxLength: 2_000 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6_000,
        minimumValidResponses: 1,
      },
    },
  });
  const caseInputs = [
    { baseline: `case_view_base_1`, candidate: `case_view_candidate_1`, marker: ["b", "c"] },
    { baseline: `case_view_base_2`, candidate: `case_view_candidate_2`, marker: ["d", "e"] },
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
      compensation: "unpaid",
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
              assignment_expires_at = ?, lease_state = 'issued', updated_at = ?
          WHERE assignment_id = ?`,
    args: [now, now, new Date(now.getTime() + 3_600_000), now, reserved.assignmentId],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_assignments SET qualification_provenance_json = '[]' WHERE assignment_id = ?",
    args: [reserved.assignmentId],
  });
  await transitionAssuranceRun({ principal, runId: run.runId, status: "recruiting" });
  const runCases = await dbClient.execute({
    sql: `SELECT rc.case_id, rc.variant_a_artifact_id, rc.variant_b_artifact_id
          FROM tokenless_assurance_run_cases rc WHERE rc.run_id = ? ORDER BY rc.position`,
    args: [run.runId],
  });
  await submitAssuranceResponses({
    assignmentId: reserved.assignmentId,
    baseAccountAddress: REVIEWER,
    idempotencyKey: "case-view-batch-1",
    responses: (runCases.rows as Array<Record<string, unknown>>).map((row, index) => ({
      caseId: String(row.case_id),
      displayedOption: (index === 0 ? "A" : "B") as "A" | "B",
      selectedArtifactId: String(index === 0 ? row.variant_a_artifact_id : row.variant_b_artifact_id),
      failureTagKeys: index === 0 ? ["incorrect"] : [],
      rationale: `The selected response follows the frozen instructions more precisely ${index}.`,
    })),
  });
  return { workspaceId, projectId, runId: run.runId, audiencePolicyId: audience.policy.policyId, caseIds };
}

async function markRunCompleted(runId: string) {
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_runs SET status = 'completed', completed_at = ? WHERE run_id = ?",
    args: [new Date(), runId],
  });
}

test("invited-lane case detail shows material, plaintext rationales, disagreement, and override history", async () => {
  const seeded = await fixture();
  // Completed runs only: the view refuses while the run is still collecting.
  await assert.rejects(
    getOversightRunCaseView({ accountAddress: OWNER, workspaceId: seeded.workspaceId, runId: seeded.runId }),
    (error: TokenlessServiceError) => error.code === "assurance_run_not_completed",
  );
  await markRunCompleted(seeded.runId);
  await recordAssuranceOverrideDecision({
    accountAddress: OWNER,
    workspaceId: seeded.workspaceId,
    runId: seeded.runId,
    outcome: "overridden",
    reasons: "Reviewer disagreement was decisive; the output was replaced.",
  });

  const view = await getOversightRunCaseView({
    accountAddress: OWNER,
    workspaceId: seeded.workspaceId,
    runId: seeded.runId,
  });
  assert.equal(view.lane, "customer_invited");
  assert.equal(view.detailAvailable, true);
  assert.equal(view.note, null);
  assert.equal(view.cases.length, 2);
  const first = view.cases[0]!;
  assert.equal(first.title, "Support case 1");
  assert.match(first.instructions, /frozen support policy/);
  assert.deepEqual(
    first.artifacts.map(artifact => artifact.role),
    ["baseline", "candidate"],
  );
  assert.equal(first.responses.length, 1);
  assert.match(first.responses[0]!.rationale ?? "", /follows the frozen instructions more precisely 0\./);
  assert.deepEqual(first.responses[0]!.failureTagKeys, ["incorrect"]);
  assert.match(first.responses[0]!.reviewerPseudonym, /^reviewer-[0-9a-f]{8}$/);
  // One valid response per case: unanimous, zero dissent.
  assert.equal(first.choiceCounts.baseline + first.choiceCounts.candidate, 1);
  assert.equal(first.disagreementBps, 0);
  // The raw reviewer account never appears anywhere in the view.
  assert.doesNotMatch(JSON.stringify(view), new RegExp(REVIEWER.slice(2), "iu"));
  assert.equal(view.overrideDecisions.length, 1);
  assert.equal(view.overrideDecisions[0]?.outcome, "overridden");
});

test("access control: non-decision members are denied, decision owners admitted, network lane stays aggregate", async () => {
  const seeded = await fixture();
  await markRunCompleted(seeded.runId);

  // Plain members fail the decision gate.
  await assert.rejects(
    getOversightRunCaseView({ accountAddress: MEMBER, workspaceId: seeded.workspaceId, runId: seeded.runId }),
    (error: TokenlessServiceError) => error.code === "assurance_decision_forbidden" && error.status === 403,
  );
  // Outsiders see nothing at all.
  await assert.rejects(
    getOversightRunCaseView({
      accountAddress: "0x9999999999999999999999999999999999999999",
      workspaceId: seeded.workspaceId,
      runId: seeded.runId,
    }),
    (error: TokenlessServiceError) => error.code === "assurance_run_not_found",
  );
  // A designated decision owner passes the same gate as owners and admins.
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_governance
          (workspace_id, account_address, governance_role, created_by, created_at, updated_at)
          VALUES (?, ?, 'decision_owner', ?, ?, ?)`,
    args: [seeded.workspaceId, MEMBER, OWNER, new Date(), new Date()],
  });
  const memberView = await getOversightRunCaseView({
    accountAddress: MEMBER,
    workspaceId: seeded.workspaceId,
    runId: seeded.runId,
  });
  assert.equal(memberView.detailAvailable, true);

  // Public-network runs keep the aggregate-only view with an explanatory note.
  await dbClient.execute({
    sql: "UPDATE tokenless_assurance_audience_policies SET reviewer_source = 'rateloop_network' WHERE policy_id = ?",
    args: [seeded.audiencePolicyId],
  });
  const networkView = await getOversightRunCaseView({
    accountAddress: OWNER,
    workspaceId: seeded.workspaceId,
    runId: seeded.runId,
  });
  assert.equal(networkView.detailAvailable, false);
  assert.equal(networkView.cases.length, 0);
  assert.match(networkView.note ?? "", /aggregate-only/);
  assert.doesNotMatch(JSON.stringify(networkView), /follows the frozen instructions/);
});

test("the cases route is a session-scoped no-store read of the oversight view", () => {
  const source = readFileSync(
    new URL("../../app/api/account/workspaces/[workspaceId]/assurance/runs/[runId]/cases/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireBrowserSession\(request\)/u);
  assert.match(source, /getOversightRunCaseView/u);
  assert.match(source, /private, no-store/u);
  assert.doesNotMatch(source, /export async function (POST|PUT|DELETE)/u);
});
