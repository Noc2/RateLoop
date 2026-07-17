import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0094_assurance_override_decisions.sql", import.meta.url), "utf8");

test("override decisions are tenant-bound, outcome-scoped, reason-mandatory, and append-only", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_override_decisions"/u);
  assert.match(migration, /REFERENCES "tokenless_workspaces"\("workspace_id"\)/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_runs"\("project_id", "run_id"\)/u);
  assert.match(migration, /"outcome" IN \('accepted', 'disregarded', 'overridden', 'reversed'\)/u);
  assert.match(migration, /char_length\("reasons"\) BETWEEN 10 AND 2000/u);
  assert.match(migration, /"record_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  // Linear supersession: one chain root per run and at most one successor per record.
  assert.match(migration, /UNIQUE \("supersedes_record_id"\)/u);
  assert.match(migration, /WHERE "supersedes_record_id" IS NULL/u);
  // Append-only in production: the trigger rejects every UPDATE and DELETE.
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "tokenless_assurance_override_decisions"/u);
  assert.match(migration, /assurance override decisions are append-only/u);
  assert.doesNotMatch(migration, /payout|bounty|settlement/iu);
});
