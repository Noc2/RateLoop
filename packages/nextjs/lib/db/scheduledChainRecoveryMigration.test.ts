import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0110_scheduled_chain_recovery.sql", import.meta.url), "utf8");

test("0110 adds a monotonic claim fence to scheduled work", () => {
  assert.match(migration, /ADD COLUMN "claim_generation" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"claim_generation" BETWEEN 0 AND 2147483647/u);
  assert.match(migration, /\("state", "updated_at", "claim_generation"\)/u);
  assert.doesNotMatch(migration, /tokenless_chain_executions[^\n]*(?:DELETE|DROP)/iu);
});
