import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0067_paid_review_voucher_receipts.sql", import.meta.url), "utf8");

test("paid voucher migration freezes exact eligibility and voucher bindings before issuance", () => {
  assert.match(migration, /CREATE TABLE "tokenless_paid_review_eligibility_snapshots"/u);
  assert.match(migration, /"snapshot_version" integer NOT NULL/u);
  assert.match(migration, /"paid_eligibility_preflight_ref" text NOT NULL/u);
  assert.match(migration, /"paid_eligibility_preflight_hash" text NOT NULL/u);
  assert.match(migration, /"request_profile_hash" text NOT NULL/u);
  assert.match(migration, /"audience_binding_hash" text NOT NULL/u);
  assert.match(migration, /"economics_hash" text NOT NULL/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "rater_id"\)/u);
  assert.match(migration, /"status" IN \('prepared', 'issued', 'consumed'\)/u);
});

test("paid voucher receipts are hash-bound and append-only", () => {
  assert.match(migration, /CREATE TABLE "tokenless_paid_review_voucher_receipts"/u);
  assert.match(migration, /UNIQUE \("issuance_id", "receipt_type"\)/u);
  assert.match(migration, /"receipt_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /CREATE TRIGGER "tokenless_paid_review_eligibility_snapshots_append_only"/u);
  assert.match(migration, /CREATE TRIGGER "tokenless_paid_review_voucher_receipts_append_only"/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
});
