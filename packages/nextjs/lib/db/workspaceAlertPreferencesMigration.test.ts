import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0095_workspace_alert_preferences.sql", import.meta.url), "utf8");

test("workspace alert preferences default to alerting with an adjustable disagreement threshold", () => {
  assert.match(migration, /CREATE TABLE "tokenless_workspace_alert_preferences"/u);
  assert.match(migration, /"workspace_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_workspaces"/u);
  assert.match(migration, /"gate_blocked" boolean NOT NULL DEFAULT true/u);
  assert.match(migration, /"review_failed" boolean NOT NULL DEFAULT true/u);
  assert.match(migration, /"workspace_stop" boolean NOT NULL DEFAULT true/u);
  assert.match(migration, /"coverage_floor_hit" boolean NOT NULL DEFAULT true/u);
  assert.match(migration, /"disagreement_spike_bps" integer DEFAULT 2500/u);
  assert.match(migration, /"disagreement_spike_bps" BETWEEN 1 AND 10000/u);
  // Browser delivery stays opt-in; the in-app surface needs no flag at all.
  assert.match(migration, /"browser_enabled" boolean NOT NULL DEFAULT false/u);
});

test("oversight alert email stays opt-in on both notification preference tables", () => {
  const alterStatements = migration.match(
    /ALTER TABLE "tokenless_notification_(?:preferences|email_subscriptions)"\s+ADD COLUMN "oversight_alerts" boolean NOT NULL DEFAULT false;/gu,
  );
  assert.equal(alterStatements?.length, 2);
});
