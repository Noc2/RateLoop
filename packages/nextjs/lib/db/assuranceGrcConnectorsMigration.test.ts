import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0076_assurance_grc_connectors.sql", import.meta.url), "utf8");

test("0076 creates tenant-bound connector, retry-safe job, and delivery receipt records", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_grc_connectors"/u);
  assert.match(migration, /"workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"/u);
  assert.match(migration, /CHECK \("provider" IN \('drata', 'vanta'\)\)/u);
  assert.match(migration, /CHECK \("credential_reference" ~ '\^\(vault\|kms\|secret\):\/\//u);
  assert.doesNotMatch(migration, /"(?:access_token|api_key|client_secret|bearer_token)"/iu);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_grc_reconciliation_jobs"/u);
  assert.match(migration, /UNIQUE\("workspace_id", "connector_id", "idempotency_key"\)/u);
  assert.match(migration, /"state" IN \('pending', 'processing', 'retry', 'succeeded', 'failed', 'superseded'\)/u);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_grc_delivery_receipts"/u);
  assert.match(migration, /UNIQUE\("job_id", "artifact_kind", "artifact_key"\)/u);
  assert.match(migration, /"request_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "connector_id", "job_id"\)/u);
});
