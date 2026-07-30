import type { Address } from "viem";

export type FeedbackBonusCreditProjection =
  | { eventType: "remainder_refunded"; payoutAddress: null }
  | { eventType: "credit_withdrawn"; payoutAddress: Address };

export function projectFeedbackBonusCredit(
  event: { kind: "accrued" } | { kind: "withdrawn"; destination: Address },
): FeedbackBonusCreditProjection {
  return event.kind === "accrued"
    ? { eventType: "remainder_refunded", payoutAddress: null }
    : {
        eventType: "credit_withdrawn",
        payoutAddress: event.destination,
      };
}
