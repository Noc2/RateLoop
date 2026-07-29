import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0160_scheduled_work_terminal_reasons.sql", import.meta.url),
  "utf8",
);

test("0160 persists terminal scheduled-work reasons independently from diagnostic messages", () => {
  assert.match(migration, /ADD COLUMN "terminal_reason_code" text/u);
  assert.match(migration, /"terminal_reason_code" IS NULL[\s\S]*"state" = 'dead'/u);
  assert.match(migration, /x402_authorization_used_reconciliation_required/u);
  assert.match(migration, /FROM "tokenless_chain_executions"[\s\S]*"failure_code"/u);
});
