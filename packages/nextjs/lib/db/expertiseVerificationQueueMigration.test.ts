import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0088_expertise_verification_queue.sql", import.meta.url), "utf8");

test("expertise verification decisions have committed evidence and append-only audit events", () => {
  assert.match(migration, /evidence_reference_hash.*sha256/su);
  assert.match(migration, /previous_event_hash/u);
  assert.match(migration, /UNIQUE\("request_id", "sequence"\)/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
});
