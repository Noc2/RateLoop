import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0136_lane_paid_eligibility.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("lane paid eligibility is forward-only and journaled", () => {
  assert.equal(journal.entries.find(value => value.tag === "0136_lane_paid_eligibility")?.idx, 136);
  assert.match(migration, /CREATE TABLE "tokenless_sanctions_screenings"/u);
  assert.match(migration, /CREATE TABLE "tokenless_paid_eligibility_scopes"/u);
  assert.match(migration, /'manual:v1','opensanctions:v1'/u);
  assert.match(migration, /"adulthood_basis" IN \('customer_attested','provider_attested','self_declared'\)/u);
  assert.doesNotMatch(migration, /\bDROP TABLE\b|\bTRUNCATE\b/u);
});
