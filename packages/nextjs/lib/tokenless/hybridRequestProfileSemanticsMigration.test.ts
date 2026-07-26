import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const sql = readFileSync(resolve(process.cwd(), "drizzle/0147_hybrid_request_profile_semantics.sql"), "utf8");
const journal = readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8");

test("hybrid profile migration advances exact per-cohort semantics to v4", () => {
  assert.match(sql, /SET "semantic_schema_version" = 4[\s\S]*WHERE "audience" = 'hybrid'/u);
  assert.match(sql, /"semantic_schema_version" IN \(1, 2, 3, 4\)/u);
  assert.match(sql, /@\.sourceScope != "customer_invited"/u);
  assert.match(sql, /@\.sourceScope != "rateloop_network"/u);
  assert.match(journal, /"idx": 147[\s\S]*"tag": "0147_hybrid_request_profile_semantics"/u);
});
