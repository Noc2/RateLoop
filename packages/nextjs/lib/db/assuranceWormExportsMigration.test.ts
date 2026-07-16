import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0075_assurance_worm_exports.sql", import.meta.url), "utf8");

test("0075 stores verified Object Lock destinations without plaintext credentials", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_worm_destinations"/u);
  assert.match(migration, /"credential_reference" text NOT NULL/u);
  assert.match(migration, /\^sec_\[0-9a-f\]\{48\}\$/u);
  assert.match(migration, /"preflight_hash" text NOT NULL/u);
  assert.match(migration, /"retention_days" BETWEEN 183 AND 3650/u);
  assert.doesNotMatch(migration, /"(?:access_key|secret_key|session_token|credentials_json)"/iu);
});

test("0075 persists idempotent jobs and immutable-shape Object Lock receipts", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_worm_export_jobs"/u);
  assert.match(migration, /"idempotency_key" text NOT NULL UNIQUE/u);
  assert.match(migration, /"state" IN \('pending', 'delivering', 'retry', 'delivered', 'dead'\)/u);
  assert.match(migration, /"attempt_count" BETWEEN 0 AND 8/u);
  assert.match(migration, /CREATE TABLE "tokenless_assurance_worm_export_receipts"/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "job_id"\)/u);
  assert.match(migration, /"object_version_id" text NOT NULL/u);
  assert.match(migration, /"checksum_sha256" text NOT NULL/u);
  assert.match(migration, /"object_lock_mode" = 'COMPLIANCE'/u);
  assert.match(migration, /"provider_receipt_hash" text NOT NULL UNIQUE/u);
});
