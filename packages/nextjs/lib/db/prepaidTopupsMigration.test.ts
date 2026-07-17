import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0085_prepaid_topups.sql", import.meta.url), "utf8");

test("0085 stores bounded idempotent prepaid top-ups", () => {
  assert.match(migration, /CREATE TABLE "tokenless_prepaid_topup_intents"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "idempotency_key"\)/u);
  assert.match(migration, /UNIQUE \("provider_invoice_id"\)/u);
  assert.match(migration, /UNIQUE \("provider_event_id"\)/u);
  assert.match(migration, /mod\("amount_atomic", 10000\) = 0/u);
  assert.match(migration, /"provider_tax_amount_minor" = \("provider_amount_due_minor" - "invoice_amount_minor"\)/u);
  assert.match(migration, /"invoice_currency" = 'usd'/u);
  assert.match(migration, /CHECK \("state" IN \('draft','sent','paid','credited','failed'\)\)/u);
  assert.match(migration, /"state" = 'credited' AND "paid_at" IS NOT NULL AND "credited_at" IS NOT NULL/u);
  assert.match(migration, /"reconciliation_attempts" >= 0/u);
});

test("0085 requires a complete structured billing address before it stores any location", () => {
  assert.match(migration, /ADD COLUMN "billing_country_code" text/u);
  assert.match(migration, /tokenless_workspace_governance_billing_address_check/u);
  assert.match(migration, /"billing_country_code" ~ '\^\[A-Z\]\{2\}\$'/u);
  assert.match(migration, /char_length\("billing_postal_code"\) BETWEEN 1 AND 32/u);
});
