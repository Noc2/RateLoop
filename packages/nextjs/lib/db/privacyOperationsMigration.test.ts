import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0137_privacy_operations.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("privacy operations are forward-only and journaled", () => {
  assert.equal(journal.entries.find(value => value.tag === "0137_privacy_operations")?.idx, 137);
  assert.match(migration, /'blocked_by_funds'/u);
  assert.match(migration, /CREATE TABLE "tokenless_workspace_fund_resolution_requests"/u);
  assert.match(migration, /CREATE TABLE "tokenless_subject_request_exports"/u);
  assert.match(migration, /ADD COLUMN "recovery_count"/u);
  assert.doesNotMatch(migration, /DROP TABLE/u);
});
