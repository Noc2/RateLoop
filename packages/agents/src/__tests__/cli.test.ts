import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../cli";
import { validateCliOptions } from "../cliOptions";

describe("tokenless CLI parsing", () => {
  it("accepts bounded assurance project and run commands", () => {
    for (const args of [
      ["assurance-projects"],
      ["assurance-project-create", "--file", "assurance-project.json"],
      ["assurance-project", "--project-id", "hap_123"],
      ["assurance-run", "--run-id", "hau_123"],
    ]) {
      const parsed = parseCliArgs(args);
      expect(() =>
        validateCliOptions(parsed.command, parsed.options),
      ).not.toThrow();
    }
  });

  it("rejects unscoped assurance identifiers", () => {
    const parsed = parseCliArgs(["assurance-run", "--project-id", "hap_123"]);
    expect(() => validateCliOptions(parsed.command, parsed.options)).toThrow(
      /Unknown option/,
    );
  });

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

  it("accepts wallet and autonomous publishing commands", () => {
    for (const args of [
      ["wallet-create", "--keystore", "wallet.json"],
      ["wallet-address", "--keystore", "wallet.json"],
      ["run", "--file", "run.json", "--max-wait-ms", "300000"],
      ["resume", "--operation-key", "op_123"],
    ]) {
      const parsed = parseCliArgs(args);
      expect(() => validateCliOptions(parsed.command, parsed.options)).not.toThrow();
    }
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
