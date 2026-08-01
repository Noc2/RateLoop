import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0178_dsa_reference_network_provenance.sql", import.meta.url),
  "utf8",
);

test("0178 binds only selected units to the exact activation, opportunity, run, case, round, and epoch", () => {
  assert.match(
    migration,
    /tokenless_dsa_reference_network_units_execution_fk[\s\S]*?activation_reference[\s\S]*?opportunity_id[\s\S]*?run_id[\s\S]*?deployment_key/u,
  );
  assert.match(
    migration,
    /tokenless_dsa_reference_network_units_round_fk[\s\S]*?case_id[\s\S]*?chain_id[\s\S]*?panel_address[\s\S]*?round_id/u,
  );
  assert.match(
    migration,
    /tokenless_dsa_reference_network_units_manifest_fk[\s\S]*?manifest_selected[\s\S]*?REFERENCES "tokenless_dsa_reference_sample_manifest"/u,
  );
  assert.match(migration, /"manifest_selected"=true/u);
  assert.match(migration, /tokenless_dsa_reference_sampling_epochs_network_bridge_exact_unique/u);
  assert.match(migration, /tokenless_dsa_reference_network_units_case_mapping_fk/u);
  assert.match(migration, /tokenless_dsa_reference_network_units_blinded_mapping_fk/u);
  assert.match(migration, /reference-network blinded choice mapping is not exact/u);
});

test("0178 keeps principal-bound reviewer evidence private and append-only", () => {
  assert.match(migration, /FOREIGN KEY \("reviewer_principal_id"\) REFERENCES "tokenless_principals"/u);
  assert.match(migration, /assignment is not bound to the exact network reviewer principal/u);
  assert.match(migration, /completed response provenance is not exact and valid/u);
  assert.match(migration, /"response_reviewer_source"='rateloop_network' AND "response_validity"='valid'/u);
  for (const table of ["units", "lifecycle_events", "adjudications", "label_set_bridges"]) {
    assert.match(migration, new RegExp(`tokenless_dsa_reference_network_${table}_append_only`, "u"));
  }
  assert.match(migration, /reviewer identity leaked into a public\/export label artifact/u);
  assert.match(
    migration,
    /tokenless_dsa_reference_network_events_assignment_once[\s\S]*?WHERE "event_type"='assigned'/u,
  );
  assert.match(
    migration,
    /tokenless_dsa_reference_network_events_response_once[\s\S]*?WHERE "event_type"='completed'/u,
  );
  assert.match(migration, /"event_type" IN \('invited','assigned','timed_out'\) AND "asserted_by_kind"='allocator'/u);
  assert.match(migration, /"asserted_by_principal_id"<>"reviewer_principal_id"/u);
  assert.doesNotMatch(
    migration.match(
      /CREATE TABLE "tokenless_dsa_reference_network_label_set_bridges"[\s\S]*?\);--> statement-breakpoint/u,
    )?.[0] ?? "",
    /reviewer_(?:principal|key)|assignment_id|response_id/u,
  );
});

test("0178 enforces the exact invitation lifecycle, database clock, and all-terminal coverage", () => {
  assert.match(migration, /tokenless_dsa_evidence_transaction_timestamp\(\)/u);
  assert.match(
    migration,
    /previous_record\."event_type"='invited' AND NEW\."event_type" IN \('accepted','declined','timed_out'\)/u,
  );
  assert.match(
    migration,
    /previous_record\."event_type"='opened' AND NEW\."event_type" IN \('completed','timed_out'\)/u,
  );
  assert.match(
    migration,
    /previous_record\."event_type"='assigned' AND NEW\."event_type" IN \('opened','timed_out'\)/u,
  );
  assert.match(migration, /cannot time out before its deadline/u);
  assert.match(migration, /actual_invited<>actual_declined\+actual_completed\+actual_timed_out/u);
  assert.match(migration, /actual_assigned<actual_opened OR actual_opened<actual_completed/u);
  assert.match(migration, /timeout stage does not match the frozen lifecycle stage/u);
  assert.match(
    migration,
    /Every invited reviewer must reach one typed terminal state|reference-network adjudication lifecycle coverage or roots are incomplete/u,
  );
});

test("0178 blocks incomplete or tampered network-derived label sets at commit", () => {
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_network_label_sets_complete_at_commit[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u,
  );
  assert.match(
    migration,
    /CREATE CONSTRAINT TRIGGER tokenless_dsa_reference_network_bridges_complete_at_commit[\s\S]*?DEFERRABLE INITIALLY DEFERRED/u,
  );
  assert.match(migration, /m\."selected"=true|"manifest_selected"=true/u);
  assert.match(migration, /l\."reference_label" IS DISTINCT FROM a\."final_label"/u);
  assert.match(migration, /l\."adjudication_evidence_digest" IS DISTINCT FROM a\."adjudication_hash"/u);
  assert.match(migration, /bridge_record\."bridge_json"::jsonb<>expected_json/u);
  assert.match(migration, /network-derived label set coverage or exact provenance is incomplete/u);
});

test("0178 records descriptive panel-versus-network counts and rejects rollup or adaptive reuse", () => {
  for (const count of [
    "invited_count",
    "accepted_count",
    "declined_count",
    "assigned_count",
    "opened_count",
    "completed_count",
    "timed_out_count",
  ]) {
    assert.match(migration, new RegExp(`"${count}" integer NOT NULL`, "u"));
  }
  for (const root of ["lifecycle_root", "response_root", "adjudication_root"]) {
    assert.match(migration, new RegExp(`"${root}" text NOT NULL`, "u"));
  }
  assert.match(migration, /"reporting_mode"='descriptive_panel_vs_network_only'/u);
  assert.match(migration, /"population_claim"=false/u);
  assert.match(migration, /"operational_rollup_eligible"=false/u);
  assert.match(migration, /"adaptive_reuse_allowed"=false/u);
  const bridgeCheck =
    migration.match(/tokenless_dsa_reference_network_label_set_bridges_contract_check[\s\S]*?\n  \)\n\);/u)?.[0] ?? "";
  assert.match(bridgeCheck, /"completed_count" >= "selected_unit_count"/u);
  assert.match(bridgeCheck, /"invited_count" >= "selected_unit_count"/u);
  assert.match(bridgeCheck, /"timed_out_count" >= 0/u);
  assert.doesNotMatch(bridgeCheck, /"(?:invited|accepted|assigned|opened|completed|timed_out)_count"=1/u);
});
