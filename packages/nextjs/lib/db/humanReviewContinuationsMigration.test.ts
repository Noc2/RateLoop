import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0065_human_review_continuations.sql", import.meta.url), "utf8");

test("0065 stores only hashed opaque continuation tokens with one active operation per revision", () => {
  assert.match(migration, /"token_hash" text NOT NULL/u);
  assert.match(migration, /"token_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.doesNotMatch(migration, /"(?:token|continuation_token)" text/u);
  assert.match(migration, /tokenless_agent_review_continuations_active_revision_operation_unique/u);
  assert.match(migration, /WHERE "status" = 'active'/u);
});

test("0065 binds lifecycle, operation, credential, expiry, consumption, and rotation state", () => {
  assert.match(migration, /tokenless_agent_review_continuations_lifecycle_fk/u);
  assert.match(migration, /"allowed_operation" IN \('request_review', 'wait_for_review'\)/u);
  assert.match(migration, /"caller_credential_kind" IN \('api_key', 'oauth_token_family'\)/u);
  assert.match(migration, /"expires_at" > "issued_at"/u);
  assert.match(migration, /"status" IN \('active', 'consumed', 'rotated', 'revoked', 'expired'\)/u);
  assert.match(migration, /"successor_continuation_id" IS NOT NULL/u);
});

test("0065 journals continuation events append-only without credential plaintext", () => {
  assert.match(migration, /CREATE TABLE "tokenless_agent_review_continuation_events"/u);
  assert.match(migration, /"actor_credential_commitment" text NOT NULL/u);
  assert.doesNotMatch(migration, /"actor_credential_id"/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /human-review continuation events are append-only/u);
});
