import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0113_rater_signed_transaction_recovery.sql", import.meta.url),
  "utf8",
);

test("0113 distinguishes legacy rater attempts and stores replayable signed transactions", () => {
  assert.match(migration, /ADD COLUMN "relay_signed_transaction" text/u);
  assert.match(migration, /ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL/u);
  assert.match(migration, /ALTER COLUMN "transaction_recovery_version" SET DEFAULT 1/u);
  assert.match(migration, /"relay_signed_transaction" ~ '\^0x\[0-9a-f\]\+\$'/u);
  assert.match(migration, /"transaction_recovery_version" IN \(0, 1\)/u);
});
