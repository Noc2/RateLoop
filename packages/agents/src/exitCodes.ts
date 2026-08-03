import { RateLoopApiError } from "@rateloop/sdk";
import type { TokenlessVerdictStatus } from "@rateloop/sdk";

/**
 * Exit codes for the `rateloop-agents` CLI.
 *
 * A pipeline gate is only a gate if the build can tell what happened. Before
 * these existed every failure — and, worse, every *unpublishable verdict* —
 * left the same trace, so a CI step could not distinguish a rejected output
 * from a network blip, and a rejected output did not fail the build at all.
 *
 * Codes are stable API. Add new ones; do not renumber.
 */
export const CLI_EXIT_CODES = {
  /** Terminal verdict `publishable`, or a non-gating command that succeeded. */
  ok: 0,
  /** Anything not otherwise classified. The historical catch-all. */
  unexpected: 1,
  /** Operator error: unknown command or option, bad or missing argument. */
  usage: 2,
  /** The review reached a terminal verdict that is not publishable. */
  notPublishable: 3,
  /** `--until-ready` gave up before a terminal verdict existed. */
  timeout: 4,
  /** Transport or API failure. The review's outcome is unknown. */
  api: 5,
  /**
   * The operation terminated without a usable verdict and was compensated.
   * Distinct from {@link CLI_EXIT_CODES.notPublishable}: nothing was decided
   * about the output, so the correct CI response is to retry or alert rather
   * than to treat the content as rejected.
   */
  noVerdict: 6,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

/** Raised for operator mistakes so they do not read as internal failures. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** Raised when `--until-ready` exhausts its budget with no terminal verdict. */
export class TokenlessWaitTimeoutError extends Error {
  readonly cursor?: string;
  readonly maxWaitMs: number;

  constructor(message: string, maxWaitMs: number, cursor?: string) {
    super(message);
    this.name = "TokenlessWaitTimeoutError";
    this.cursor = cursor;
    this.maxWaitMs = maxWaitMs;
  }
}

const VERDICT_EXIT_CODES: Record<TokenlessVerdictStatus, CliExitCode> = {
  pending: CLI_EXIT_CODES.timeout,
  publishable: CLI_EXIT_CODES.ok,
  inconclusive: CLI_EXIT_CODES.notPublishable,
  delisted: CLI_EXIT_CODES.notPublishable,
  zero_commit_refunded: CLI_EXIT_CODES.noVerdict,
  under_quorum_compensated: CLI_EXIT_CODES.noVerdict,
  beacon_failure_compensated: CLI_EXIT_CODES.noVerdict,
};

/**
 * Maps a terminal verdict to the code CI should see. A missing verdict on an
 * otherwise ready response is not treated as success — the outcome is unknown,
 * which is exactly what {@link CLI_EXIT_CODES.unexpected} means.
 */
export function verdictExitCode(
  status: TokenlessVerdictStatus | null | undefined,
): CliExitCode {
  if (!status) return CLI_EXIT_CODES.unexpected;
  return VERDICT_EXIT_CODES[status] ?? CLI_EXIT_CODES.unexpected;
}

/**
 * Classifies a thrown value. Unrecognised errors keep the historical code 1
 * rather than being guessed at — a wrong code is worse than a vague one.
 */
export function errorExitCode(error: unknown): CliExitCode {
  if (error instanceof CliUsageError) return CLI_EXIT_CODES.usage;
  if (error instanceof TokenlessWaitTimeoutError) return CLI_EXIT_CODES.timeout;
  if (error instanceof RateLoopApiError) return CLI_EXIT_CODES.api;
  return CLI_EXIT_CODES.unexpected;
}
