import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0135_private_review_crowd_forecasts.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0135 stores private crowd forecasts on the exact one-percent grid", () => {
  assert.equal(journal.entries.at(-1)?.idx, 135);
  assert.equal(journal.entries.at(-1)?.tag, "0135_private_review_crowd_forecasts");
  assert.match(migration, /ADD COLUMN "predicted_positive_bps" integer/u);
  assert.match(migration, /"predicted_positive_bps" BETWEEN 100 AND 9900/u);
  assert.match(migration, /"predicted_positive_bps" % 100 = 0/u);
});
