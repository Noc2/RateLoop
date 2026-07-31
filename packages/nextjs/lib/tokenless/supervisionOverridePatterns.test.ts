import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { putWorkspaceEmploymentDataGovernance } from "~~/lib/tokenless/employmentDataGovernance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  type OverrideDecisionPatternSource,
  type ReviewerDisagreementPatternSource,
  type ScopeSupervisionPatternSource,
  __supervisionOverridePatternTestUtils,
  detectScopeSupervisionPatterns,
  getWorkspaceSupervisionPatterns,
} from "~~/lib/tokenless/supervisionOverridePatterns";

const OWNER = "0x1111111111111111111111111111111111111111";
const MEMBER = "0x2222222222222222222222222222222222222222";
const WORKSPACE = "workspace_a";
const OTHER_WORKSPACE = "workspace_b";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function scope(workspaceId = WORKSPACE, scopeId = "scope_a"): ScopeSupervisionPatternSource {
  return { workspaceId, scopeId, agentId: "agent_a", workflowKey: "moderation", riskTier: "high" };
}

function decisions(
  outcomes: OverrideDecisionPatternSource["outcome"][],
  workspaceId = WORKSPACE,
  scopeId = "scope_a",
): OverrideDecisionPatternSource[] {
  return outcomes.map((outcome, index) => ({
    workspaceId,
    scopeId,
    runId: `run_${index}`,
    recordId: `record_${index}`,
    supersedesRecordId: null,
    outcome,
  }));
}

function disagreements(
  values: ReviewerDisagreementPatternSource["agreement"][],
  workspaceId = WORKSPACE,
  scopeId = "scope_a",
): ReviewerDisagreementPatternSource[] {
  return values.map(agreement => ({ workspaceId, scopeId, comparable: true, agreement }));
}

function detect(input: {
  overrideDecisions?: OverrideDecisionPatternSource[];
  reviewerDisagreements?: ReviewerDisagreementPatternSource[];
  scopes?: ScopeSupervisionPatternSource[];
  minimumDenominator?: number;
}) {
  return detectScopeSupervisionPatterns({
    workspaceId: WORKSPACE,
    minimumDenominator: input.minimumDenominator ?? 3,
    sources: {
      scopes: input.scopes ?? [scope()],
      overrideDecisions: input.overrideDecisions ?? [],
      reviewerDisagreements: input.reviewerDisagreements ?? [],
    },
  })[0]!;
}

test("zero decision-owner overrides remain an evidenced zero only above the hard denominator", () => {
  const pattern = detect({
    overrideDecisions: decisions(["accepted", "accepted", "accepted"]),
    reviewerDisagreements: disagreements(["agree", "agree", "agree"]),
  });
  assert.deepEqual(pattern.decisionOwnerOverride, {
    status: "sufficient_support",
    numerator: 0,
    denominator: 3,
    minimumDenominator: 3,
    rateBps: 0,
  });
  assert.equal(pattern.operationalReversal.rateBps, 0);
  assert.equal(pattern.reviewerDisagreement.rateBps, 0);
});

test("all decision-owner overrides do not absorb operational reversals or reviewer disagreement", () => {
  const pattern = detect({
    overrideDecisions: decisions(["disregarded", "overridden", "overridden"]),
    reviewerDisagreements: disagreements(["disagree", "agree", "disagree"]),
  });
  assert.equal(pattern.decisionOwnerOverride.rateBps, 10_000);
  assert.equal(pattern.operationalReversal.rateBps, 0);
  assert.equal(pattern.reviewerDisagreement.rateBps, 6_666);
  assert.deepEqual(pattern.currentDecisionCounts, {
    accepted: 0,
    disregarded: 1,
    overridden: 2,
    reversed: 0,
  });
});

test("superseded append-only records are counted as history and only the chain head enters rates", () => {
  const pattern = detect({
    minimumDenominator: 2,
    overrideDecisions: [
      {
        workspaceId: WORKSPACE,
        scopeId: "scope_a",
        runId: "run_a",
        recordId: "record_old",
        supersedesRecordId: null,
        outcome: "accepted",
      },
      {
        workspaceId: WORKSPACE,
        scopeId: "scope_a",
        runId: "run_a",
        recordId: "record_new",
        supersedesRecordId: "record_old",
        outcome: "reversed",
      },
      ...decisions(["accepted"], WORKSPACE, "scope_a").map(row => ({ ...row, runId: "run_b" })),
    ],
  });
  assert.equal(pattern.supersessionCount, 1);
  assert.equal(pattern.currentDecisionCounts.accepted, 1);
  assert.equal(pattern.currentDecisionCounts.reversed, 1);
  assert.equal(pattern.decisionOwnerOverride.rateBps, 0);
  assert.equal(pattern.operationalReversal.rateBps, 5_000);
});

test("below-denominator samples return typed insufficient support, never an implied zero rate", () => {
  const pattern = detect({
    overrideDecisions: decisions(["accepted", "accepted"]),
    reviewerDisagreements: disagreements(["agree", "agree"]),
  });
  assert.equal(pattern.decisionOwnerOverride.status, "insufficient_support");
  assert.equal(pattern.decisionOwnerOverride.rateBps, null);
  assert.equal(pattern.operationalReversal.rateBps, null);
  assert.equal(pattern.reviewerDisagreement.rateBps, null);
  assert.throws(
    () => detect({ minimumDenominator: 1 }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "invalid_supervision_pattern_denominator",
  );
});

test("scope and reviewer projections discard cross-tenant rows even when identifiers collide", () => {
  const pattern = detect({
    minimumDenominator: 2,
    scopes: [scope(), scope(OTHER_WORKSPACE)],
    overrideDecisions: [
      ...decisions(["accepted", "accepted"]),
      ...decisions(["overridden", "overridden"], OTHER_WORKSPACE),
    ],
    reviewerDisagreements: [
      ...disagreements(["agree", "agree"]),
      ...disagreements(["disagree", "disagree"], OTHER_WORKSPACE),
    ],
  });
  assert.equal(pattern.decisionOwnerOverride.rateBps, 0);
  assert.equal(pattern.reviewerDisagreement.rateBps, 0);

  const reviewers = __supervisionOverridePatternTestUtils.detectReviewerSupervisionPatterns({
    workspaceId: WORKSPACE,
    minimumDenominator: 2,
    assignments: [
      ...["assignment_a", "assignment_b"].map((assignmentId, index) => ({
        workspaceId: WORKSPACE,
        scopeId: "scope_a",
        runId: `run_${index}`,
        assignmentId,
        reviewerReference: "reviewer_a",
      })),
      {
        workspaceId: OTHER_WORKSPACE,
        scopeId: "scope_a",
        runId: "run_0",
        assignmentId: "assignment_other",
        reviewerReference: "reviewer_a",
      },
    ],
    overrideDecisions: [...decisions(["accepted", "accepted"]), ...decisions(["overridden"], OTHER_WORKSPACE)],
  });
  assert.equal(reviewers.length, 1);
  assert.equal(reviewers[0]?.decisionOwnerOverrideAssociation.rateBps, 0);
});

function analyticsBody() {
  return {
    processingMode: "reviewer_analytics",
    controllerRole: "Customer controller",
    processorRole: "RateLoop processor",
    lawfulBasisRecordReference: "governance/lawful-basis/v1",
    necessityRecordReference: "governance/necessity/v1",
    workerNoticeReference: "governance/worker-notice/v1",
    retentionPolicyReference: "governance/retention/v1",
    accessPolicyReference: "governance/access/v1",
    dpiaStatus: "completed",
    dpiaReference: "governance/dpia/v1",
    dataSubjectProcessReference: "governance/data-subject-process/v1",
    worksCouncilStatus: "agreement_recorded",
    worksCouncilReference: "governance/works-council/v1",
  };
}

test("aggregate output is manager-only, identity-free, and functional while reviewer analytics are off", async () => {
  const created = await createWorkspace({ name: "Aggregate supervision", ownerAddress: OWNER });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?)`,
    args: [created.workspaceId, MEMBER, new Date("2030-01-01T00:00:00.000Z")],
  });
  const aggregate = await getWorkspaceSupervisionPatterns({
    accountAddress: OWNER,
    workspaceId: created.workspaceId,
  });
  assert.equal(aggregate.projection, "scope");
  assert.equal("reviewers" in aggregate, false);
  assert.doesNotMatch(JSON.stringify(aggregate), /reviewerReference|reviewer_account_address/u);
  await assert.rejects(
    () =>
      getWorkspaceSupervisionPatterns({
        accountAddress: MEMBER,
        workspaceId: created.workspaceId,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
});

test("works-council-off mode fails before reviewer projection and complete governance enables it", async () => {
  const created = await createWorkspace({ name: "Governed supervision", ownerAddress: OWNER });
  await assert.rejects(
    () =>
      getWorkspaceSupervisionPatterns({
        accountAddress: OWNER,
        workspaceId: created.workspaceId,
        projection: "reviewer",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_analytics_disabled",
  );

  await putWorkspaceEmploymentDataGovernance({
    accountAddress: OWNER,
    workspaceId: created.workspaceId,
    body: analyticsBody(),
  });
  const projection = await getWorkspaceSupervisionPatterns({
    accountAddress: OWNER,
    workspaceId: created.workspaceId,
    projection: "reviewer",
  });
  assert.equal(projection.projection, "reviewer");
  assert.deepEqual(projection.reviewers, []);
});
