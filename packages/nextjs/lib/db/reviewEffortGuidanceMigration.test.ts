import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0087_review_effort_guidance.sql", import.meta.url), "utf8");

test("expected effort is bounded separately from the response deadline", () => {
  assert.match(migration, /ADD COLUMN "expected_effort_seconds"/u);
  assert.match(migration, /BETWEEN 60 AND 14400/u);
  assert.doesNotMatch(migration, /response_window_seconds.*expected_effort_seconds/su);
});
