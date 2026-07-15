import type { Address, Hex } from "viem";

export function buildPublicVoucherRequest(
  task: {
    roundId: string;
    contentId: Hex;
    reviewerSource: "customer_invited" | "rateloop_network";
  },
  input: { idempotencyKey: string; voteKey: Address },
) {
  return {
    idempotencyKey: input.idempotencyKey,
    roundId: task.roundId,
    contentId: task.contentId,
    voteKey: input.voteKey,
    reviewerSource: task.reviewerSource,
  };
}
