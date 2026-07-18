import { beforeEach, describe, expect, it } from "vitest";
import { resetRoundScanStateForTests, scanRoundIds } from "../round-scan.js";

beforeEach(resetRoundScanStateForTests);

describe("tokenless round scan fairness", () => {
  it("advances history when arrivals consume the complete configured budget", () => {
    expect(scanRoundIds(101n, 3)).toEqual([100n, 99n, 98n]);
    expect(scanRoundIds(104n, 3)).toEqual([103n, 97n, 96n]);
    expect(scanRoundIds(107n, 3)).toEqual([106n, 95n, 94n]);
    expect(scanRoundIds(110n, 3)).toEqual([109n, 93n, 92n]);
  });

  it("discovers the current tip while arrivals exceed the configured budget", () => {
    expect(scanRoundIds(11n, 4)).toEqual([10n, 9n, 8n, 7n]);
    expect(scanRoundIds(31n, 4)).toEqual([30n, 29n, 6n, 5n]);
    expect(scanRoundIds(51n, 4)).toEqual([50n, 49n, 4n, 3n]);
  });

  it("alternates tip and history when only one slot is configured", () => {
    expect(scanRoundIds(101n, 1)).toEqual([100n]);
    expect(scanRoundIds(102n, 1)).toEqual([99n]);
    expect(scanRoundIds(103n, 1)).toEqual([102n]);
    expect(scanRoundIds(104n, 1)).toEqual([98n]);
  });
});
