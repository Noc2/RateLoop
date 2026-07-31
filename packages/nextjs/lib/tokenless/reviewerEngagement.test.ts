import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { PoolClient } from "pg";
import { type DatabaseResources, __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { putWorkspaceEmploymentDataGovernance } from "~~/lib/tokenless/employmentDataGovernance";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import {
  REVIEWER_ENGAGEMENT_ACTIVE_INTERVAL_CAP_SECONDS,
  REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR,
  __reviewerEngagementConcurrencyTestUtils,
  getWorkspaceEngagementAggregate,
  getWorkspaceReviewerEngagementAnalytics,
  purgeWorkspaceExpiredReviewerEngagementIdentities,
  recordReviewerEngagementEvent,
  recordReviewerEngagementEventInTransaction,
} from "~~/lib/tokenless/reviewerEngagement";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const OWNER = "0x1111111111111111111111111111111111111111";
const ADMIN = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const REVIEWER_A = "rlp_engagement_reviewer_principal_a001";
const REVIEWER_B = "rlp_engagement_reviewer_principal_b001";

let resources: DatabaseResources;

beforeEach(() => {
  resources = createMemoryDatabaseResources();
  __setDatabaseResourcesForTests(resources);
});

afterEach(() => __setDatabaseResourcesForTests(null));

function analyticsBody(overrides: Record<string, unknown> = {}) {
  return {
    processingMode: "reviewer_analytics",
    controllerRole: "Customer controller",
    processorRole: "RateLoop instructed processor",
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
    ...overrides,
  };
}

async function addMember(workspaceId: string, accountAddress: string, role: "admin" | "member") {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [workspaceId, accountAddress, role, new Date("2030-01-01T00:00:00.000Z")],
  });
}

async function append(
  client: PoolClient,
  input: {
    workspaceId: string;
    assignmentId: string;
    reviewer?: string;
    type: "first_artifact_access" | "active_interaction" | "idle" | "reopened" | "submitted";
    at: Date;
    key: string;
  },
) {
  return recordReviewerEngagementEventInTransaction(
    {
      workspaceId: input.workspaceId,
      assignmentId: input.assignmentId,
      reviewerAccountAddress: input.reviewer ?? REVIEWER_A,
      eventType: input.type,
      idempotencyKey: input.key,
      now: input.at,
    },
    client,
  );
}

async function appendCompletedAssignment(
  client: PoolClient,
  input: {
    workspaceId: string;
    assignmentId: string;
    reviewer?: string;
    startedAt: Date;
    durationMilliseconds: number;
  },
) {
  await append(client, {
    ...input,
    type: "first_artifact_access",
    at: input.startedAt,
    key: `${input.assignmentId}:access`,
  });
  await append(client, {
    ...input,
    type: "submitted",
    at: new Date(input.startedAt.getTime() + input.durationMilliseconds),
    key: `${input.assignmentId}:submit`,
  });
}

test("reviewer analytics lock the workspace before checking the latest governance version", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      const normalized = sql.replace(/\s+/gu, " ").trim();
      queries.push(normalized);
      if (normalized === "BEGIN") return { rowCount: null, rows: [] };
      if (normalized.includes("FROM tokenless_workspace_members")) return { rowCount: 1, rows: [{ role: "owner" }] };
      if (normalized.includes("FROM tokenless_workspaces") && normalized.endsWith("FOR UPDATE")) {
        return { rowCount: 1, rows: [{ workspace_id: "workspace_lock" }] };
      }
      return {
        rowCount: 1,
        rows: [
          {
            version: 2,
            processing_mode: "reviewer_analytics",
            controller_role: "controller",
            processor_role: "processor",
            lawful_basis_record_reference: "lawful-basis",
            necessity_record_reference: "necessity",
            worker_notice_reference: "notice",
            retention_policy_reference: "retention",
            access_policy_reference: "access",
            dpia_status: "completed",
            dpia_reference: "dpia",
            data_subject_process_reference: "rights",
            works_council_status: "agreement_recorded",
            works_council_reference: "agreement",
            reviewer_analytics_activated_at: new Date("2030-01-01T00:00:00.000Z"),
            reviewer_analytics_activated_by: OWNER,
          },
        ],
      };
    },
  } as unknown as PoolClient;

  await __reviewerEngagementConcurrencyTestUtils.beginReviewerAnalyticsRead(client, {
    accountAddress: OWNER,
    workspaceId: "workspace_lock",
  });

  assert.equal(queries[0], "BEGIN");
  assert.match(queries[1]!, /FROM tokenless_workspace_members/u);
  assert.match(queries[2]!, /FROM tokenless_workspaces[\s\S]*FOR UPDATE$/u);
  assert.match(queries[3]!, /FROM tokenless_workspace_employment_data_governance_versions/u);
});

test("engagement events are idempotent, strictly monotonic and distinguish active, idle, reopen and submit", async () => {
  const { workspaceId } = await createWorkspace({ name: "Engagement events", ownerAddress: OWNER });
  await addMember(workspaceId, MEMBER, "member");
  const client = (await resources.pool.connect()) as PoolClient;
  const base = new Date("2030-03-01T00:00:00.000Z");
  try {
    const first = await append(client, {
      workspaceId,
      assignmentId: "assignment_long",
      type: "first_artifact_access",
      at: base,
      key: "assignment_long:access",
    });
    assert.equal(first.sequence, 1);
    assert.match(first.reviewerSubjectId, /^engsub_[0-9a-f]{40}$/u);
    assert.equal("reviewerAccountAddress" in first, false);
    const replay = await append(client, {
      workspaceId,
      assignmentId: "assignment_long",
      type: "first_artifact_access",
      at: new Date(base.getTime() + 1_000),
      key: "assignment_long:access",
    });
    assert.deepEqual(replay, first);

    await append(client, {
      workspaceId,
      assignmentId: "assignment_long",
      type: "idle",
      at: new Date(base.getTime() + 600_000),
      key: "assignment_long:idle",
    });
    await assert.rejects(
      () =>
        append(client, {
          workspaceId,
          assignmentId: "assignment_long",
          type: "active_interaction",
          at: new Date(base.getTime() + 601_000),
          key: "assignment_long:idle",
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "reviewer_engagement_idempotency_conflict",
    );
    await append(client, {
      workspaceId,
      assignmentId: "assignment_long",
      type: "reopened",
      at: new Date(base.getTime() + 900_000),
      key: "assignment_long:reopen",
    });
    const submitted = await append(client, {
      workspaceId,
      assignmentId: "assignment_long",
      type: "submitted",
      at: new Date(base.getTime() + 930_000),
      key: "assignment_long:submit",
    });
    assert.equal(submitted.sequence, 4);

    await append(client, {
      workspaceId,
      assignmentId: "assignment_timestamp",
      type: "first_artifact_access",
      at: base,
      key: "assignment_timestamp:access",
    });
    await assert.rejects(
      () =>
        append(client, {
          workspaceId,
          assignmentId: "assignment_timestamp",
          type: "active_interaction",
          at: base,
          key: "assignment_timestamp:interaction",
        }),
      (error: unknown) =>
        error instanceof TokenlessServiceError && error.code === "reviewer_engagement_timestamp_conflict",
    );

    for (let index = 0; index < REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR - 1; index += 1) {
      await appendCompletedAssignment(client, {
        workspaceId,
        assignmentId: `assignment_zero_${index}`,
        startedAt: new Date(base.getTime() + (index + 1) * 60_000),
        durationMilliseconds: 500,
      });
    }
  } finally {
    client.release();
  }

  const aggregate = await getWorkspaceEngagementAggregate({
    accountAddress: OWNER,
    workspaceId,
    windowStartedAt: base,
    windowEndedAt: new Date(base.getTime() + 24 * 60 * 60 * 1_000),
  });
  assert.equal(aggregate.status, "available");
  assert.equal(aggregate.completedAssignmentCount, REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR);
  assert.equal(aggregate.metrics?.idleIntervalCount, 1);
  assert.equal(aggregate.metrics?.reopenedAssignmentCount, 1);
  assert.equal(aggregate.metrics?.zeroActiveEngagementCount, REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR - 1);
  assert.equal(aggregate.metrics?.meanActiveEngagementSeconds, 22);
  assert.equal(REVIEWER_ENGAGEMENT_ACTIVE_INTERVAL_CAP_SECONDS, 300);
  assert.equal("overrideCount" in (aggregate.metrics ?? {}), false);
  assert.equal("supersedesCount" in (aggregate.metrics ?? {}), false);

  await assert.rejects(
    () =>
      getWorkspaceEngagementAggregate({
        accountAddress: MEMBER,
        workspaceId,
        windowStartedAt: base,
        windowEndedAt: new Date(base.getTime() + 24 * 60 * 60 * 1_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  await assert.rejects(
    () =>
      getWorkspaceReviewerEngagementAnalytics({
        accountAddress: OWNER,
        workspaceId,
        windowStartedAt: base,
        windowEndedAt: new Date(base.getTime() + 24 * 60 * 60 * 1_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_analytics_disabled",
  );

  const stored = await dbClient.execute({
    sql: `SELECT reviewer_subject_id,idempotency_key_hash,request_hash,employment_governance_version
          FROM tokenless_reviewer_engagement_events WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.ok(stored.rows.every(row => /^sha256:[0-9a-f]{64}$/u.test(String(row.idempotency_key_hash))));
  assert.ok(stored.rows.every(row => /^sha256:[0-9a-f]{64}$/u.test(String(row.request_hash))));
  assert.ok(stored.rows.every(row => Number(row.employment_governance_version) === 1));
  const crosswalk = await dbClient.execute({
    sql: `SELECT reviewer_subject_id,reviewer_account_address,retention_until
          FROM tokenless_reviewer_engagement_subject_crosswalk WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(crosswalk.rowCount, 1);
  assert.equal(String(crosswalk.rows[0]?.reviewer_account_address), REVIEWER_A);
  assert.equal(String(crosswalk.rows[0]?.reviewer_subject_id), String(stored.rows[0]?.reviewer_subject_id));
  assert.ok(new Date(String(crosswalk.rows[0]?.retention_until)) > base);
});

test("reviewer analytics use only analytics-governed events and suppress sub-minimum reviewer rows", async () => {
  const { workspaceId } = await createWorkspace({ name: "Governed engagement", ownerAddress: OWNER });
  await addMember(workspaceId, ADMIN, "admin");
  const client = (await resources.pool.connect()) as PoolClient;
  const base = new Date("2030-04-01T00:00:00.000Z");
  try {
    for (let index = 0; index < REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR; index += 1) {
      await appendCompletedAssignment(client, {
        workspaceId,
        assignmentId: `aggregate_history_${index}`,
        reviewer: REVIEWER_A,
        startedAt: new Date(base.getTime() + index * 60_000),
        durationMilliseconds: 1_000,
      });
    }
  } finally {
    client.release();
  }

  await putWorkspaceEmploymentDataGovernance({
    accountAddress: OWNER,
    workspaceId,
    body: analyticsBody(),
    now: new Date(base.getTime() + 24 * 60 * 60 * 1_000),
  });

  const analyticsClient = (await resources.pool.connect()) as PoolClient;
  try {
    for (let index = 0; index < REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR; index += 1) {
      await appendCompletedAssignment(analyticsClient, {
        workspaceId,
        assignmentId: `analytics_a_${index}`,
        reviewer: REVIEWER_A,
        startedAt: new Date(base.getTime() + (25 * 60 + index) * 60_000),
        durationMilliseconds: 10_000,
      });
    }
    for (let index = 0; index < REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR - 1; index += 1) {
      await appendCompletedAssignment(analyticsClient, {
        workspaceId,
        assignmentId: `analytics_b_${index}`,
        reviewer: REVIEWER_B,
        startedAt: new Date(base.getTime() + (26 * 60 + index) * 60_000),
        durationMilliseconds: 20_000,
      });
    }
  } finally {
    analyticsClient.release();
  }

  const analytics = await getWorkspaceReviewerEngagementAnalytics({
    accountAddress: ADMIN,
    workspaceId,
    windowStartedAt: base,
    windowEndedAt: new Date(base.getTime() + 3 * 24 * 60 * 60 * 1_000),
  });
  assert.equal(analytics.eligibleReviewerCount, 1);
  assert.equal(analytics.suppressedReviewerCount, 1);
  assert.deepEqual(analytics.analytics, [
    {
      reviewerAccountAddress: REVIEWER_A,
      completedAssignmentCount: REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR,
      medianActiveEngagementSeconds: 10,
      meanActiveEngagementSeconds: 10,
      medianWallClockSeconds: 10,
      idleIntervalCount: 0,
      reopenedAssignmentCount: 0,
      zeroActiveEngagementCount: 0,
    },
  ]);

  // Expiry immediately removes the identity projection even before the
  // maintenance purge. Pseudonymous aggregate evidence must not depend on the
  // crosswalk row.
  await dbClient.execute({
    sql: `UPDATE tokenless_reviewer_engagement_subject_crosswalk
          SET created_at=?,retention_until=? WHERE workspace_id=?`,
    args: [new Date("2020-01-01T00:00:00.000Z"), new Date("2021-01-01T00:00:00.000Z"), workspaceId],
  });
  const afterExpiry = await getWorkspaceReviewerEngagementAnalytics({
    accountAddress: OWNER,
    workspaceId,
    windowStartedAt: base,
    windowEndedAt: new Date(base.getTime() + 3 * 24 * 60 * 60 * 1_000),
  });
  assert.equal(afterExpiry.eligibleReviewerCount, 0);
  assert.deepEqual(afterExpiry.analytics, []);

  await assert.rejects(
    () =>
      purgeWorkspaceExpiredReviewerEngagementIdentities({
        accountAddress: MEMBER,
        workspaceId,
        now: new Date("2031-01-01T00:00:00.000Z"),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_not_found",
  );
  const purge = await purgeWorkspaceExpiredReviewerEngagementIdentities({
    accountAddress: ADMIN,
    workspaceId,
    now: new Date("2031-01-01T00:00:00.000Z"),
  });
  assert.equal(purge.purgedIdentityCount, 2);
  const identities = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_reviewer_engagement_subject_crosswalk WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(Number(identities.rows[0]?.count), 0);
  const immutableEvents = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_reviewer_engagement_events WHERE workspace_id=?`,
    args: [workspaceId],
  });
  assert.equal(Number(immutableEvents.rows[0]?.count), 88);
  const aggregateAfterPurge = await getWorkspaceEngagementAggregate({
    accountAddress: OWNER,
    workspaceId,
    windowStartedAt: base,
    windowEndedAt: new Date(base.getTime() + 3 * 24 * 60 * 60 * 1_000),
  });
  assert.equal(aggregateAfterPurge.status, "available");
  assert.equal(
    aggregateAfterPurge.completedAssignmentCount,
    REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR * 2 + REVIEWER_ENGAGEMENT_MINIMUM_DENOMINATOR - 1,
  );

  await putWorkspaceEmploymentDataGovernance({
    accountAddress: OWNER,
    workspaceId,
    body: {
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
    },
    now: new Date(base.getTime() + 4 * 24 * 60 * 60 * 1_000),
  });
  await assert.rejects(
    () =>
      getWorkspaceReviewerEngagementAnalytics({
        accountAddress: OWNER,
        workspaceId,
        windowStartedAt: base,
        windowEndedAt: new Date(base.getTime() + 5 * 24 * 60 * 60 * 1_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "reviewer_analytics_disabled",
  );
});

test("reviewer-facing recorder fails closed outside the exact assignment scope", async () => {
  const { workspaceId } = await createWorkspace({ name: "Assignment scope", ownerAddress: OWNER });
  await assert.rejects(
    () =>
      recordReviewerEngagementEvent({
        accountAddress: REVIEWER_A,
        workspaceId,
        assignmentId: "missing_assignment",
        eventType: "first_artifact_access",
        idempotencyKey: "missing_assignment:access",
        now: new Date("2030-05-01T00:00:00.000Z"),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assignment_not_found",
  );
});
