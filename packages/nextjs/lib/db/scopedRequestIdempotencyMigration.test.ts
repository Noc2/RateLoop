import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0111_scoped_request_idempotency.sql", import.meta.url), "utf8");

test("0111 scopes ask and rater-commit idempotency to their authenticated authority", () => {
  assert.match(migration, /ADD COLUMN "idempotency_scope" text/u);
  assert.match(migration, /"api_key_id" IS NOT NULL/u);
  assert.match(migration, /"owner_account_address" IS NOT NULL/u);
  assert.match(migration, /DROP CONSTRAINT "tokenless_agent_asks_idempotency_key_unique"/u);
  assert.match(
    migration,
    /"tokenless_agent_asks_scope_idempotency_unique"[\s\S]+"idempotency_scope", "idempotency_key"/u,
  );
  assert.match(migration, /DROP CONSTRAINT "tokenless_rater_commits_idempotency_unique"/u);
  assert.match(
    migration,
    /"tokenless_rater_commits_voucher_idempotency_unique"[\s\S]+"voucher_id", "request_idempotency_key"/u,
  );
});
