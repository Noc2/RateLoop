import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0116_private_review_external_commitments.sql", import.meta.url),
  "utf8",
);

test("private review foundations keep external and vault commitments distinct", () => {
  assert.match(migration, /external_source_evidence_hash/u);
  assert.match(migration, /external_suggestion_commitment/u);
  assert.match(migration, /external_commitments_check/u);
  assert.match(migration, /external_source_evidence_hash" IS NULL[\s\S]*external_suggestion_commitment" IS NULL/u);
  assert.match(migration, /\^sha256:\[0-9a-f\]\{64\}\$/u);
  assert.doesNotMatch(migration, /NOT NULL/u);
});
