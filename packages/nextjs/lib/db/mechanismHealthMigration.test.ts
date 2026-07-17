import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0090_mechanism_health.sql", import.meta.url), "utf8");

test("mechanism health persists quorum-quality, RBTS, gold, and drift aggregates by run", () => {
  assert.match(migration, /"unanimous_case_count"/u);
  assert.match(migration, /"rbts_score_variance_bps2"/u);
  assert.match(migration, /"rbts_score_count" bigint/u);
  assert.match(migration, /"eligible_chain_case_count"/u);
  assert.match(migration, /"indexed_chain_case_count"/u);
  assert.match(migration, /"gold_failure_count"/u);
  assert.match(migration, /"comparable_drift_bps"/u);
  assert.match(migration, /FOREIGN KEY \("project_id", "run_id"\)/u);
});
