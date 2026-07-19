import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0114_principal_welcome_completion.sql", import.meta.url), "utf8");
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");

test("principal welcome completion is nullable for new accounts and backfilled for existing accounts", () => {
  assert.match(
    migration,
    /ALTER TABLE "tokenless_principals"[\s\S]*ADD COLUMN "welcome_completed_at" timestamp with time zone;/,
  );
  assert.doesNotMatch(migration, /welcome_completed_at[^;]*(?:NOT NULL|DEFAULT)/);
  assert.match(
    migration,
    /UPDATE "tokenless_principals"[\s\S]*SET "welcome_completed_at" = CURRENT_TIMESTAMP[\s\S]*WHERE "welcome_completed_at" IS NULL;/,
  );
  assert.match(journal, /"idx": 114[\s\S]*"tag": "0114_principal_welcome_completion"/);
});
