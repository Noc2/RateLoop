import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0181_compliance_capability_issuance_idempotency.sql", import.meta.url),
  "utf8",
);

test("0181 persists only hash-bound issuance idempotency records", () => {
  assert.match(migration, /CREATE TABLE "tokenless_project_window_compliance_share_issuances"/u);
  assert.match(migration, /CREATE TABLE "tokenless_benchmark_research_grant_issuances"/u);
  assert.match(migration, /"idempotency_key_digest" text NOT NULL/u);
  assert.match(migration, /"request_binding_hash" text NOT NULL/u);
  assert.doesNotMatch(migration, /"idempotency_key"\s/u);
  assert.doesNotMatch(migration, /request_json|bearer_secret|access_token|token_lookup_digest/iu);
});

test("0181 binds every idempotency record to the exact append-only capability", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id", "share_id", "grant_hash", "issued_by", "issued_at"\)[\s\S]+REFERENCES "tokenless_project_window_compliance_shares"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id", "grant_id", "grant_event_digest", "authorized_by", "issued_at"\)[\s\S]+REFERENCES "tokenless_benchmark_research_grants"/u,
  );
  assert.match(migration, /tokenless_project_window_compliance_share_issuances_append_only/u);
  assert.match(migration, /tokenless_benchmark_research_grant_issuances_append_only/u);
});

test("0181 makes actor-scoped idempotency keys unique and request conflicts observable", () => {
  assert.match(migration, /PRIMARY KEY \("workspace_id", "project_id", "issued_by", "idempotency_key_digest"\)/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "project_id", "authorized_by", "idempotency_key_digest"\)/u);
  assert.equal((migration.match(/"request_binding_hash" ~ '\^sha256:/gu) ?? []).length, 2);
});
