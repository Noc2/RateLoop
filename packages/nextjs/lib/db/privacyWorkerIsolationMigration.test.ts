import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0141_privacy_worker_failure_isolation.sql", import.meta.url),
  "utf8",
);

test("privacy workers persist bounded retry and unresolved operator-alert evidence", () => {
  assert.match(migration, /tokenless_privacy_worker_failures/u);
  assert.match(migration, /UNIQUE \("worker_kind","work_item_key"\)/u);
  assert.match(migration, /"attempt_count" BETWEEN 1 AND 5/u);
  assert.match(migration, /"operator_alert_state" IN \('pending','resolved'\)/u);
  assert.match(migration, /"status" = 'dead' AND "next_retry_at" IS NULL/u);
  assert.match(migration, /WHERE "operator_alert_state" = 'pending'/u);
});
