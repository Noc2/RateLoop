import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0098_remove_review_effort_guidance.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("active profiles require owner confirmation before obsolete effort guidance is removed", () => {
  assert.match(migration, /SET "configuration_status" = 'action_required'/u);
  assert.match(migration, /DROP CONSTRAINT IF EXISTS/u);
  assert.match(migration, /DROP COLUMN IF EXISTS "expected_effort_seconds"/u);
  assert.equal(journal.entries.at(-1)?.idx, 98);
  assert.equal(journal.entries.at(-1)?.tag, "0098_remove_review_effort_guidance");
});
