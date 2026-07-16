import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0081_artifact_deletion_outbox.sql", import.meta.url), "utf8");

test("artifact deletion records provider, metadata, and audit checkpoints durably", () => {
  assert.match(migration, /CREATE TABLE "tokenless_artifact_deletion_jobs"/u);
  assert.match(migration, /'provider_pending', 'provider_deleting', 'provider_deleted', 'finalized', 'completed'/u);
  assert.match(migration, /"provider_deleted_at" timestamp with time zone/u);
  assert.match(migration, /"finalized_at" timestamp with time zone/u);
  assert.match(migration, /"audit_event_id" text REFERENCES "tokenless_audit_events"/u);
  assert.match(migration, /"state" = 'provider_deleting' AND "lease_token" IS NOT NULL/u);
});

test("artifact retention audit correlation is unique for idempotent retry", () => {
  assert.match(migration, /CREATE UNIQUE INDEX "tokenless_audit_events_artifact_retention_unique"/u);
  assert.match(migration, /\("workspace_id", "request_correlation"\)/u);
  assert.match(migration, /"action" = 'artifact\.retention_delete'/u);
  assert.match(migration, /"request_correlation" IS NOT NULL/u);
});
