import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0170_dsa_reference_sampling_epochs.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0170 creates one controlling epoch per immutable population and purpose", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_reference_sampling_epochs"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "population_id", "population_version", "purpose"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "population_id", "population_version"\)[\s\S]*REFERENCES "tokenless_dsa_population_versions"/u,
  );
  assert.match(migration, /"beacon_available_at" >= "committed_at" \+ interval '5 minutes'/u);
  assert.match(migration, /SELECT clock_timestamp\(\)/u);
  assert.match(migration, /"schema_version" = 'rateloop.reference-sampling-frame.v3'/u);
  assert.match(migration, /"context_authority" = 'workspace_manager_asserted_context'/u);
  assert.match(migration, /"population_frozen_at" <= "source_frozen_at"/u);
  assert.match(migration, /"source_frozen_at" <= "committed_at"/u);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_beacon_lead_at_commit/u);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_epoch_complete_at_commit/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /projects" \("workspace_id", "project_id"\) ON DELETE RESTRICT/u);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
});

test("0170 normalizes complete decision and decision-by-evaluation projections", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_reference_decision_projections"/u);
  assert.match(migration, /CREATE TABLE "tokenless_dsa_reference_evaluation_projections"/u);
  assert.match(migration, /REFERENCES "tokenless_dsa_content_moderation_decision_facts"/u);
  assert.match(migration, /REFERENCES "tokenless_dsa_automated_means_evaluations"/u);
  assert.match(migration, /tokenless_dsa_reference_decision_projections_population_binding_fk/u);
  assert.match(migration, /"measure_taken" boolean NOT NULL/u);
  assert.match(migration, /part8_fact_json/u);
  for (const disposition of ["evaluated", "not_automated", "eligible_draw", "excluded"]) {
    assert.match(migration, new RegExp(`'${disposition}'`, "u"), disposition);
  }
  for (const field of [
    "source_evaluation_binding",
    "source_evaluation_hash",
    "system_identity",
    "system_id",
    "system_version",
    "machine_class",
    "public_designation",
    "automated_outcome",
  ]) {
    assert.match(migration, new RegExp(`"${field}" text NOT NULL`, "u"), field);
  }
  assert.match(migration, /"reference_label_state" = 'unlabeled'/u);
  assert.match(migration, /projected_evaluation_count <> source_evaluation_count/u);
  assert.match(migration, /eligible_evaluation_count <> NEW\.eligible_draw_unit_count/u);
  assert.doesNotMatch(migration, /automatic_removal|classifier_system_id|always_review_unsupported/u);
});

test("0170 freezes system-bound manifests and witnessed transitions append-only", () => {
  for (const table of [
    "tokenless_dsa_reference_sampling_epochs",
    "tokenless_dsa_reference_decision_projections",
    "tokenless_dsa_reference_evaluation_projections",
    "tokenless_dsa_reference_samples",
    "tokenless_dsa_reference_sample_manifest",
    "tokenless_dsa_reference_sampling_events",
  ]) {
    assert.match(migration, new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`, "u"), table);
  }
  assert.match(migration, /probability_numerator/u);
  assert.match(migration, /probability_denominator/u);
  assert.match(migration, /"schema_version" = 'rateloop.reference-sample.v2'/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "commitment_digest", "beacon_network", "beacon_round"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "unit_id", "source_decision_binding", "source_evaluation_binding",\s*"source_evaluation_hash", "decision_at", "automation_processing", "system_identity", "automated_outcome"\)/u,
  );
  assert.match(migration, /"attestation_requirement" = 'enqueued_audit_export_head'/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_attestation_jobs"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest"\)/u,
  );
  assert.match(migration, /"attestation_artifact_kind" = 'audit_export_head'/u);
  assert.match(migration, /\("sequence" = 1 AND "event_type" = 'committed'\)/u);
  assert.match(migration, /\("sequence" = 2 AND "event_type" = 'frozen'\)/u);
});

test("0170 follows the typed Part 8 source-fact migration", () => {
  assert.deepEqual(
    journal.entries.slice(-2).map(entry => ({ idx: entry.idx, tag: entry.tag })),
    [
      { idx: 169, tag: "0169_dsa_part8_source_facts" },
      { idx: 170, tag: "0170_dsa_reference_sampling_epochs" },
    ],
  );
});
