import { __setDatabaseResourcesForTests, dbClient } from ".";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0107_chain_signed_transaction_recovery.sql", import.meta.url),
  "utf8",
);

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0107 stores exact signed approval and submission transactions for crash recovery", () => {
  assert.match(migration, /ADD COLUMN "approval_signed_transaction" text/u);
  assert.match(migration, /ADD COLUMN "submission_signed_transaction" text/u);
  assert.match(migration, /ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"transaction_recovery_version" IN \(0, 1\)/u);
  assert.match(migration, /"approval_signed_transaction" ~ '\^0x\[0-9a-f\]\+\$'/u);
  assert.match(migration, /"submission_signed_transaction" ~ '\^0x\[0-9a-f\]\+\$'/u);
});

test("the applied chain-execution schema exposes both signed transactions", async () => {
  const columns = await dbClient.execute({
    sql: `SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'tokenless_chain_executions'
            AND column_name IN ('approval_signed_transaction', 'submission_signed_transaction', 'transaction_recovery_version')
          ORDER BY column_name`,
    args: [],
  });
  assert.deepEqual(columns.rows.map(row => String(row.column_name)).sort(), [
    "approval_signed_transaction",
    "submission_signed_transaction",
    "transaction_recovery_version",
  ]);
});
