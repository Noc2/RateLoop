import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0173_dsa_reference_label_sets.sql", import.meta.url), "utf8");

test("0173 binds each immutable label set to the exact frozen sample", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root"\)[\s\S]*?REFERENCES "tokenless_dsa_reference_samples"/u,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "epoch_id"\)/u);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
});

test("0173 binds labels to selected manifest rows and exact evaluation projections", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "unit_id", "manifest_selected", "source_decision_binding",[\s\S]*?REFERENCES "tokenless_dsa_reference_sample_manifest"[\s\S]*?"selected"/u,
  );
  assert.match(migration, /"manifest_selected" = true/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "evaluation_id", "unit_id", "provider_decision_id",[\s\S]*?"system_identity", "system_id", "system_version",[\s\S]*?REFERENCES "tokenless_dsa_reference_evaluation_projections"/u,
  );
  assert.match(migration, /UNIQUE \("workspace_id", "epoch_id", "evaluation_id"\)/u);
});

test("0173 enforces exact completeness at commit and append-only evidence", () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_label_set_complete_at_commit/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /selected_count <> NEW\.expected_selected_count/u);
  assert.match(migration, /label_count <> NEW\.expected_selected_count/u);
  assert.match(migration, /pass_count <> NEW\.pass_label_count/u);
  assert.match(migration, /uncertain_count <> NEW\.uncertain_label_count/u);
  assert.match(migration, /tokenless_dsa_reference_label_sets_append_only/u);
  assert.match(migration, /tokenless_dsa_reference_labels_append_only/u);
});

test("0173 preserves uncertainty as a coverage gap without adaptive promotion", () => {
  assert.match(migration, /"uncertain_label_count" > 0 AND "coverage_gap" = 'uncertain_reference_labels'/u);
  assert.match(migration, /"reference_label" <> 'uncertain' OR "agreement_state" = 'adjudicated'/u);
  assert.doesNotMatch(migration, /adaptive|promotion|operational[_ -]?(?:use|state)/iu);
});
