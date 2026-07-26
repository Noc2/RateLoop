import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0138_crowd_forecast_integrity.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0138 persists only crowd forecast running sums in disjoint identity spaces", () => {
  assert.equal(journal.entries.find(value => value.tag === "0138_crowd_forecast_integrity")?.idx, 138);
  assert.match(migration, /CREATE TABLE "tokenless_forecast_calibration_accumulators"/u);
  assert.match(migration, /"subject_space" = 'invited_workspace'/u);
  assert.match(migration, /"subject_space" = 'network_rater'/u);
  assert.match(migration, /"subject_key" = "rater_id"/u);
  assert.doesNotMatch(migration, /predicted_positive_bps/u);
});

test("0138 uses workspace histograms, append-only findings, appeals, and payout-neutral consequences", () => {
  assert.match(migration, /CREATE TABLE "tokenless_forecast_workspace_histograms"/u);
  assert.match(migration, /"buckets_json" text NOT NULL/u);
  assert.match(migration, /CREATE TABLE "tokenless_forecast_pair_accumulators"/u);
  assert.match(migration, /CREATE TABLE "tokenless_forecast_integrity_terminal_receipts"/u);
  assert.match(migration, /"payout_effect" text NOT NULL DEFAULT 'none'/u);
  assert.match(migration, /CREATE TABLE "tokenless_forecast_integrity_appeals"/u);
  assert.match(migration, /crowd forecast integrity findings are append-only/u);
});
