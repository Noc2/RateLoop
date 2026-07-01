import { getPonderQueryRetryDelay, shouldRetryPonderQueryFailure } from "./usePonderQuery";
import assert from "node:assert/strict";
import test from "node:test";

test("shouldRetryPonderQueryFailure retries transient failures briefly", () => {
  assert.equal(shouldRetryPonderQueryFailure(0, new Error("health_check_failed")), true);
  assert.equal(shouldRetryPonderQueryFailure(1, new Error("Ponder request timed out")), true);
  assert.equal(shouldRetryPonderQueryFailure(2, new Error("Ponder request timed out")), false);
});

test("getPonderQueryRetryDelay backs off with a cap", () => {
  assert.equal(getPonderQueryRetryDelay(0), 750);
  assert.equal(getPonderQueryRetryDelay(1), 1_500);
  assert.equal(getPonderQueryRetryDelay(3), 3_000);
});
