import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0082_worm_delivery_lease_fencing.sql", import.meta.url), "utf8");

test("WORM delivery jobs receive a non-null monotonic lease-generation fence", () => {
  assert.match(migration, /ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"lease_generation" BETWEEN 0 AND 2147483647/u);
});
