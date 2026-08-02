export type ReviewerAssignmentQueueView = "active" | "history" | "all";

export type ReviewerAssignmentSurfaceEntry = {
  paidAssignment?: unknown;
};

export const PAID_REVIEW_COMPLETED_COMMIT_STATES = ["confirmed"] as const;

export function paidReviewCompletionSql(compensationColumn: string, assignmentIdColumn: string) {
  const states = PAID_REVIEW_COMPLETED_COMMIT_STATES.map(state => `'${state}'`).join(",");
  return `(${compensationColumn}='usdc' AND ${assignmentIdColumn} IN (
    SELECT completion_seat.assignment_id
    FROM tokenless_paid_assignment_seats completion_seat
    JOIN tokenless_paid_review_voucher_issuances completion_issuance
      ON completion_issuance.issuance_id=completion_seat.voucher_issuance_id
    JOIN tokenless_rater_commits completion_commit
      ON completion_commit.voucher_id=completion_issuance.voucher_id
    WHERE completion_commit.state IN (${states})
  ))`;
}

export function reviewerAssignmentDisplayStatus(input: {
  paidAssignment: boolean;
  paidCommitState: string | null;
  persistedStatus: string | null;
}) {
  return input.paidAssignment &&
    PAID_REVIEW_COMPLETED_COMMIT_STATES.includes(
      input.paidCommitState as (typeof PAID_REVIEW_COMPLETED_COMMIT_STATES)[number],
    )
    ? "completed"
    : input.persistedStatus;
}

/**
 * An active paid seat is completed through the voucher-backed paid task card.
 * Keeping it out of the private-assignment surface prevents one assignment from
 * presenting two incompatible response paths. Terminal paid work may remain in
 * private history because the paid task queue no longer owns an active action.
 */
export function privateAssignmentQueueIncludesPaid(view: ReviewerAssignmentQueueView) {
  return view !== "active";
}

export function privateAssignmentBelongsInView(
  assignment: ReviewerAssignmentSurfaceEntry,
  view: ReviewerAssignmentQueueView,
) {
  return assignment.paidAssignment !== true || privateAssignmentQueueIncludesPaid(view);
}

export function filterPrivateAssignmentsForView<T extends ReviewerAssignmentSurfaceEntry>(
  assignments: readonly T[],
  view: ReviewerAssignmentQueueView,
) {
  return assignments.filter(assignment => privateAssignmentBelongsInView(assignment, view));
}
