import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0121_paid_assignment_operations.sql", import.meta.url), "utf8");
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");
const implementation = readFileSync(new URL("../tokenless/paidAssignmentOperations.ts", import.meta.url), "utf8");

test("0121 journals the restart-safe paid-assignment operation schema", () => {
  assert.match(journal, /"idx": 121[\s\S]*"tag": "0121_paid_assignment_operations"/u);
  assert.match(migration, /CREATE TABLE "tokenless_paid_assignment_operations"/u);
  assert.match(migration, /CREATE TABLE "tokenless_paid_assignment_seats"/u);
  assert.match(migration, /CREATE TABLE "tokenless_paid_assignment_receipts"/u);
});

test("0121 freezes one exact request and prevents partial state shapes", () => {
  assert.match(migration, /UNIQUE \("workspace_id", "request_idempotency_key"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id", "lane"\)/u);
  assert.match(migration, /"state" IN \('prepared', 'quote_created', 'ask_prepared', 'ask_attached', 'round_bound'\)/u);
  assert.match(migration, /"activation_owner" text/u);
  assert.match(migration, /"quote_expires_at" timestamp with time zone/u);
  assert.match(migration, /"payment_mode" text/u);
  assert.match(migration, /"commit_deadline" timestamp with time zone/u);
  assert.match(migration, /"state" = 'round_bound'[\s\S]*"round_terms_hash" IS NOT NULL/u);
  assert.match(migration, /"expected_amount_atomic" > 0/u);
});

test("0121 gives seats exact unique identities and production receipts append-only enforcement", () => {
  assert.match(migration, /UNIQUE \("operation_id", "position"\)/u);
  assert.match(migration, /UNIQUE \("operation_id", "reviewer_principal_id"\)/u);
  assert.match(migration, /UNIQUE \("operation_id", "payout_account"\)/u);
  assert.match(migration, /CREATE OR REPLACE FUNCTION "tokenless_reject_paid_assignment_receipt_mutation"/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON "tokenless_paid_assignment_receipts"/u);
  assert.match(migration, /operation_revision/u);
  assert.match(migration, /same-state paid-assignment updates may only change activation metadata/u);
  assert.match(migration, /round binding changed attached paid-assignment identity/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
});

test("0121 erases direct seat identities through a commitment-preserving receipted revision", () => {
  assert.match(migration, /"reviewer_principal_id" text,/u);
  assert.match(migration, /"identity_commitment" text NOT NULL/u);
  assert.match(migration, /"identity_erased_at" timestamp with time zone/u);
  assert.match(migration, /"identity_erasure_receipt_hash" text/u);
  assert.match(migration, /'seat_identity_erased'/u);
  assert.match(migration, /NEW\.identity_commitment IS DISTINCT FROM OLD\.identity_commitment/u);
  assert.match(migration, /NEW\.transition_revision=OLD\.transition_revision\+1/u);
  assert.match(
    migration,
    /WHEN NEW\.identity_erased_at IS NULL THEN 'seat_voucher_prepared'[\s\S]*ELSE 'seat_identity_erased'/u,
  );
  assert.match(migration, /paid-assignment seat requires one active matching reviewer identity/u);
  assert.match(migration, /BEFORE INSERT OR UPDATE ON "tokenless_paid_assignment_seats"/u);
});

test("runtime maps either paid-operation uniqueness boundary to an exact conflict", () => {
  assert.match(implementation, /ON CONFLICT DO NOTHING RETURNING operation_id/u);
  assert.match(implementation, /opportunity_id=\$2 AND lane='private_invited_paid'/u);
  assert.match(implementation, /paid_assignment_operation_conflict/u);
});
