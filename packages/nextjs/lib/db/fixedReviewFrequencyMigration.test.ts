import { tokenlessAgentReviewPolicies } from "./schema";
import { getTableColumns } from "drizzle-orm";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(process.cwd(), "drizzle", "0054_fixed_review_frequency.sql"), "utf8");

test("fixed review policies persist an exact nullable basis-point rate", () => {
  assert.match(migration, /ADD COLUMN "fixed_rate_bps" integer/);
  assert.match(migration, /"mode" IN \('manual', 'always', 'rules', 'adaptive', 'fixed'\)/);
  assert.match(
    migration,
    /\("mode" = 'fixed' AND "fixed_rate_bps" BETWEEN 1 AND 10000\)\s+OR \("mode" <> 'fixed' AND "fixed_rate_bps" IS NULL\)/,
  );
  const fixedRate = getTableColumns(tokenlessAgentReviewPolicies).fixedRateBps;
  assert.equal(fixedRate.notNull, false);
  assert.equal(fixedRate.dataType, "number");
});

test("fixed and adaptive policies retain distinct safety-floor constraints", () => {
  assert.match(migration, /"mode" <> 'adaptive' OR "production_floor_bps" >= 1000/);
  assert.match(migration, /"mode" <> 'fixed' OR "production_floor_bps" = 0/);
  assert.doesNotMatch(migration, /ADD COLUMN "maximum_unreviewed_gap"/);
});
