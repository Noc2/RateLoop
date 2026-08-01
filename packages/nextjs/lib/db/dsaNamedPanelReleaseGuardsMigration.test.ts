import { createMemoryDatabaseResources } from "./testing/testMemory";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0182_dsa_named_panel_release_guards.sql", import.meta.url),
  "utf8",
);
const accuracyMigration = readFileSync(
  new URL("../../drizzle/0174_dsa_part8_report_versions.sql", import.meta.url),
  "utf8",
);
const reportService = readFileSync(new URL("../tokenless/dsaPart8ReportVersions.ts", import.meta.url), "utf8");
const registrationService = readFileSync(new URL("../tokenless/dsaNamedReferencePanel.ts", import.meta.url), "utf8");

test("0182 quarantines legacy labels and requires the exact named-panel bridge for Part 8", () => {
  assert.match(migration, /tokenless_dsa_reference_label_set_quarantines/u);
  assert.match(migration, /legacy_pre_0182_unverified/u);
  assert.match(migration, /0182 refuses an existing Part 8 report without an exact named-panel bridge/u);
  assert.match(migration, /bridge\."epoch_id"=report\."epoch_id"/u);
  assert.match(migration, /bridge\."label_root"=report\."label_root"/u);
  assert.match(migration, /bridge\."label_set_hash"=report\."label_set_hash"/u);
  assert.match(migration, /quarantine\."label_set_id" IS NULL/u);
  assert.match(reportService, /JOIN tokenless_dsa_named_panel_label_set_bridges bridge/u);
  assert.match(reportService, /LEFT JOIN tokenless_dsa_reference_label_set_quarantines quarantine/u);
});

test("0182 makes run identity, reference definitions, and reviewer independence database invariants", () => {
  assert.match(migration, /refuses legacy DSA named-panel evidence without authoritative source and policy bindings/u);
  assert.match(migration, /tokenless_dsa_named_panel_units_run_unique/u);
  assert.match(migration, /UNIQUE \("workspace_id","project_id","run_id"\)/u);
  assert.match(migration, /tokenless_guard_dsa_named_panel_reference_definition/u);
  assert.match(migration, /tokenless_dsa_named_panel_reference_definitions/u);
  assert.match(migration, /project_auditor_without_workspace_membership/u);
  assert.match(migration, /"standard_id" text NOT NULL/u);
  assert.match(migration, /"standard_version" text NOT NULL/u);
  assert.match(migration, /"standard_hash" text NOT NULL/u);
  assert.match(migration, /'policyMatches','fail'/u);
  assert.match(migration, /'policyDoesNotMatch','pass'/u);
  assert.match(migration, /reviewers_binary_adjudicator_may_choose_uncertain/u);
  assert.match(migration, /qualified_non_panel_principal_required_on_disagreement/u);
  assert.match(migration, /tokenless_dsa_named_panel_units_source_evidence_check/u);
  assert.match(migration, /tokenless_dsa_named_panel_units_reference_definition_fk/u);
  assert.match(migration, /tokenless_dsa_named_panel_units_exact_json_check/u);
  assert.match(migration, /tokenless_guard_dsa_named_panel_registered_before_delivery/u);
  assert.match(migration, /subpanel\.selection='customer_named'/u);
  assert.match(migration, /reviewer_target_count<>NEW\.required_reviewer_count/u);
  assert.match(migration, /\{policy,policyVersion\}/u);
  assert.match(migration, /\{policy,policyHash\}/u);
  assert.match(migration, /tokenless_guard_dsa_named_panel_reviewer_independence/u);
  assert.doesNotMatch(migration, /member\."role" IN \('owner','admin'\)/u);
  assert.match(migration, /tokenless_guard_dsa_named_panel_live_authority_grant/u);
  assert.doesNotMatch(migration, /panel\."assignment_expires_at">transaction_timestamp\(\)/u);
  assert.match(migration, /tokenless_dsa_named_panel_adjudication_artifact_leases" marker/u);
  assert.match(migration, /marker\."adjudicator_principal_id"=principal_id/u);
  assert.match(migration, /tokenless_dsa_named_panel_bridge_quarantine_guard/u);
  assert.match(migration, /tokenless_dsa_named_panel_research_export_quarantine_guard/u);
  assert.match(migration, /tokenless_dsa_named_panel_research_grant_quarantine_guard/u);
  assert.match(registrationService, /Open the exact blinded artifact before recording an adjudication/u);
  assert.match(migration, /tokenless_dsa_named_panel_adjudication_artifact_leases/u);
  assert.match(migration, /lease\."purpose"='dsa_named_panel_adjudication'/u);
  assert.match(migration, /tokenless_dsa_named_panel_adjudicator_artifact_access_guard/u);
  assert.match(migration, /log\."action"='read'/u);
  assert.match(migration, /log\."purpose"='dsa_named_panel_adjudication'/u);
  assert.match(migration, /log\."occurred_at">=lease\."created_at"/u);
  assert.match(migration, /log\."occurred_at"<lease\."expires_at"/u);
  assert.match(migration, /log\."occurred_at"<lease\."revoked_at"/u);
  assert.match(migration, /log\."occurred_at"<=NEW\."created_at"/u);
  assert.match(migration, /tokenless_dsa_named_panel_adjudications_exact_json_check/u);
  assert.match(migration, /tokenless_dsa_named_panel_assignments_exact_json_check/u);
  assert.match(migration, /tokenless_dsa_named_panel_artifact_accesses_exact_json_check/u);
  assert.match(migration, /tokenless_dsa_named_panel_response_evidence_exact_json_check/u);
  assert.match(migration, /tokenless_dsa_named_panel_label_set_bridges_unique_json_check/u);
  assert.match(migration, /adjudicator_label_binding/u);
  assert.match(migration, /tokenless_dsa_named_panel_reference_label_binding_guard/u);
  assert.match(migration, /'hasConflict',false/u);
  assert.match(migration, /rateloop\.dsa-named-panel-adjudication\.v1/u);
  assert.match(migration, /'dsa-policy-category:'\|\|unit\."policy_category_code"/u);
  assert.match(migration, /tokenless_dsa_named_panel_unit_gaps/u);
  assert.match(migration, /tokenless_dsa_named_panel_selections/u);
  assert.match(migration, /rateloop\.dsa-named-panel-selection\.v1/u);
  assert.match(migration, /"acceptance_deadline"/u);
  assert.match(migration, /"response_window_ms" BETWEEN 86400000 AND 604800000/u);
  assert.match(migration, /"panel_deadline"="selected_at"\+\("response_window_ms"\*interval '1 millisecond'\)/u);
  assert.match(migration, /max\(panel_deadline\)/u);
  assert.match(migration, /reservation_frozen_at_commit/u);
  assert.match(migration, /cannot replace or exceed its exact reviewer seats/u);
  assert.match(migration, /Accepted DSA named-panel work cannot extend its frozen selection deadline/u);
  assert.match(migration, /"gap_reason"='reviewer_nonresponse'/u);
  assert.match(migration, /"response_count"<"required_reviewer_count"/u);
  assert.match(migration, /"assignment_deadline"<"declared_at"/u);
  assert.match(migration, /tokenless_dsa_named_panel_gap_terminal_at_commit/u);
  assert.match(migration, /"agreement_state" IN \('agreed','adjudicated','gap'\)/u);
  assert.match(migration, /"agreement_state"='gap' AND "reference_label"='uncertain'/u);
  assert.match(migration, /adjudication leases require an open unit/u);
  assert.match(migration, /tokenless_dsa_named_panel_outcome_unit_lock/u);
  assert.match(accuracyMigration, /label\.reference_label IN \('pass','fail'\)/u);
  assert.match(registrationService, /dsa_named_panel_run_conflict/u);
  assert.match(registrationService, /requireDsaNamedPanelReferenceDefinition/u);
});

test("the in-memory journal reaches 0182 while PostgreSQL owns its procedural guards", async () => {
  const resources = createMemoryDatabaseResources();
  try {
    const quarantine = await resources.pool.query(
      "SELECT workspace_id,label_set_id,reason FROM tokenless_dsa_reference_label_set_quarantines LIMIT 0",
    );
    assert.deepEqual(quarantine.rows, []);
  } finally {
    await resources.pool.end();
  }
});
