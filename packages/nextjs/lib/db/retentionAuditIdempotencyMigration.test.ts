import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0080_retention_audit_idempotency.sql", import.meta.url), "utf8");

test("retention completion audit events are unique per workspace and durable run", () => {
  assert.match(migration, /CREATE UNIQUE INDEX "tokenless_audit_events_retention_run_unique"/u);
  assert.match(migration, /\("workspace_id", "target_id"\)/u);
  assert.match(migration, /"action" = 'evidence\.retention\.enforced'/u);
  assert.match(migration, /"target_kind" = 'evidence_retention_run'/u);
});
