import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  REVIEWER_ANALYTICS_ACTIVATION_GATES,
  getWorkspaceEmploymentDataGovernance,
  putWorkspaceEmploymentDataGovernance,
} from "~~/lib/tokenless/employmentDataGovernance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const ADMIN = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const OUTSIDER = "0x4444444444444444444444444444444444444444";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function aggregateBody(overrides: Record<string, unknown> = {}) {
  return {
    processingMode: "aggregate_only",
    controllerRole: null,
    processorRole: null,
    lawfulBasisRecordReference: null,
    necessityRecordReference: null,
    workerNoticeReference: null,
    retentionPolicyReference: null,
    accessPolicyReference: null,
    dpiaStatus: "not_started",
    dpiaReference: null,
    dataSubjectProcessReference: null,
    worksCouncilStatus: "blocked",
    worksCouncilReference: null,
    ...overrides,
  };
}

function analyticsBody(overrides: Record<string, unknown> = {}) {
  return aggregateBody({
    processingMode: "reviewer_analytics",
    controllerRole: "Customer acts as controller for employment decisions",
    processorRole: "RateLoop acts only as instructed processor",
    lawfulBasisRecordReference: "governance/lawful-basis/v1",
    necessityRecordReference: "governance/necessity/v1",
    workerNoticeReference: "governance/worker-notice/v1",
    retentionPolicyReference: "governance/retention/v1",
    accessPolicyReference: "governance/access/v1",
    dpiaStatus: "completed",
    dpiaReference: "governance/dpia/v1",
    dataSubjectProcessReference: "governance/data-subject-process/v1",
    worksCouncilStatus: "agreement_recorded",
    worksCouncilReference: "governance/works-council-agreement/v1",
    ...overrides,
  });
}

async function addMember(workspaceId: string, accountAddress: string, role: "admin" | "member") {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [workspaceId, accountAddress, role, new Date("2030-01-01T00:00:00.000Z")],
  });
}

test("new workspaces start at an explicit aggregate-only governance version visible only to managers", async () => {
  const { workspaceId } = await createWorkspace({ name: "Employment governance", ownerAddress: OWNER });
  await addMember(workspaceId, ADMIN, "admin");
  await addMember(workspaceId, MEMBER, "member");

  const initial = await getWorkspaceEmploymentDataGovernance({ accountAddress: OWNER, workspaceId });
  assert.equal(initial.version, 1);
  assert.equal(initial.processingMode, "aggregate_only");
  assert.equal(initial.dpiaStatus, "not_started");
  assert.equal(initial.worksCouncilStatus, "blocked");
  assert.deepEqual(initial.reviewerAnalyticsActivationGaps, [...REVIEWER_ANALYTICS_ACTIVATION_GATES]);
  assert.equal(
    (await getWorkspaceEmploymentDataGovernance({ accountAddress: ADMIN, workspaceId })).workspaceId,
    workspaceId,
  );

  for (const accountAddress of [MEMBER, OUTSIDER]) {
    await assert.rejects(
      () => getWorkspaceEmploymentDataGovernance({ accountAddress, workspaceId }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
    );
  }
});

test("owner and admin changes append complete versions and the matching audit event atomically", async () => {
  const { workspaceId } = await createWorkspace({ name: "Versioned governance", ownerAddress: OWNER });
  await addMember(workspaceId, ADMIN, "admin");

  const prepared = await putWorkspaceEmploymentDataGovernance({
    accountAddress: OWNER,
    workspaceId,
    body: aggregateBody({
      controllerRole: "Customer controller",
      processorRole: "RateLoop processor",
      lawfulBasisRecordReference: "governance/lawful-basis/v1",
    }),
    now: new Date("2030-02-01T00:00:00.000Z"),
  });
  assert.equal(prepared.version, 2);
  assert.equal(prepared.processingMode, "aggregate_only");
  assert.equal(prepared.reviewerAnalyticsActivatedAt, null);

  const activatedAt = new Date("2030-02-02T00:00:00.000Z");
  const activated = await putWorkspaceEmploymentDataGovernance({
    accountAddress: ADMIN,
    workspaceId,
    body: analyticsBody(),
    now: activatedAt,
  });
  assert.equal(activated.version, 3);
  assert.equal(activated.processingMode, "reviewer_analytics");
  assert.deepEqual(activated.reviewerAnalyticsActivationGaps, []);
  assert.equal(activated.reviewerAnalyticsActivatedAt, activatedAt.toISOString());
  assert.equal(activated.reviewerAnalyticsActivatedBy, ADMIN);

  const noOp = await putWorkspaceEmploymentDataGovernance({
    accountAddress: ADMIN,
    workspaceId,
    body: analyticsBody(),
    now: new Date("2030-02-03T00:00:00.000Z"),
  });
  assert.equal(noOp.version, 3);
  assert.equal(noOp.reviewerAnalyticsActivatedAt, activatedAt.toISOString());

  const versions = await dbClient.execute({
    sql: `SELECT version, processing_mode, reviewer_analytics_activated_by
          FROM tokenless_workspace_employment_data_governance_versions
          WHERE workspace_id = ? ORDER BY version`,
    args: [workspaceId],
  });
  assert.deepEqual(
    versions.rows.map(row => ({
      version: Number(row.version),
      processingMode: String(row.processing_mode),
      activatedBy: row.reviewer_analytics_activated_by === null ? null : String(row.reviewer_analytics_activated_by),
    })),
    [
      { version: 1, processingMode: "aggregate_only", activatedBy: null },
      { version: 2, processingMode: "aggregate_only", activatedBy: null },
      { version: 3, processingMode: "reviewer_analytics", activatedBy: ADMIN },
    ],
  );
  const audits = await dbClient.execute({
    sql: `SELECT action, target_id, metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'employment_data.governance.updated'
          ORDER BY sequence`,
    args: [workspaceId],
  });
  assert.equal(audits.rowCount, 2);
  assert.equal(String(audits.rows[1]?.target_id), `${workspaceId}:3`);
  assert.match(String(audits.rows[1]?.metadata_json), /"processingMode":"reviewer_analytics"/u);
});

test("reviewer analytics activation fails closed for every incomplete employment-data gate", async () => {
  const { workspaceId } = await createWorkspace({ name: "Closed analytics", ownerAddress: OWNER });
  const incomplete: Array<[string, unknown]> = [
    ["controllerRole", null],
    ["processorRole", null],
    ["lawfulBasisRecordReference", null],
    ["necessityRecordReference", null],
    ["workerNoticeReference", null],
    ["retentionPolicyReference", null],
    ["accessPolicyReference", null],
    ["dpiaReference", null],
    ["dataSubjectProcessReference", null],
    ["worksCouncilReference", null],
    ["dpiaStatus", "not_started"],
    ["worksCouncilStatus", "blocked"],
  ];

  for (const [field, value] of incomplete) {
    await assert.rejects(
      () =>
        putWorkspaceEmploymentDataGovernance({
          accountAddress: OWNER,
          workspaceId,
          body: analyticsBody({ [field]: value }),
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "reviewer_analytics_governance_incomplete",
      field,
    );
  }
  await assert.rejects(
    () =>
      putWorkspaceEmploymentDataGovernance({
        accountAddress: OWNER,
        workspaceId,
        body: { ...aggregateBody(), reviewerEngagementScore: true },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_employment_data_governance",
  );
  await assert.rejects(() =>
    dbClient.execute({
      sql: `INSERT INTO tokenless_workspace_employment_data_governance_versions
            (workspace_id, version, processing_mode, dpia_status, works_council_status,
             reviewer_analytics_activated_at, reviewer_analytics_activated_by,
             effective_at, created_by, created_at)
            VALUES (?, 2, 'reviewer_analytics', 'completed', 'agreement_recorded', ?, ?, ?, ?, ?)`,
      args: [
        workspaceId,
        new Date("2030-03-01T00:00:00.000Z"),
        OWNER,
        new Date("2030-03-01T00:00:00.000Z"),
        OWNER,
        new Date("2030-03-01T00:00:00.000Z"),
      ],
    }),
  );
  const versions = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_workspace_employment_data_governance_versions
          WHERE workspace_id = ?`,
    args: [workspaceId],
  });
  assert.equal(Number(versions.rows[0]?.count), 1);
});
