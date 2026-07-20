import { getTableName } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { tokenlessEvmNonceRecoveryFindings } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(new URL("../../drizzle/0125_evm_nonce_recovery_posture.sql", import.meta.url), "utf8");

test("0125 promotes only untouched legacy transaction rows", () => {
  assert.match(
    migration,
    /UPDATE "tokenless_chain_executions"[\s\S]*"transaction_recovery_version" = 0[\s\S]*"approval_nonce" IS NULL[\s\S]*"approval_transaction_hash" IS NULL[\s\S]*"approval_signed_transaction" IS NULL[\s\S]*"submission_nonce" IS NULL[\s\S]*"submission_transaction_hash" IS NULL[\s\S]*"submission_signed_transaction" IS NULL/u,
  );
  assert.match(
    migration,
    /UPDATE "tokenless_rater_commits"[\s\S]*"transaction_recovery_version" = 0[\s\S]*"relay_nonce" IS NULL[\s\S]*"transaction_hash" IS NULL[\s\S]*"relay_signed_transaction" IS NULL/u,
  );
  assert.match(
    migration,
    /UPDATE "tokenless_surprise_bounty_entitlements"[\s\S]*"transaction_recovery_version" = 0[\s\S]*"transfer_nonce" IS NULL[\s\S]*"transfer_transaction_hash" IS NULL[\s\S]*"transfer_signed_transaction" IS NULL/u,
  );
  assert.doesNotMatch(migration, /SET "transaction_recovery_version" = 1\s*;/u);
});

test("0125 persists unresolved nonce drift as release-blocking evidence", () => {
  assert.match(migration, /CREATE TABLE "tokenless_evm_nonce_recovery_findings"/u);
  assert.match(migration, /UNIQUE\("deployment_key", "signer_address", "reserved_nonce"\)/u);
  assert.match(migration, /'reconciliation_required'/u);
  assert.match(migration, /"business_kind" IN \('chain_execution', 'rater_commit', 'surprise_bounty'\)/u);
});

test("0125 is the journal head and its findings table is present in the applied schema", async () => {
  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(journal.entries.at(-1), {
    idx: 125,
    version: "7",
    when: 1784390400000,
    tag: "0125_evm_nonce_recovery_posture",
    breakpoints: true,
  });
  assert.equal(getTableName(tokenlessEvmNonceRecoveryFindings), "tokenless_evm_nonce_recovery_findings");
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const columns = await dbClient.execute(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'tokenless_evm_nonce_recovery_findings'
     ORDER BY column_name`,
  );
  assert.deepEqual(
    columns.rows.map(row => row.column_name),
    [
      "allocator_next_nonce",
      "business_key",
      "business_kind",
      "deployment_key",
      "diagnostic_code",
      "finding_id",
      "first_detected_at",
      "last_detected_at",
      "network_pending_nonce",
      "reserved_nonce",
      "resolved_at",
      "signer_address",
      "signer_role",
      "state",
    ],
  );
});

afterEach(() => __setDatabaseResourcesForTests(null));
