import { describe, expect, it } from "vitest";
import {
  readBooleanFlag,
  readOptionalPositiveInteger,
  validateCliOptions,
} from "../cliOptions";

describe("tokenless CLI options", () => {
  it("parses bounded wait options", () => {
    expect(readOptionalPositiveInteger({}, "timeout-ms")).toBeUndefined();
    expect(
      readOptionalPositiveInteger({ "timeout-ms": "30000" }, "timeout-ms"),
    ).toBe(30_000);
    expect(readBooleanFlag({ "until-ready": true }, "until-ready")).toBe(true);
  });

  it("rejects unsafe integers and non-boolean flag values", () => {
    for (const value of ["0", "-1", "1.5", "9007199254740992"]) {
      expect(() =>
        readOptionalPositiveInteger({ "max-wait-ms": value }, "max-wait-ms"),
      ).toThrow(/positive base-10 safe integer/);
    }
    expect(() =>
      readBooleanFlag({ "until-ready": "yes" }, "until-ready"),
    ).toThrow(/boolean flag/);
  });

  it("rejects removed and duplicated options", () => {
    expect(() =>
      validateCliOptions("ask", { file: "ask.json", "payment-mode": "x402" }),
    ).toThrow("Unknown option --payment-mode for ask");
    expect(() =>
      validateCliOptions("quote", { file: ["one.json", "two.json"] }),
    ).toThrow("--file may only be specified once");
  });
});
