import { RateLoopApiError } from "@rateloop/sdk";
import {
  CLI_EXIT_CODES,
  CliUsageError,
  TokenlessWaitTimeoutError,
  errorExitCode,
  verdictExitCode,
} from "../exitCodes";

describe("verdictExitCode", () => {
  it("passes the build only on a publishable verdict", () => {
    expect(verdictExitCode("publishable")).toBe(CLI_EXIT_CODES.ok);
  });

  it("fails the build on a terminal verdict that is not publishable", () => {
    expect(verdictExitCode("inconclusive")).toBe(
      CLI_EXIT_CODES.notPublishable,
    );
    expect(verdictExitCode("delisted")).toBe(CLI_EXIT_CODES.notPublishable);
  });

  it("separates compensated no-verdict outcomes from a rejected output", () => {
    // Nothing was decided about the content, so CI should retry or alert
    // rather than treat this as a rejection.
    for (const status of [
      "zero_commit_refunded",
      "under_quorum_compensated",
      "beacon_failure_compensated",
    ] as const) {
      expect(verdictExitCode(status)).toBe(CLI_EXIT_CODES.noVerdict);
    }
  });

  it("treats a still-pending verdict as a timeout", () => {
    expect(verdictExitCode("pending")).toBe(CLI_EXIT_CODES.timeout);
  });

  it("never reports success when the verdict is missing", () => {
    expect(verdictExitCode(null)).toBe(CLI_EXIT_CODES.unexpected);
    expect(verdictExitCode(undefined)).toBe(CLI_EXIT_CODES.unexpected);
  });

  it("gives every terminal verdict a distinct, non-zero-unless-publishable code", () => {
    const terminal = [
      "publishable",
      "inconclusive",
      "delisted",
      "zero_commit_refunded",
      "under_quorum_compensated",
      "beacon_failure_compensated",
    ] as const;
    for (const status of terminal) {
      const code = verdictExitCode(status);
      expect(code === CLI_EXIT_CODES.ok).toBe(status === "publishable");
    }
  });
});

describe("errorExitCode", () => {
  it("classifies operator mistakes as usage errors", () => {
    expect(errorExitCode(new CliUsageError("--foo is required"))).toBe(
      CLI_EXIT_CODES.usage,
    );
  });

  it("classifies a wait timeout distinctly from a generic failure", () => {
    const timeout = new TokenlessWaitTimeoutError("too slow", 300_000, "cur_1");
    expect(errorExitCode(timeout)).toBe(CLI_EXIT_CODES.timeout);
    expect(timeout.cursor).toBe("cur_1");
    expect(timeout.maxWaitMs).toBe(300_000);
  });

  it("classifies transport and API failures distinctly", () => {
    expect(
      errorExitCode(
        new RateLoopApiError("upstream exploded", 503, { retryable: true }),
      ),
    ).toBe(CLI_EXIT_CODES.api);
  });

  it("keeps the historical code for anything unrecognised", () => {
    expect(errorExitCode(new Error("who knows"))).toBe(
      CLI_EXIT_CODES.unexpected,
    );
    expect(errorExitCode("not even an error")).toBe(CLI_EXIT_CODES.unexpected);
  });

  it("never reports success for a thrown value", () => {
    for (const thrown of [
      new CliUsageError("x"),
      new TokenlessWaitTimeoutError("x", 1_000),
      new RateLoopApiError("x", 500),
      new Error("x"),
      undefined,
    ]) {
      expect(errorExitCode(thrown)).not.toBe(CLI_EXIT_CODES.ok);
    }
  });
});
