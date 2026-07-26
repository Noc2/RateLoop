import type { Address, Hex } from "viem";

export function buildPublicVoucherRequest(
  task: {
    roundId: string;
    contentId: Hex;
    reviewerSource: "customer_invited" | "rateloop_network";
    issuanceId?: string;
    assignmentId?: string;
    selectionBindingHash?: `sha256:${string}`;
  },
  input: { idempotencyKey: string; voteKey: Address },
) {
  return {
    idempotencyKey: input.idempotencyKey,
    roundId: task.roundId,
    contentId: task.contentId,
    voteKey: input.voteKey,
    reviewerSource: task.reviewerSource,
    ...(task.issuanceId ? { issuanceId: task.issuanceId } : {}),
    ...(task.assignmentId ? { assignmentId: task.assignmentId } : {}),
    ...(task.selectionBindingHash ? { selectionBindingHash: task.selectionBindingHash } : {}),
  };
}
