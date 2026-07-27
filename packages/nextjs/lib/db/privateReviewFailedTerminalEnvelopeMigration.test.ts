import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0157_failed_private_review_result_envelopes.sql", import.meta.url),
  "utf8",
);

test("failed private reviews may persist the terminal result envelope required by the result API", () => {
  assert.match(
    migration,
    /"status" IN \('completed','inconclusive','failed_terminal'\)\s+AND "result_envelope_json" IS NOT NULL/u,
  );
  assert.match(migration, /"result_commitment" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
});
