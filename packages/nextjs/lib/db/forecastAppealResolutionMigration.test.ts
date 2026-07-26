import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0144_forecast_appeal_resolution.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ tag: string }>;
};

test("forecast appeal resolution has an immutable transition ledger and erasure-only deletion", () => {
  assert.ok(journal.entries.some(entry => entry.tag === "0144_forecast_appeal_resolution"));
  assert.match(migration, /CREATE TABLE "tokenless_forecast_integrity_appeal_events"/u);
  assert.match(migration, /"event_type" IN \('opened','accepted','rejected','withdrawn'\)/u);
  assert.match(migration, /INSERT INTO "tokenless_forecast_integrity_appeal_events"/u);
  assert.match(migration, /resolved forecast integrity appeals are immutable/u);
  assert.match(migration, /account_erasure/u);
  assert.match(migration, /forecast integrity appeal events are append-only/u);
  assert.match(migration, /tokenless_forecast_appeal_events_no_update/u);
  assert.match(migration, /tokenless_forecast_appeal_events_no_delete/u);
});
