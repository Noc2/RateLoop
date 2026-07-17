import type { HumanReviewApproval } from "~~/lib/tokenless/humanReviewApprovals";

export type ApprovalDecision = "approve" | "reject";

export type ApprovalRollback = {
  approval: HumanReviewApproval;
  index: number;
  previousApprovalId: string | null;
  nextApprovalId: string | null;
};

export function applyOptimisticApprovalDecision(
  approvals: HumanReviewApproval[],
  approvalId: string,
  decision: ApprovalDecision,
): { approvals: HumanReviewApproval[]; rollback: ApprovalRollback | null } {
  const index = approvals.findIndex(approval => approval.approvalId === approvalId && approval.status === "pending");
  if (index < 0) return { approvals, rollback: null };

  const approval = approvals[index];
  return {
    approvals:
      decision === "approve"
        ? approvals.map(entry => (entry.approvalId === approvalId ? { ...entry, status: "approved" } : entry))
        : approvals.filter(entry => entry.approvalId !== approvalId),
    rollback: {
      approval,
      index,
      previousApprovalId: approvals[index - 1]?.approvalId ?? null,
      nextApprovalId: approvals[index + 1]?.approvalId ?? null,
    },
  };
}

export function rollbackApprovalDecision(approvals: HumanReviewApproval[], rollback: ApprovalRollback) {
  const withoutOptimisticVersion = approvals.filter(entry => entry.approvalId !== rollback.approval.approvalId);
  const restored = [...withoutOptimisticVersion];
  const previousIndex = restored.findIndex(entry => entry.approvalId === rollback.previousApprovalId);
  const nextIndex = restored.findIndex(entry => entry.approvalId === rollback.nextApprovalId);
  const restoreAt =
    previousIndex >= 0 ? previousIndex + 1 : nextIndex >= 0 ? nextIndex : Math.min(rollback.index, restored.length);
  restored.splice(restoreAt, 0, rollback.approval);
  return restored;
}

export function confirmApprovalDecision(approvals: HumanReviewApproval[], decided: HumanReviewApproval) {
  if (decided.status === "denied") return approvals.filter(entry => entry.approvalId !== decided.approvalId);
  return approvals.map(entry => (entry.approvalId === decided.approvalId ? decided : entry));
}
