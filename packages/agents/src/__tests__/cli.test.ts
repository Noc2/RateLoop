import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../cli";
import { validateCliOptions } from "../cliOptions";

describe("tokenless CLI parsing", () => {
  it("parses one bounded wait request", () => {
    const parsed = parseCliArgs([
      "wait",
      "--operation-key",
      "op_123",
      "--until-ready",
      "--max-wait-ms",
      "300000",
    ]);
    expect(parsed).toEqual({
      command: "wait",
      options: {
        "max-wait-ms": "300000",
        "operation-key": "op_123",
        "until-ready": true,
      },
    });
    expect(() =>
      validateCliOptions(parsed.command, parsed.options),
    ).not.toThrow();
  });

  it("does not accept positional or repeated operation identifiers", () => {
    expect(() => parseCliArgs(["result", "op_123"])).toThrow(
      /Unexpected argument/,
    );
    const duplicate = parseCliArgs([
      "result",
      "--operation-key",
      "op_1",
      "--operation-key",
      "op_2",
    ]);
    expect(() =>
      validateCliOptions(duplicate.command, duplicate.options),
    ).toThrow(/may only be specified once/);
  });
});
