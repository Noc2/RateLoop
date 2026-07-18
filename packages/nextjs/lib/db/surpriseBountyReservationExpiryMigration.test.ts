import { __setDatabaseResourcesForTests, dbClient } from ".";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0106_surprise_bounty_reservation_expiry.sql", import.meta.url),
  "utf8",
);

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0106 bounds pre-chain surprise-bounty reservations without expiring funded liabilities", () => {
  assert.match(migration, /ADD COLUMN "reservation_expires_at" timestamp with time zone/u);
  assert.match(migration, /"state" IN \('reserved', 'funded', 'expired'/u);
  assert.match(migration, /"state" = 'reserved' AND "reservation_expires_at" IS NOT NULL/u);
  assert.match(migration, /"state" <> 'reserved' AND "reservation_expires_at" IS NULL/u);
});

test("the applied surprise-bounty schema exposes reservation expiry", async () => {
  const columns = await dbClient.execute({
    sql: `SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'tokenless_surprise_bounty_rounds'
            AND column_name = 'reservation_expires_at'`,
    args: [],
  });
  assert.deepEqual(
    columns.rows.map(row => String(row.column_name)),
    ["reservation_expires_at"],
  );
});
