import { describe, expect, it } from "vitest";
import { readBooleanFlag, readOptionalPositiveInteger } from "../cliOptions";

describe("readOptionalPositiveInteger", () => {
  it("returns undefined for omitted options and parses decimal safe integers", () => {
    expect(readOptionalPositiveInteger({}, "chain-id")).toBeUndefined();
    expect(readOptionalPositiveInteger({ "chain-id": "8453" }, "chain-id")).toBe(8453);
  });

  it("rejects non-decimal, non-positive, and unsafe integers", () => {
    for (const value of [
      "0",
      "-1",
      "+8453",
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

describe("readBooleanFlag", () => {
  it("parses omitted, bare, and explicit boolean flag values", () => {
    expect(readBooleanFlag({}, "include-image-data")).toBe(false);
    expect(readBooleanFlag({ "include-image-data": true }, "include-image-data")).toBe(true);
    expect(readBooleanFlag({ "include-image-data": "true" }, "include-image-data")).toBe(true);
    expect(readBooleanFlag({ "include-image-data": "false" }, "include-image-data")).toBe(false);
    expect(readBooleanFlag({ generate: "false" }, "generate")).toBe(false);
    expect(readBooleanFlag({ overwrite: "false" }, "overwrite")).toBe(false);
  });

  it("rejects non-boolean values", () => {
    expect(() =>
      readBooleanFlag({ "include-image-data": "yes" }, "include-image-data"),
    ).toThrow("--include-image-data must be a boolean flag");
    expect(() =>
      readBooleanFlag({ "include-image-data": ["true", "true"] }, "include-image-data"),
    ).toThrow("--include-image-data must be a boolean flag");
  });
});
