import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0174_dsa_part8_report_versions.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../tokenless/dsaPart8ReportVersions.ts", import.meta.url), "utf8");

test("0174 creates immutable reports with exact count, inventory, sample, and label bindings", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_report_versions"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "report_id", "report_version", "report_digest"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "contract_id", "count_result_digest"\)[\s\S]*REFERENCES "tokenless_dsa_part8_count_results"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "inventory_id", "inventory_root", "inventory_digest"\)[\s\S]*REFERENCES "tokenless_dsa_classifier_inventories"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root"\)[\s\S]*REFERENCES "tokenless_dsa_reference_samples"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "label_set_id", "epoch_id", "label_root", "label_set_hash"\)[\s\S]*REFERENCES "tokenless_dsa_reference_label_sets"/u,
  );
});

test("0174 requires reference evidence exactly when the frozen inventory has systems", () => {
  assert.match(migration, /SELECT inventory\.expected_system_count INTO inventory_system_count/u);
  assert.match(migration, /inventory_system_count=0 AND NEW\.epoch_id IS NOT NULL/u);
  assert.match(migration, /inventory_system_count>0 AND NEW\.epoch_id IS NULL/u);
  assert.match(migration, /labels\.coverage_gap IS NOT NULL AND NEW\.publication_eligible=true/u);
});

test("0174 versions corrections through an exact immediate predecessor", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "report_id", "supersedes_report_version", "supersedes_report_digest"\)/u,
  );
  assert.match(migration, /"supersedes_report_version" = "report_version" - 1/u);
  assert.match(migration, /char_length\(btrim\("correction_reason"\)\) BETWEEN 1 AND 500/u);
  assert.match(migration, /char_length\("change_summary_json"\) BETWEEN 2 AND 2000/u);
  assert.match(migration, /"method_declaration" = 'accepted_external_method_v1'/u);
});

test("0174 stores exact reconstructable files and source-bound calculations", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_report_cells"/u);
  assert.match(migration, /"calculation_binding_json" text NOT NULL/u);
  assert.match(migration, /"calculation_binding_hash" text NOT NULL/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "contract_id", "count_indicator", "count_scope", "count_cell_hash"\)[\s\S]*REFERENCES "tokenless_dsa_part8_count_cells"/u,
  );
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_report_files"/u);
  assert.match(migration, /"file_bytes" bytea NOT NULL/u);
  assert.match(migration, /octet_length\("file_bytes"\) = "byte_length"/u);
  assert.match(migration, /"file_kind" = 'public_csv'/u);
  assert.match(migration, /"file_kind" = 'confidential_evidence_json'/u);
  assert.match(service, /function publicCsvBytes/u);
  assert.match(service, /function verifyDsaPart8ReportVersion/u);
});

test("0174 replays complete cells, report JSON, and confidential evidence rather than trusting hashes", () => {
  assert.match(migration, /cell\.cell_json::jsonb <> jsonb_build_object\(/u);
  assert.match(migration, /cell\.calculation_binding_json::jsonb <> CASE/u);
  assert.match(migration, /NEW\.report_json::jsonb <> expected_report_json/u);
  assert.match(migration, /convert_to\('rateloop\.dsa-part8-report-cells\.v1','UTF8'\) \|\| decode\('00','hex'\)/u);
  assert.match(migration, /convert_from\(file\.file_bytes,'UTF8'\)::jsonb=reconstructed_confidential_json/u);
});

test("0174 binds both service and database consumers to the complete official Section 1.6 cell count", () => {
  assert.match(service, /expectedDsaPart8Section16RowCount\(/u);
  assert.match(migration, /expected_report_cell_count := count_expected_cell_count \+ expected_accuracy_cell_count/u);
  assert.match(migration, /count_cell_count<>count_expected_cell_count/u);
  assert.match(migration, /accuracy_cell_count<>expected_accuracy_cell_count/u);
  assert.match(migration, /tokenless_dsa_part8_report_cells_calculation_unique/u);
});

test("0174 replays accuracy values from the frozen sample instead of accepting caller estimates", () => {
  assert.match(migration, /tokenless_dsa_part8_authoritative_accuracy_value\(/u);
  assert.match(migration, /cell\.value<>authoritative\.value/u);
  assert.match(migration, /tokenless_dsa_classifier_inventory_entries inventory_entry/u);
  assert.match(service, /dsaPart8AccuracyRowMatchesAuthoritativeValue/u);
  assert.match(service, /"dsa_part8_accuracy_binding_invalid"/u);
});

test("0174 rejects formulas, private IDs, and every publication evidence gap", () => {
  assert.match(migration, /NOT \("service" ~ '\^\[\[:space:\]\]\*\[=\+@-\]'\)/u);
  assert.match(migration, /provider\[_ \]\?decision/u);
  assert.match(migration, /publication_gap_cell_count <> 0/u);
  assert.match(migration, /cell\.value='' OR cell\.context_json::jsonb \? 'gap'/u);
  assert.match(service, /Method acceptance cannot make an evidence-gap row publishable/u);
});

test("0174 publishes only an accepted Section 1.6 version through exact audit and attestation evidence", () => {
  assert.match(migration, /artifact_designation" = 'section_1_6_draft_only'[\s\S]*publication_eligible" = false/u);
  assert.match(migration, /report\.artifact_designation='section_1_6_method_accepted'/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "audit_event_id", "audit_head_digest"\)[\s\S]*REFERENCES "tokenless_audit_events"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest"\)/u,
  );
  const append = service.indexOf("const audit = await appendAuditEvent");
  const enqueue = service.indexOf("const attestation = await enqueueAssuranceAttestationInTransaction");
  const insert = service.indexOf("INSERT INTO tokenless_dsa_part8_report_publications");
  assert.ok(append >= 0 && append < enqueue && enqueue < insert);
  assert.match(migration, /"retain_until" >= "published_at" \+ interval '5 years'/u);
  assert.match(migration, /"public_path" !~\* 'latest'/u);
  assert.doesNotMatch(service, /\/latest/u);
  assert.match(migration, /"complete_transparency_report" = false/u);
});

test("0174 makes every new evidence relation append-only and restrictive", () => {
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
  for (const table of [
    "tokenless_dsa_part8_external_method_evidence",
    "tokenless_dsa_part8_report_versions",
    "tokenless_dsa_part8_report_cells",
    "tokenless_dsa_part8_report_files",
    "tokenless_dsa_part8_report_publications",
  ]) {
    assert.match(migration, new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`, "u"), table);
  }
  assert.match(migration, /tokenless_dsa_part8_report_cells_insert_guard/u);
  assert.match(migration, /tokenless_dsa_part8_report_files_insert_guard/u);
});
