import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS = 3_000;
const ADAPTIVE_EVALUATION_STATEMENT_TIMEOUT_MS = 15_000;
const RETRYABLE_POSTGRES_CODES = new Set(["55P03", "57014"]);

type QueryableClient = { query(statement: string): Promise<unknown> };

export async function applyAdaptiveEvaluationTransactionTimeouts(client: QueryableClient) {
  await client.query(`SET LOCAL lock_timeout = '${ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS}ms'`);
  await client.query(`SET LOCAL statement_timeout = '${ADAPTIVE_EVALUATION_STATEMENT_TIMEOUT_MS}ms'`);
}

function postgresErrorCode(error: unknown) {
  let current = error;
  const visited = new Set<unknown>();
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object" || visited.has(current)) return null;
    visited.add(current);
    const record = current as { cause?: unknown; code?: unknown };
    if (typeof record.code === "string" && RETRYABLE_POSTGRES_CODES.has(record.code)) return record.code;
    current = record.cause;
  }
  return null;
}

export function mapAdaptiveEvaluationDatabaseError(error: unknown): unknown {
  if (error instanceof TokenlessServiceError || !postgresErrorCode(error)) return error;
  return new TokenlessServiceError(
    "Review evaluation is temporarily busy. Retry the same external opportunity with identical inputs.",
    503,
    "review_evaluation_busy",
    true,
  );
}

export const __adaptiveReviewEvaluationDatabaseTestUtils = {
  ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS,
  ADAPTIVE_EVALUATION_STATEMENT_TIMEOUT_MS,
  postgresErrorCode,
};
