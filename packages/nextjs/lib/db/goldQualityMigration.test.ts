import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0083_gold_quality.sql", import.meta.url), "utf8");

test("gold quality is tenant-bound, hidden per run, and payout-neutral", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_gold_items"/u);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_run_gold_items"/u);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_gold_outcomes"/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "project_id"\)/u);
  assert.doesNotMatch(migration, /payout|bounty|settlement/iu);
});
