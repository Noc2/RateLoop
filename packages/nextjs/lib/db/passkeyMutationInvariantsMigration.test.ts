import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const recentProofMigration = readFileSync(
  new URL("../../drizzle/0118_recent_account_action_proofs.sql", import.meta.url),
  "utf8",
);
const passkeyProofMigration = readFileSync(
  new URL("../../drizzle/0119_passkey_mutation_proofs.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("recent account action proofs store only hashed, expiring, one-use deletion grants", () => {
  assert.match(recentProofMigration, /"proof_hash" text PRIMARY KEY NOT NULL/u);
  assert.match(recentProofMigration, /"action" IN \('account_deletion'\)/u);
  assert.match(recentProofMigration, /"consumed_at" timestamp with time zone/u);
  assert.match(recentProofMigration, /"expires_at" > "created_at"/u);
  assert.match(
    recentProofMigration,
    /CREATE UNIQUE INDEX "tokenless_recent_account_action_proofs_principal_action_unique"[\s\S]+\("principal_id", "action"\)/u,
  );
  assert.equal(journal.entries.find(entry => entry.idx === 118)?.tag, "0118_recent_account_action_proofs");
});

test("passkey mutation proofs are hashed, expiring, one-use, and exact-action bound", () => {
  assert.match(passkeyProofMigration, /CREATE TABLE "tokenless_passkey_action_proofs"/u);
  assert.match(passkeyProofMigration, /"action" IN \('passkey_add'\)/u);
  assert.match(passkeyProofMigration, /"consumed_at" timestamp with time zone/u);
  assert.match(passkeyProofMigration, /"proof_hash" ~ '\^sha256:/u);
  assert.match(
    passkeyProofMigration,
    /CREATE UNIQUE INDEX "tokenless_passkey_action_proofs_principal_action_unique"[\s\S]+\("principal_id", "action"\)/u,
  );
  assert.equal(journal.entries.find(entry => entry.idx === 119)?.tag, "0119_passkey_mutation_proofs");
});
