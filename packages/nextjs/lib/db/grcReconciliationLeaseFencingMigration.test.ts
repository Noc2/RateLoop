import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0108_grc_reconciliation_lease_fencing.sql", import.meta.url),
  "utf8",
);

test("0108 adds a monotonic generation fence to GRC reconciliation leases", () => {
  assert.match(migration, /ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /"lease_generation" BETWEEN 0 AND 2147483647/u);
  assert.match(migration, /\("state", "lease_expires_at", "lease_generation"\)/u);
  assert.doesNotMatch(migration, /tokenless_assurance_grc_connectors[^\n]*(?:DROP|DELETE)/iu);
});
