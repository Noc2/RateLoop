import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0140_network_assignment_settlement.sql"), "utf8");

test("network settlement migration binds vouchers to one exact assignment and round", () => {
  assert.match(migration, /ADD COLUMN "network_assignment_id"/u);
  assert.match(migration, /UNIQUE \("network_assignment_id","round_id"\)/u);
  assert.match(migration, /UNIQUE \("assignment_id","case_id"\)/u);
  assert.match(migration, /"selection_binding_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
});

test("network settlement receipts are append-only and transitions are monotonic", () => {
  assert.match(migration, /network assignment settlement receipts are append-only/u);
  assert.match(migration, /network assignment settlement bindings are immutable/u);
  assert.match(migration, /network assignment settlement transitions are monotonic/u);
  assert.match(migration, /OLD\.state = 'terminal'/u);
});

test("response settlement references require matching evidence hashes", () => {
  assert.match(migration, /ALTER TABLE "tokenless_assurance_responses"/u);
  assert.match(migration, /\("settlement_reference" IS NULL AND "settlement_evidence_hash" IS NULL\)/u);
  assert.match(migration, /"settlement_evidence_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
});
