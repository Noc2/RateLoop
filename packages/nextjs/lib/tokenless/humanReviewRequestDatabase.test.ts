import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __humanReviewRequestDatabaseTestUtils,
  applyHumanReviewRequestTransactionTimeouts,
  mapHumanReviewRequestDatabaseError,
} from "~~/lib/tokenless/humanReviewRequestDatabase";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

test("review request transactions install bounded PostgreSQL lock and statement waits", async () => {
  const statements: string[] = [];
  await applyHumanReviewRequestTransactionTimeouts({
    query: async (statement: string) => {
      statements.push(statement);
      return {} as never;
    },
  });

  assert.deepEqual(statements, [
    `SET LOCAL lock_timeout = '${__humanReviewRequestDatabaseTestUtils.REVIEW_REQUEST_LOCK_TIMEOUT_MS}ms'`,
    `SET LOCAL statement_timeout = '${__humanReviewRequestDatabaseTestUtils.REVIEW_REQUEST_STATEMENT_TIMEOUT_MS}ms'`,
  ]);
});

for (const code of ["55P03", "57014"]) {
  test(`PostgreSQL ${code} becomes one retry-safe request error`, () => {
    const mapped = mapHumanReviewRequestDatabaseError(Object.assign(new Error("database wait ended"), { code }));
    assert.ok(mapped instanceof TokenlessServiceError);
    assert.equal(mapped.code, "review_request_temporarily_unavailable");
    assert.equal(mapped.status, 503);
    assert.equal(mapped.retryable, true);
  });
}

test("wrapped PostgreSQL timeout errors are recognized without replacing service errors", () => {
  const wrapped = mapHumanReviewRequestDatabaseError({ cause: { code: "55P03" } });
  assert.ok(wrapped instanceof TokenlessServiceError);
  assert.equal(wrapped.code, "review_request_temporarily_unavailable");

  const serviceError = new TokenlessServiceError("existing", 409, "existing_error", true);
  assert.equal(mapHumanReviewRequestDatabaseError(serviceError), serviceError);
  const unrelated = Object.assign(new Error("unique violation"), { code: "23505" });
  assert.equal(mapHumanReviewRequestDatabaseError(unrelated), unrelated);
});

// pg-mem does not emulate PostgreSQL's concurrent row-lock waiting semantics.
// The transaction SQL and SQLSTATE mapping are deterministic here; production
// PostgreSQL lock cancellation remains an integration/deployment verification.
