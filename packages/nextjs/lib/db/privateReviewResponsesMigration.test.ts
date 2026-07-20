import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0128_private_review_responses.sql", import.meta.url), "utf8");

test("private review responses are durable, assignment-bound, and plaintext-free", () => {
  assert.match(migration, /tokenless_private_review_responses/u);
  assert.match(migration, /REFERENCES "tokenless_private_unpaid_review_assignments"/u);
  assert.match(migration, /UNIQUE \("assignment_id"\)/u);
  assert.match(migration, /rationale_ciphertext/u);
  assert.match(migration, /response_commitment/u);
  assert.doesNotMatch(migration, /rationale_text|source_text|suggestion_text|reviewer_email/iu);
});

test("terminal private deliveries retain only a privacy-safe result envelope", () => {
  assert.match(migration, /result_envelope_json/u);
  assert.match(migration, /result_commitment/u);
  assert.match(migration, /completed_at/u);
  assert.match(migration, /status" IN \('completed','inconclusive'\)/u);
});
