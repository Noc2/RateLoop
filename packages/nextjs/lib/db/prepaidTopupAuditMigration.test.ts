import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0089_prepaid_topup_audit.sql", import.meta.url), "utf8");

test("0089 stores a durable idempotent prepaid top-up audit outbox", () => {
  assert.match(migration, /CREATE TABLE "tokenless_prepaid_topup_audit_outbox"/u);
  assert.match(migration, /UNIQUE \("topup_id", "event_type"\)/u);
  assert.match(migration, /UNIQUE \("topup_id", "event_sequence"\)/u);
  assert.match(migration, /"event_type" IN \('requested','issued','paid','credited','failed'\)/u);
  assert.match(migration, /"state" IN \('pending','delivered'\)/u);
  assert.match(migration, /tokenless_prepaid_topup_audit_delivery_check/u);
});
