export type ReviewerAssignmentQueueView = "active" | "history" | "all";

export type ReviewerAssignmentSurfaceEntry = {
  paidAssignment?: unknown;
};

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
