import { describe, expect, it } from "vitest";
import { isCorrelationVoteScanTruncated } from "../src/api/correlation-vote-scan.js";

describe("isCorrelationVoteScanTruncated", () => {
  it("flags truncation when the scan budget ends before the dataset", () => {
    expect(
      isCorrelationVoteScanTruncated({
        endedNaturally: false,
        eligibleSeen: 50_000,
        offset: 0,
      }),
    ).toBe(true);
  });

  it("does not flag truncation when the dataset ends naturally", () => {
    expect(
      isCorrelationVoteScanTruncated({
        endedNaturally: true,
        eligibleSeen: 1_000,
        offset: 0,
      }),
    ).toBe(false);
  });

  it("flags truncation when the offset cannot be satisfied", () => {
    expect(
      isCorrelationVoteScanTruncated({
        endedNaturally: true,
        eligibleSeen: 100,
        offset: 500,
      }),
    ).toBe(true);
  });
});
