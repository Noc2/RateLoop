import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0179_dsa_named_reference_panel.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../tokenless/dsaNamedReferencePanel.ts", import.meta.url), "utf8");
const labelFreeze = readFileSync(new URL("../tokenless/dsaReferenceLabelSets.ts", import.meta.url), "utf8");
const taskRoute = readFileSync(
  new URL("../../app/api/account/assurance/assignments/[assignmentId]/task/route.ts", import.meta.url),
  "utf8",
);
const responseRoute = readFileSync(
  new URL("../../app/api/account/assurance/assignments/[assignmentId]/responses/route.ts", import.meta.url),
  "utf8",
);
const acceptanceRoute = readFileSync(
  new URL("../../app/api/account/assurance/assignments/[assignmentId]/dsa-reference-panel/route.ts", import.meta.url),
  "utf8",
);
const managementRoute = readFileSync(
  new URL("../../app/api/account/workspaces/[workspaceId]/compliance/dsa/reference-panel/route.ts", import.meta.url),
  "utf8",
);

test("0179 binds named-panel evidence to selected evaluations, exact assignments, accesses, and responses", () => {
  for (const table of [
    "tokenless_dsa_named_panel_units",
    "tokenless_dsa_named_panel_assignments",
    "tokenless_dsa_named_panel_artifact_accesses",
    "tokenless_dsa_named_panel_response_evidence",
    "tokenless_dsa_named_panel_adjudications",
    "tokenless_dsa_named_panel_unit_outcomes",
    "tokenless_dsa_named_panel_label_set_bridges",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"));
    assert.match(migration, new RegExp(`${table}.*append_only`, "su"));
  }
  assert.match(migration, /REFERENCES "tokenless_dsa_reference_sample_manifest"/u);
  assert.match(migration, /REFERENCES "tokenless_dsa_reference_evaluation_projections"/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_run_cases"/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_assignments"/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_artifact_leases"/u);
  assert.match(migration, /REFERENCES "tokenless_assurance_responses"/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/gu);
  assert.match(migration, /assignment_count<>NEW\.required_reviewer_count/u);
  assert.match(migration, /response_count<>NEW\.response_count/u);
  assert.match(migration, /access_count<>NEW\.required_reviewer_count/u);
  assert.match(migration, /"accessed_at"<="response_submitted_at"/u);
  assert.match(migration, /tokenless_dsa_named_panel_response_root/u);
  assert.match(migration, /registered_before_delivery_at_commit/u);
  assert.match(migration, /count\(\*\) FROM tokenless_assurance_run_cases run_case/u);
  assert.match(migration, /blinded_payload_json"::jsonb#>>'\{reference,populationId\}'="population_id"/u);
});

test("0179 persists CEFR reading and policy-category evidence instead of a bare language tag", () => {
  assert.match(migration, /"required_language_activity" text NOT NULL/u);
  assert.match(migration, /"required_language_activity"='reading'/u);
  assert.match(migration, /"required_cefr_level" IN \('B2','C1','C2'\)/u);
  assert.match(migration, /"language_evidence_kind" text NOT NULL/u);
  assert.match(migration, /"language_evidence_version" text NOT NULL/u);
  assert.match(migration, /"category_evidence_kind" text NOT NULL/u);
  assert.match(migration, /"category_evidence_version" text NOT NULL/u);
  assert.match(service, /language:\$\{text\(row, "language_tag"\)!\.toLowerCase\(\)\}:reading:cefr/u);
  assert.match(service, /dsa-policy-category:/u);
  assert.match(service, /qualificationExpiresAt/u);
});

test("independent label freeze has no manager-label fallback and persists the exact research-only bridge", () => {
  const publicFreeze = labelFreeze.slice(
    labelFreeze.indexOf("export async function freezeDsaReferenceLabelSet"),
    labelFreeze.indexOf("export async function loadDsaReferenceLabelSet"),
  );
  assert.doesNotMatch(publicFreeze, /namedPanelLabels \?\? input\.labels/u);
  assert.doesNotMatch(publicFreeze, /labels:\s*input\.labels/u);
  assert.match(publicFreeze, /dsa_named_panel_outcomes_required/u);
  assert.match(publicFreeze, /persistDsaNamedPanelLabelSetBridge/u);
  assert.match(migration, /"reporting_mode"='independent_reference_panel_research_only'/u);
  assert.match(migration, /"population_claim"=false/u);
  assert.match(migration, /"operational_rollup_eligible"=false/u);
  assert.match(migration, /"adaptive_reuse_allowed"=false/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id","label_set_id","epoch_id","label_root","label_set_hash"\)/u);
  assert.doesNotMatch(migration, /IF unit_count=0 THEN RETURN NEW/u);
  assert.match(migration, /bridge_count<>1/u);
  assert.match(migration, /identity_leak_count<>0/u);
  assert.match(migration, /NEW\.bridge_json::jsonb<>jsonb_build_object/u);
});

test("the principal-bound case route resolves DSA assignments before the generic task projection", () => {
  const dsa = taskRoute.indexOf("getDsaNamedPanelTaskIfExists");
  const generic = taskRoute.indexOf("getAssignmentOnlyTask({");
  assert.ok(dsa >= 0 && generic > dsa);
  assert.match(service, /pa\.reviewer_principal_id=\$2/u);
  assert.match(service, /freezeDsaBlindedCaseMapping/u);
  assert.match(service, /tokenless_dsa_named_panel_artifact_accesses/u);
  assert.match(service, /hasPendingNamedPanelRegistration/u);
  assert.match(service, /dsa_named_panel_acceptance_required/u);
  assert.match(service, /dsa_named_panel_access_required/u);
  assert.match(service, /dsa_named_panel_registration_too_late/u);
  assert.match(service, /idempotent: true/u);
  assert.match(service, /run_case_count/u);
  assert.doesNotMatch(migration, /withheld_snapshot_json/u);
  assert.doesNotMatch(service, /withheld_snapshot_json/u);
  assert.doesNotMatch(service, /localeCompare/u);
});

test("authenticated routes reach every named-panel workflow stage with bounded strict bodies", () => {
  for (const name of [
    "registerDsaNamedPanelUnit",
    "adjudicateDsaNamedPanelDisagreement",
    "freezeDsaNamedPanelOutcome",
    "freezeDsaReferenceLabelSet",
  ])
    assert.match(managementRoute, new RegExp(name, "u"));
  assert.match(acceptanceRoute, /acceptDsaNamedPanelAssignment/u);
  assert.match(responseRoute, /submitDsaNamedPanelResponseIfExists/u);
  assert.match(managementRoute, /readApiJsonRequestBody\(request, MAX_BODY_BYTES\)/u);
  assert.match(acceptanceRoute, /readApiJsonRequestBody\(request, 32 \* 1_024\)/u);
  assert.match(managementRoute, /private, no-store/u);
  assert.match(acceptanceRoute, /private, no-store/u);
});
