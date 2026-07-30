import { describe, expect, it } from "vitest";
import { projectFeedbackBonusCredit } from "../src/feedback-bonus-projection";

describe("feedback bonus pull-credit projection", () => {
  it("records accrual without inventing a transfer destination and withdrawal with the chosen destination", () => {
    const destination = "0x1111111111111111111111111111111111111111";

    expect(projectFeedbackBonusCredit({ kind: "accrued" })).toEqual({
      eventType: "remainder_refunded",
      payoutAddress: null,
    });
    expect(
      projectFeedbackBonusCredit({ kind: "withdrawn", destination }),
    ).toEqual({
      eventType: "credit_withdrawn",
      payoutAddress: destination,
    });
  });
});
