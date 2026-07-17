import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0092_oversight_attestations.sql", import.meta.url), "utf8");

test("oversight attestations are workspace-bound with scoped authority, bounded free text, and paired revocation", () => {
  assert.match(migration, /CREATE TABLE "tokenless_oversight_attestations"/u);
  assert.match(migration, /REFERENCES "tokenless_workspaces"\("workspace_id"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "account_address"\)/u);
  assert.match(migration, /"authority_scope" IN \('override', 'stop', 'both'\)/u);
  assert.match(migration, /char_length\("competence_basis"\) BETWEEN 1 AND 2000/u);
  assert.match(migration, /"expires_at" > "attested_at"/u);
  assert.match(migration, /"status" = 'revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL/u);
  assert.doesNotMatch(migration, /payout|bounty|settlement/iu);
});
