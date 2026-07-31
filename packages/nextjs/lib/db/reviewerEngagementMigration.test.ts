import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0167_reviewer_engagement_events.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0167 appends server-timestamped reviewer engagement evidence with exact scope and idempotency", () => {
  assert.match(migration, /CREATE TABLE "tokenless_reviewer_engagement_subject_crosswalk"/u);
  assert.match(migration, /CREATE TABLE "tokenless_reviewer_engagement_events"/u);
  for (const field of [
    "workspace_id",
    "assignment_id",
    "reviewer_subject_id",
    "sequence",
    "idempotency_key_hash",
    "request_hash",
    "employment_governance_version",
    "occurred_at",
    "created_at",
  ]) {
    assert.match(migration, new RegExp(`"${field}"`, "u"), field);
  }
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "employment_governance_version"\)[\s\S]*tokenless_workspace_employment_data_governance_versions/u,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "assignment_id", "reviewer_subject_id", "sequence"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "assignment_id", "reviewer_subject_id", "idempotency_key_hash"\)/u);
  assert.match(migration, /'first_artifact_access', 'active_interaction', 'idle', 'reopened', 'submitted'/u);
  assert.match(migration, /CHECK \("occurred_at" = "created_at"\)/u);
  assert.match(migration, /reviewer engagement events are append-only/u);
  assert.doesNotMatch(migration, /score|override|supersedes/iu);
  const eventsDefinition = migration.match(
    /CREATE TABLE "tokenless_reviewer_engagement_events" \(([\s\S]*?)\);--> statement-breakpoint/u,
  )?.[1];
  assert.ok(eventsDefinition);
  assert.doesNotMatch(eventsDefinition, /reviewer_account_address/u);
  assert.doesNotMatch(eventsDefinition, /REFERENCES "tokenless_reviewer_engagement_subject_crosswalk"/u);
  assert.match(eventsDefinition, /REFERENCES "tokenless_workspaces"\("workspace_id"\) ON DELETE CASCADE/u);
  assert.match(migration, /"retention_until" timestamp with time zone NOT NULL/u);
  assert.match(migration, /tokenless_reviewer_engagement_subject_crosswalk_retention_idx/u);
  assert.match(
    migration,
    /CREATE TABLE "tokenless_reviewer_engagement_subject_crosswalk"[\s\S]*REFERENCES "tokenless_workspaces"\("workspace_id"\) ON DELETE CASCADE/u,
  );
  assert.match(
    migration,
    /IF TG_OP = 'DELETE' AND NOT EXISTS \([\s\S]*FROM tokenless_workspaces WHERE workspace_id = OLD.workspace_id/u,
  );
});

test("0167 follows employment governance in the migration journal", () => {
  const entryIndex = journal.entries.findIndex(entry => entry.tag === "0167_reviewer_engagement_events");
  assert.deepEqual(journal.entries.slice(entryIndex - 1, entryIndex + 1), [
    { idx: 166, version: "7", when: 1785247200000, tag: "0166_employment_data_governance", breakpoints: true },
    { idx: 167, version: "7", when: 1785250800000, tag: "0167_reviewer_engagement_events", breakpoints: true },
  ]);
});
