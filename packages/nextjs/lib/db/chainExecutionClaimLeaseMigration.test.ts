import { __setDatabaseResourcesForTests, dbClient } from ".";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

const migration = readFileSync(
  join(process.cwd(), "drizzle", "0103_tokenless_chain_execution_claim_lease.sql"),
  "utf8",
);

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0103 adds an expiring claim lease and a monotonic fencing token to chain executions", () => {
  assert.match(migration, /ALTER TABLE "tokenless_chain_executions"/u);
  assert.match(migration, /ADD COLUMN "claim_owner" text/u);
  assert.match(migration, /ADD COLUMN "claim_token" text/u);
  assert.match(migration, /ADD COLUMN "claim_expires_at" timestamp with time zone/u);
  assert.match(migration, /ADD COLUMN "claim_fencing_token" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"claim_fencing_token" BETWEEN 0 AND 2147483647/u);
  // The lease and fence must not touch any payout, bounty, or settlement column.
  assert.doesNotMatch(migration, /payout|bounty|settlement|reservation/iu);
});

test("the applied schema exposes all four claim-lease columns on chain executions", async () => {
  const columns = await dbClient.execute({
    sql: `SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'tokenless_chain_executions'
            AND column_name IN ('claim_owner', 'claim_token', 'claim_expires_at', 'claim_fencing_token')
          ORDER BY column_name`,
    args: [],
  });
  assert.deepEqual(columns.rows.map(row => String(row.column_name)).sort(), [
    "claim_expires_at",
    "claim_fencing_token",
    "claim_owner",
    "claim_token",
  ]);
});
