import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMemoryDatabaseResources, readJournalMigrationFiles } from "~~/lib/db/testing/testMemory";

const migration = readFileSync(
  new URL("../../drizzle/0186_dsa_named_adjudicator_assignments.sql", import.meta.url),
  "utf8",
);

test("0186 requires one immutable, separated, explicitly qualified adjudicator assignment", () => {
  assert.match(migration, /tokenless_dsa_named_panel_adjudicator_assignments/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id","epoch_id","unit_id"\)/u);
  assert.match(migration, /adjudicator_assignments_append_only/u);
  assert.match(migration, /response_count<>required_count OR distinct_label_count<2/u);
  assert.match(migration, /member\.account_address IN \(NEW\.assigned_by,NEW\.adjudicator_principal_id\)/u);
  assert.match(migration, /tokenless_dsa_named_panel_qualification_evidence_valid/u);
  assert.match(migration, /adjudications_assignee_fk/u);
  assert.match(migration, /adjudication_leases_assignee_fk/u);
});

test("0186 binds assignment, adjudication, and outcome evidence to database time", () => {
  assert.match(migration, /NEW\.assigned_at IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u);
  assert.match(migration, /adjudication_transaction_time_guard/u);
  assert.match(migration, /NEW\."created_at" IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u);
  assert.match(migration, /assignment\."adjudication_deadline">=NEW\."created_at"/u);
  assert.match(migration, /assignment\."qualification_expires_at">=NEW\."created_at"/u);
  assert.match(migration, /outcome_transaction_authority_guard/u);
  assert.match(migration, /NEW\."frozen_at" IS DISTINCT FROM date_trunc\('milliseconds',transaction_timestamp\(\)\)/u);
  assert.match(migration, /member\."role" IN \('owner','admin'\)/u);
});

test("0186 closes the exact adjudication lease and blocks later authority grants", () => {
  assert.match(migration, /terminal_closes_adjudication_lease_at_commit/u);
  assert.match(migration, /tokenless_guard_dsa_named_panel_live_authority_grant/u);
  assert.match(migration, /tokenless_dsa_named_panel_adjudicator_assignments/u);
  assert.match(migration, /adjudicator_nonresponse/u);
  assert.match(migration, /separated_project_auditor_assignment_nonresponse/u);
});

test("the journal and structural harness reach 0186", () => {
  const files = readJournalMigrationFiles(new URL("../../drizzle", import.meta.url).pathname);
  assert.ok(files.includes("0186_dsa_named_adjudicator_assignments.sql"));
  assert.ok(createMemoryDatabaseResources().pool);
});
