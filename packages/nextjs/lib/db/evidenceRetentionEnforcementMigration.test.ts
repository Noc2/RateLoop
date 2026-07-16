import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0079_evidence_retention_enforcement.sql", import.meta.url),
  "utf8",
);

test("retention enforcement has durable policy, retry, hold, backlog, and integrity accounting", () => {
  assert.match(migration, /tokenless_evidence_retention_enforcement_runs/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "policy_version"\)/u);
  assert.match(migration, /"state" IN \('pending', 'processing', 'retry', 'completed', 'dead'\)/u);
  assert.match(migration, /"attempt_count" BETWEEN 0 AND 8/u);
  assert.match(migration, /"objects_held"/u);
  assert.match(migration, /"access_logs_held"/u);
  assert.match(migration, /"backlog_count"/u);
  assert.match(migration, /"audit_events_preserved"/u);
  assert.match(migration, /"evidence_packets_preserved"/u);
  assert.match(migration, /"attestations_preserved"/u);
  assert.match(migration, /"worm_receipts_preserved"/u);
  assert.match(migration, /WHERE "state" IN \('pending', 'processing', 'retry'\)/u);
});
