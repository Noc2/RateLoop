import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0143_subject_export_schema_version.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("subject export schema correction is forward-only and journaled", () => {
  assert.equal(journal.entries.find(value => value.tag === "0143_subject_export_schema_version")?.idx, 143);
  assert.match(migration, /SET "schema_version" = 3/u);
  assert.match(migration, /rateloop\.subject-export\.v3/u);
  assert.match(migration, /"schema_version" IN \(1, 3\)/u);
  assert.doesNotMatch(migration, /DROP TABLE/u);
});
