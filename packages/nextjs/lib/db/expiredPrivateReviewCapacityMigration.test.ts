import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0134_expired_private_review_capacity.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0134 repairs only accepted seats leaked by reviewer-access revocation", () => {
  assert.equal(journal.entries.at(-1)?.idx, 134);
  assert.equal(journal.entries.at(-1)?.tag, "0134_expired_private_review_capacity");
  assert.match(migration, /assignment\."status"='accepted'/u);
  assert.match(migration, /assignment\."lease_state"='expired'/u);
  assert.match(migration, /access_grant\."revoked_at" IS NOT NULL/u);
  assert.match(migration, /assignment\."updated_at"=access_grant\."revoked_at"/u);
  assert.match(migration, /active_reservations=GREATEST\(0,reviewer\.active_reservations-stale\.stale_count\)/u);
  assert.match(migration, /active_reservations=GREATEST\(0,cohort\.active_reservations-stale\.stale_count\)/u);
});
