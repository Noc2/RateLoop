import { describe, expect, it } from "vitest";
import { readOptionalPositiveInteger } from "../cliOptions";

describe("readOptionalPositiveInteger", () => {
  it("returns undefined for omitted options and parses decimal safe integers", () => {
    expect(readOptionalPositiveInteger({}, "chain-id")).toBeUndefined();
    expect(readOptionalPositiveInteger({ "chain-id": "480" }, "chain-id")).toBe(480);
  });

  it("rejects non-decimal, non-positive, and unsafe integers", () => {
    for (const value of [
      "0",
      "-1",
      "+480",
      "0x1e0",
      "480abc",
      "1.5",
      "9007199254740992",
    ]) {
      expect(() =>
        readOptionalPositiveInteger({ "chain-id": value }, "chain-id"),
      ).toThrow("--chain-id must be a positive base-10 safe integer");
    }
  });
});
