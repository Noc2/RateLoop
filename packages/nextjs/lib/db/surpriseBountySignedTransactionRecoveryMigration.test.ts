import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0124_surprise_bounty_signed_transaction_recovery.sql", import.meta.url),
  "utf8",
);

afterEach(() => __setDatabaseResourcesForTests(null));

test("0124 keeps legacy transfers explicit and makes new surprise-bonus transactions recoverable", () => {
  assert.match(migration, /ADD COLUMN "transfer_signed_transaction" text/u);
  assert.match(migration, /ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /ALTER COLUMN "transaction_recovery_version" SET DEFAULT 1/u);
  assert.match(migration, /"transfer_signed_transaction" ~ '\^0x\[0-9a-f\]\+\$'/u);
  assert.match(migration, /"transaction_recovery_version" IN \(0, 1\)/u);
});

test("the applied surprise-bounty schema exposes durable transaction recovery", async () => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const columns = await dbClient.execute(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'tokenless_surprise_bounty_entitlements'
       AND column_name IN ('transfer_signed_transaction', 'transaction_recovery_version')
     ORDER BY column_name`,
  );
  assert.deepEqual(
    columns.rows.map(row => row.column_name),
    ["transaction_recovery_version", "transfer_signed_transaction"],
  );
});
