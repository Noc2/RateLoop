import { getTableName } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { tokenlessEvmTransactionVersions } from "~~/lib/db/schema";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0126_evm_transaction_fee_replacements.sql", import.meta.url),
  "utf8",
);

test("0126 stores append-only transaction versions with signer and fee audit identities", () => {
  assert.match(migration, /CREATE TABLE "tokenless_evm_transaction_versions"/u);
  assert.match(migration, /UNIQUE\("business_kind", "business_key", "transaction_kind", "generation"\)/u);
  assert.match(migration, /UNIQUE\("transaction_hash"\)/u);
  assert.match(migration, /"signature_hash" text NOT NULL/u);
  assert.match(migration, /"max_fee_per_gas" numeric\(78, 0\) NOT NULL/u);
  assert.match(migration, /"max_priority_fee_per_gas" numeric\(78, 0\) NOT NULL/u);
  assert.match(migration, /BEFORE UPDATE OR DELETE/u);
  assert.match(migration, /BEFORE TRUNCATE/u);
});

test("0126 is ordered before the current journal head and its version table is present in the applied schema", async () => {
  const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 126),
    {
      idx: 126,
      version: "7",
      when: 1784394000000,
      tag: "0126_evm_transaction_fee_replacements",
      breakpoints: true,
    },
  );
  assert.equal(getTableName(tokenlessEvmTransactionVersions), "tokenless_evm_transaction_versions");
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  const columns = await dbClient.execute(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'tokenless_evm_transaction_versions'
     ORDER BY column_name`,
  );
  assert.deepEqual(
    columns.rows.map(row => row.column_name),
    [
      "business_key",
      "business_kind",
      "created_at",
      "deployment_key",
      "generation",
      "max_fee_per_gas",
      "max_priority_fee_per_gas",
      "nonce",
      "signature_hash",
      "signed_transaction",
      "signer_address",
      "signer_role",
      "transaction_hash",
      "transaction_kind",
      "version_id",
    ],
  );
});

afterEach(() => __setDatabaseResourcesForTests(null));
