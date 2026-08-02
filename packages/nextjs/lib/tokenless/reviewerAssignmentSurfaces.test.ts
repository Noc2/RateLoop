import {
  filterPrivateAssignmentsForView,
  paidReviewCompletionSql,
  privateAssignmentBelongsInView,
  privateAssignmentQueueIncludesPaid,
  reviewerAssignmentDisplayStatus,
} from "./reviewerAssignmentSurfaces";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { type DatabaseResources, type QueryInput, __setDatabaseResourcesForTests } from "~~/lib/db";
import { readAccountBoundAssignments } from "~~/lib/tokenless/answerQueue";
import { listReviewerAssignments } from "~~/lib/tokenless/reviewerAssignments";

const unpaidAssignment = { assignmentId: "assignment_unpaid", paidAssignment: false };
const paidAssignment = { assignmentId: "assignment_paid", paidAssignment: true };

const queries: QueryInput[] = [];

beforeEach(() => {
  queries.length = 0;
  __setDatabaseResourcesForTests({
    client: {
      async execute(input: QueryInput) {
        queries.push(input);
        const sql = typeof input === "string" ? input : input.sql;
        if (sql.includes("FROM tokenless_private_unpaid_review_assignments")) {
          return { rowCount: 0, rows: [] };
        }
        return {
          rowCount: 2,
          rows: [
            {
              assignment_id: unpaidAssignment.assignmentId,
              status: "accepted",
              paid_assignment: false,
              created_at: "2026-08-02T10:00:00.000Z",
            },
            {
              assignment_id: paidAssignment.assignmentId,
              status: "accepted",
              paid_assignment: true,
              created_at: "2026-08-02T11:00:00.000Z",
            },
          ],
        };
      },
    },
    database: {},
    pool: {},
  } as unknown as DatabaseResources);
});

afterEach(() => __setDatabaseResourcesForTests(null));

test("the shared queue invariant gives active paid work to the paid task surface", () => {
  assert.equal(privateAssignmentQueueIncludesPaid("active"), false);
  assert.equal(privateAssignmentQueueIncludesPaid("history"), true);
  assert.equal(privateAssignmentQueueIncludesPaid("all"), true);

  assert.equal(privateAssignmentBelongsInView(unpaidAssignment, "active"), true);
  assert.equal(privateAssignmentBelongsInView(paidAssignment, "active"), false);
  assert.deepEqual(filterPrivateAssignmentsForView([unpaidAssignment, paidAssignment], "active"), [unpaidAssignment]);
  assert.deepEqual(filterPrivateAssignmentsForView([unpaidAssignment, paidAssignment], "history"), [
    unpaidAssignment,
    paidAssignment,
  ]);
});

test("a confirmed paid commit projects the invited assignment as completed", () => {
  assert.equal(
    reviewerAssignmentDisplayStatus({
      paidAssignment: true,
      paidCommitState: "confirmed",
      persistedStatus: "accepted",
    }),
    "completed",
  );
  for (const paidCommitState of [null, "prepared", "submitted", "failed"]) {
    assert.equal(
      reviewerAssignmentDisplayStatus({
        paidAssignment: true,
        paidCommitState,
        persistedStatus: "accepted",
      }),
      "accepted",
    );
  }
  assert.equal(
    reviewerAssignmentDisplayStatus({
      paidAssignment: false,
      paidCommitState: "confirmed",
      persistedStatus: "expired",
    }),
    "expired",
  );
  assert.equal(
    paidReviewCompletionSql("rp.compensation_mode", "a.assignment_id"),
    `(rp.compensation_mode='usdc' AND a.assignment_id IN (
    SELECT completion_seat.assignment_id
    FROM tokenless_paid_assignment_seats completion_seat
    JOIN tokenless_paid_review_voucher_issuances completion_issuance
      ON completion_issuance.issuance_id=completion_seat.voucher_issuance_id
    JOIN tokenless_rater_commits completion_commit
      ON completion_commit.voucher_id=completion_issuance.voucher_id
    WHERE completion_commit.state IN ('confirmed')
  ))`,
  );
});

test("the server listing and browser queue apply the same paid-assignment boundary", async () => {
  const principalId = "rlp_reviewer_surface_test";
  const active = await listReviewerAssignments({ accountAddress: principalId, view: "active" });
  const history = await listReviewerAssignments({ accountAddress: principalId, view: "history" });

  assert.deepEqual(
    active.map(assignment => assignment.assignmentId),
    [unpaidAssignment.assignmentId],
  );
  assert.deepEqual(
    history.map(assignment => assignment.assignmentId),
    [paidAssignment.assignmentId, unpaidAssignment.assignmentId],
  );
  assert.deepEqual(
    readAccountBoundAssignments({ principalId, assignments: history }, principalId, "active").map(
      assignment => (assignment as { assignmentId: string }).assignmentId,
    ),
    [unpaidAssignment.assignmentId],
  );

  const standardListings = queries.filter(input => {
    const sql = typeof input === "string" ? input : input.sql;
    return sql.includes("FROM tokenless_assurance_assignments a");
  });
  assert.equal(standardListings.length, 2);
  for (const input of standardListings) {
    assert.ok(typeof input !== "string");
    assert.match(input.sql, /\(\? OR a\.paid_assignment=FALSE\)/u);
  }
  assert.equal((standardListings[0] as Exclude<QueryInput, string>).args?.[5], false);
  assert.equal((standardListings[1] as Exclude<QueryInput, string>).args?.[5], true);

  const directListings = queries.filter(input => {
    const sql = typeof input === "string" ? input : input.sql;
    return sql.includes("FROM tokenless_private_unpaid_review_assignments");
  });
  assert.equal(directListings.length, 2);
  for (const input of directListings) {
    assert.ok(typeof input !== "string");
    assert.match(input.sql, /\(\? OR rp\.compensation_mode='unpaid'\)/u);
    assert.match(input.sql, /rp\.compensation_mode='usdc' AND a\.assignment_id IN \(/u);
    assert.match(input.sql, /completion_commit\.state IN \('confirmed'\)/u);
  }
  assert.equal((directListings[0] as Exclude<QueryInput, string>).args?.[3], false);
  assert.equal((directListings[1] as Exclude<QueryInput, string>).args?.[3], true);
});

test("review history returns a confirmed invited paid commit as completed", async () => {
  const principalId = "rlp_reviewer_surface_confirmed_paid";
  __setDatabaseResourcesForTests({
    client: {
      async execute(input: QueryInput) {
        const sql = typeof input === "string" ? input : input.sql;
        if (sql.includes("FROM tokenless_assurance_assignments a")) return { rowCount: 0, rows: [] };
        if (sql.includes("FROM tokenless_private_unpaid_review_assignments a")) {
          return {
            rowCount: 1,
            rows: [
              {
                assignment_id: "assignment_paid_confirmed",
                status: "accepted",
                paid_commit_state: "confirmed",
                compensation_mode: "usdc",
                project_name: "Paid review",
                data_classification: "synthetic",
                private_group_policy_hash: `sha256:${"a".repeat(64)}`,
                reservation_expires_at: "2026-08-02T10:00:00.000Z",
                assignment_expires_at: "2026-08-02T12:00:00.000Z",
                response_deadline: "2026-08-02T12:00:00.000Z",
                created_at: "2026-08-02T09:00:00.000Z",
                updated_at: "2026-08-02T10:30:00.000Z",
                criterion: "Review the result",
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    },
    database: {},
    pool: {},
  } as unknown as DatabaseResources);

  const history = await listReviewerAssignments({ accountAddress: principalId, view: "history" });
  assert.equal(history.length, 1);
  assert.equal(history[0]?.paidAssignment, true);
  assert.equal(history[0]?.status, "completed");
});
