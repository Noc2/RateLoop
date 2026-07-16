import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0061_private_review_foundation.sql", import.meta.url), "utf8");

test("private-review migration binds integrations and reserves before encrypted upload", () => {
  assert.match(migration, /"integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"/u);
  assert.match(migration, /UNIQUE \("integration_id", "idempotency_key"\)/u);
  assert.match(migration, /"caller_credential_kind" IN \('api_key', 'oauth_token_family'\)/u);
  assert.doesNotMatch(migration, /"api_key_id" text NOT NULL REFERENCES/u);
  assert.match(migration, /"planned_source_artifact_id" text NOT NULL/u);
  assert.match(migration, /"source_artifact_id" text REFERENCES/u);
  assert.match(migration, /"foundation_status" = 'preparing'/u);
  assert.match(migration, /"foundation_status" = 'failed_recoverable'/u);
  assert.match(migration, /"preparation_lease_expires_at"/u);
  assert.match(migration, /"preparation_upload_ids_json" text NOT NULL/u);
});

test("private-review migration stores only binary task bindings and artifact references", () => {
  assert.match(migration, /CHECK \("lane" = 'private'\)/u);
  assert.match(migration, /CHECK \("task_kind" = 'binary_review'\)/u);
  assert.match(migration, /'internal', 'confidential', 'restricted', 'regulated'/u);
  assert.doesNotMatch(migration, /source_(?:body|bytes|json|text)/iu);
  assert.doesNotMatch(migration, /suggestion_(?:body|bytes|json|text)/iu);
  assert.doesNotMatch(migration, /assignment_id|reservation_id/iu);
});
