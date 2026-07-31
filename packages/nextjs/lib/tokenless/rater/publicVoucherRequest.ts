import type { Address, Hex } from "viem";

export function buildPublicVoucherRequest(
  task: { roundId: string; contentId: Hex } & (
    | { reviewerSource: "customer_invited"; issuanceId: string; assignmentId: string }
    | {
        reviewerSource: "rateloop_network";
        assignmentId: string;
        selectionBindingHash: `sha256:${string}`;
      }
  ),
  input: { idempotencyKey: string; voteKey: Address },
) {
  return {
    idempotencyKey: input.idempotencyKey,
    roundId: task.roundId,
    contentId: task.contentId,
    voteKey: input.voteKey,
    reviewerSource: task.reviewerSource,
    assignmentId: task.assignmentId,
    ...(task.reviewerSource === "customer_invited"
      ? { issuanceId: task.issuanceId }
      : { selectionBindingHash: task.selectionBindingHash }),
  };
}
