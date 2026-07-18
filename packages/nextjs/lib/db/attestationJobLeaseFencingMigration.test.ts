import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0109_attestation_job_lease_fencing.sql", import.meta.url),
  "utf8",
);

test("0109 fences attestation job leases and binds each claim to its signer key", () => {
  assert.match(migration, /WHERE "state" = 'processing'/u);
  assert.match(migration, /ADD COLUMN "lease_generation" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /ADD COLUMN "claim_signer_key_id" text/u);
  assert.match(migration, /"lease_generation" BETWEEN 0 AND 2147483647/u);
  assert.match(migration, /"state" = 'processing' AND "claim_signer_key_id" IS NOT NULL/u);
  assert.match(migration, /"state" <> 'processing' AND "claim_signer_key_id" IS NULL/u);
  assert.match(migration, /\("state", "lease_expires_at", "lease_generation"\)/u);
});
