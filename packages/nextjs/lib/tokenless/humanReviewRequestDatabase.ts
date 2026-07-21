import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const REVIEW_REQUEST_LOCK_TIMEOUT_MS = 3_000;
const REVIEW_REQUEST_STATEMENT_TIMEOUT_MS = 15_000;
const RETRYABLE_POSTGRES_CODES = new Set(["55P03", "57014"]);

type QueryableClient = { query(statement: string): Promise<unknown> };

export async function applyHumanReviewRequestTransactionTimeouts(client: QueryableClient) {
  await client.query(`SET LOCAL lock_timeout = '${REVIEW_REQUEST_LOCK_TIMEOUT_MS}ms'`);
  await client.query(`SET LOCAL statement_timeout = '${REVIEW_REQUEST_STATEMENT_TIMEOUT_MS}ms'`);
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

export function mapHumanReviewRequestDatabaseError(error: unknown): unknown {
  if (error instanceof TokenlessServiceError || !postgresErrorCode(error)) return error;
  return new TokenlessServiceError(
    "The review request is temporarily unavailable. Retry the same opportunity with the exact same payloads.",
    503,
    "review_request_temporarily_unavailable",
    true,
  );
}

export const __humanReviewRequestDatabaseTestUtils = {
  REVIEW_REQUEST_LOCK_TIMEOUT_MS,
  REVIEW_REQUEST_STATEMENT_TIMEOUT_MS,
  postgresErrorCode,
};
