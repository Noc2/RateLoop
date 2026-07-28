import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0158_reviewer_consensus_threshold.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("reviewer consensus has a distinct policy threshold without changing legacy policy behavior", () => {
  assert.match(migration, /ADD COLUMN "reviewer_consensus_threshold_bps" integer/u);
  assert.match(
    migration,
    /SET "reviewer_consensus_threshold_bps" = "agreement_threshold_bps"\s+WHERE "reviewer_consensus_threshold_bps" IS NULL/u,
  );
  assert.match(migration, /ALTER COLUMN "reviewer_consensus_threshold_bps" SET DEFAULT 7000/u);
  assert.match(migration, /"reviewer_consensus_threshold_bps" BETWEEN 0 AND 10000/u);
  assert.deepEqual(
    journal.entries.find(entry => entry.tag === "0158_reviewer_consensus_threshold"),
    {
      idx: 158,
      version: "7",
      when: 1785218400000,
      tag: "0158_reviewer_consensus_threshold",
      breakpoints: true,
    },
  );
});
