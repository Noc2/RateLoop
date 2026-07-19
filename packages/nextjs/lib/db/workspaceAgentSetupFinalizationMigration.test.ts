import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0115_workspace_agent_setup_finalization.sql", import.meta.url),
  "utf8",
);
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");

test("workspace setup finalization persists only replay hashes and invitation metadata", () => {
  assert.match(migration, /ADD COLUMN "finalization_idempotency_key_hash" text/u);
  assert.match(migration, /ADD COLUMN "finalization_request_hash" text/u);
  assert.match(
    migration,
    /ADD COLUMN "people_invitation_id" text[\s\S]*REFERENCES "tokenless_private_group_invitations"/u,
  );
  assert.match(migration, /\^sha256:\[0-9a-f\]\{64\}\$/u);
  assert.doesNotMatch(migration, /(?:invitation_token|idempotency_key)" text/iu);
  assert.match(journal, /"idx": 115[\s\S]*"tag": "0115_workspace_agent_setup_finalization"/u);
});
