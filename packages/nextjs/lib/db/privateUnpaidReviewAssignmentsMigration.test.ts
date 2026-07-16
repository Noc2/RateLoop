import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0062_private_unpaid_review_assignments.sql", import.meta.url),
  "utf8",
);

test("private unpaid assignments freeze exact bindings and deadline-bounded snapshots", () => {
  assert.match(migration, /tokenless_private_unpaid_review_deliveries/u);
  assert.match(migration, /tokenless_private_unpaid_review_assignments/u);
  assert.match(migration, /tokenless_private_review_requests/u);
  assert.match(migration, /tokenless_agent_review_opportunity_lifecycles/u);
  assert.match(migration, /request_profile_hash/u);
  assert.match(migration, /private_group_policy_hash/u);
  assert.match(migration, /cohort_binding_hash/u);
  assert.match(migration, /membership_snapshot_hash/u);
  assert.match(migration, /"reservation_expires_at" <= "response_deadline"/u);
  assert.match(migration, /"assignment_expires_at" = "response_deadline"/u);
  assert.match(migration, /"membership_expires_at" >= "response_deadline"/u);
});

test("private unpaid assignment schema has no payment, voucher, public ask, or plaintext columns", () => {
  assert.doesNotMatch(migration, /payment_reference|payment_intent|prepaid_reservation|voucher_marker/iu);
  assert.doesNotMatch(migration, /tokenless_agent_asks|public_url|source_text|suggestion_text|plaintext/iu);
  assert.doesNotMatch(migration, /bounty|amount_atomic|fee_atomic|paid_assignment/iu);
});
