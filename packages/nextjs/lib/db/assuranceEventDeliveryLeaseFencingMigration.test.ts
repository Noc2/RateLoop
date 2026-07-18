import { __setDatabaseResourcesForTests, dbClient } from ".";
import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0105_assurance_event_delivery_lease_fencing.sql", import.meta.url),
  "utf8",
);

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("0105 adds a non-null monotonic lease-generation fence to assurance-event deliveries", () => {
  assert.match(migration, /ALTER TABLE "tokenless_assurance_event_deliveries"/u);
  assert.match(migration, /ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"lease_generation" BETWEEN 0 AND 2147483647/u);
});

test("the applied assurance-event delivery schema exposes the lease-generation fence", async () => {
  const columns = await dbClient.execute({
    sql: `SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'tokenless_assurance_event_deliveries'
            AND column_name = 'lease_generation'`,
    args: [],
  });
  assert.deepEqual(
    columns.rows.map(row => String(row.column_name)),
    ["lease_generation"],
  );
});
