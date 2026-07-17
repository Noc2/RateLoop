import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0101_feedback_result_semantics.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0101 backfills assurance semantics without changing existing result identities", () => {
  assert.match(migration, /ADD COLUMN "result_semantics" text/u);
  assert.match(migration, /SET "result_semantics" = 'assurance'/u);
  assert.match(migration, /ALTER COLUMN "result_semantics" SET NOT NULL/u);
  assert.doesNotMatch(migration, /SET\s+"(?:result_envelope_commitment|result_commitment|observation_id)"/u);
  const entry = journal.entries.find((e) => e.idx === 101);
  assert.equal(entry?.tag, "0101_feedback_result_semantics");
});

test("0101 makes feedback terminal results non-comparable at the database boundary", () => {
  assert.match(migration, /"result_semantics" IN \('assurance', 'feedback'\)/u);
  assert.match(
    migration,
    /"result_semantics" = 'feedback'[\s\S]*"calibration_comparable" = false[\s\S]*"adaptive_observation_id" IS NULL/u,
  );
  assert.match(
    migration,
    /"result_semantics" = 'assurance'[\s\S]*"outcome" IN \('positive', 'negative'\)[\s\S]*"adaptive_observation_id" IS NOT NULL/u,
  );
});
