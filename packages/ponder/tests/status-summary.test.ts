import { describe, expect, it } from "vitest";
import { tokenlessStatusSummary } from "../src/status-summary";

describe("tokenless status aggregates", () => {
  it("builds the public status from bounded database aggregate rows", () => {
    expect(
      tokenlessStatusSummary({
        roundStates: [
          { state: 0, total: 5 },
          { state: 5, total: 3n },
        ],
        creditOwners: 2,
        creditEvents: 8n,
        feedbackBonusPools: 4,
        feedbackBonusEvents: 12,
        totalRemainingCredit: "7500000",
      }),
    ).toEqual({
      rounds: 8,
      byState: { "0": 5, "5": 3 },
      creditOwners: 2,
      creditEvents: 8,
      feedbackBonusPools: 4,
      feedbackBonusEvents: 12,
      totalRemainingCredit: "7500000",
    });
  });

  it("normalizes empty aggregate results without loading source rows", () => {
    expect(
      tokenlessStatusSummary({
        roundStates: [],
        creditOwners: undefined,
        creditEvents: undefined,
        feedbackBonusPools: undefined,
        feedbackBonusEvents: undefined,
        totalRemainingCredit: null,
      }),
    ).toEqual({
      rounds: 0,
      byState: {},
      creditOwners: 0,
      creditEvents: 0,
      feedbackBonusPools: 0,
      feedbackBonusEvents: 0,
      totalRemainingCredit: "0",
    });
  });
});
