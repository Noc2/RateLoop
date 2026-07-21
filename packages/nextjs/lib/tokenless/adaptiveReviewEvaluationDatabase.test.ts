import assert from "node:assert/strict";
import { test } from "node:test";
import {
  __adaptiveReviewEvaluationDatabaseTestUtils,
  applyAdaptiveEvaluationTransactionTimeouts,
  mapAdaptiveEvaluationDatabaseError,
} from "~~/lib/tokenless/adaptiveReviewEvaluationDatabase";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

test("adaptive evaluation transactions bound PostgreSQL lock and statement waits", async () => {
  const statements: string[] = [];
  await applyAdaptiveEvaluationTransactionTimeouts({
    query: async statement => {
      statements.push(statement);
      return {} as never;
    },
  });

  assert.deepEqual(statements, [
    `SET LOCAL lock_timeout = '${__adaptiveReviewEvaluationDatabaseTestUtils.ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS}ms'`,
    `SET LOCAL statement_timeout = '${__adaptiveReviewEvaluationDatabaseTestUtils.ADAPTIVE_EVALUATION_STATEMENT_TIMEOUT_MS}ms'`,
  ]);
  assert.ok(__adaptiveReviewEvaluationDatabaseTestUtils.ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS > 0);
  assert.ok(
    __adaptiveReviewEvaluationDatabaseTestUtils.ADAPTIVE_EVALUATION_STATEMENT_TIMEOUT_MS >
      __adaptiveReviewEvaluationDatabaseTestUtils.ADAPTIVE_EVALUATION_LOCK_TIMEOUT_MS,
  );
});

for (const code of ["55P03", "57014"]) {
  test(`PostgreSQL ${code} becomes one retryable MCP evaluation error`, () => {
    const mapped = mapAdaptiveEvaluationDatabaseError(Object.assign(new Error("database wait ended"), { code }));
    assert.ok(mapped instanceof TokenlessServiceError);
    assert.equal(mapped.code, "review_evaluation_busy");
    assert.equal(mapped.status, 503);
    assert.equal(mapped.retryable, true);
  });
}

test("wrapped timeout errors are recognized without replacing existing service errors", () => {
  const wrapped = mapAdaptiveEvaluationDatabaseError({ cause: { code: "55P03" } });
  assert.ok(wrapped instanceof TokenlessServiceError);
  assert.equal(wrapped.code, "review_evaluation_busy");

  const serviceError = new TokenlessServiceError("existing", 409, "existing_error", true);
  assert.equal(mapAdaptiveEvaluationDatabaseError(serviceError), serviceError);
  const unrelated = Object.assign(new Error("unique violation"), { code: "23505" });
  assert.equal(mapAdaptiveEvaluationDatabaseError(unrelated), unrelated);
});
