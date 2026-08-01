import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0180_dsa_derivation_consumer_safety.sql", import.meta.url),
  "utf8",
);
const reports = readFileSync(new URL("../tokenless/dsaPart8ReportVersions.ts", import.meta.url), "utf8");
const grants = readFileSync(new URL("../tokenless/benchmarkResearchGrants.ts", import.meta.url), "utf8");
const persistence = readFileSync(new URL("../tokenless/benchmarkResearchPersistence.ts", import.meta.url), "utf8");

test("0180 rejects network-derived reference labels from Part 8 inferential accuracy", () => {
  assert.match(migration, /refuses an existing Part 8 report derived from non-independent labels/u);
  assert.match(migration, /tokenless_guard_dsa_part8_independent_reference_panel/u);
  assert.match(migration, /stored_derivation_source IS DISTINCT FROM 'independent_reference_panel'/u);
  assert.match(
    migration,
    /BEFORE INSERT ON "tokenless_dsa_part8_report_versions"[\s\S]*tokenless_guard_dsa_part8_independent_reference_panel/u,
  );
  assert.match(reports, /labels\.derivation_source='independent_reference_panel'/u);
});

test("0180 binds every approved export to the exact derivation and bridge with foreign keys", () => {
  assert.match(migration, /tokenless_benchmark_research_exports_derivation_fk/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id","label_set_id","reference_network_bridge_hash"\)[\s\S]*REFERENCES "tokenless_dsa_reference_network_label_set_bridges"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id","label_set_id","reference_named_panel_bridge_hash"\)[\s\S]*REFERENCES "tokenless_dsa_named_panel_label_set_bridges"/u,
  );
  assert.match(migration, /"reference_network_bridge_hash"="reference_bridge_hash"/u);
  assert.match(migration, /"reference_named_panel_bridge_hash"="reference_bridge_hash"/u);
  assert.match(persistence, /LEFT JOIN tokenless_dsa_reference_network_label_set_bridges/u);
  assert.match(persistence, /LEFT JOIN tokenless_dsa_named_panel_label_set_bridges/u);
});

test("0180 makes network research descriptive, non-population, non-operational, and non-adaptive", () => {
  assert.match(migration, /"reference_reporting_mode"='descriptive_panel_vs_network_only'/u);
  assert.match(migration, /"reference_population_claim"=false/u);
  assert.match(migration, /"reference_operational_rollup_eligible"=false/u);
  assert.match(migration, /"reference_adaptive_reuse_allowed"=false/u);
  assert.match(
    grants,
    /reportingMode: "independent_reference_panel_research_only" \| "descriptive_panel_vs_network_only"/u,
  );
});

test("0180 stores and replays an exact reference-provenance disclosure", () => {
  assert.match(migration, /legacy exports have no exact derivation bridge and cannot be backfilled safely/u);
  assert.match(migration, /"reference_provenance_hash"='sha256:' \|\|/u);
  assert.match(migration, /"reference_provenance_json" IS JSON OBJECT WITH UNIQUE KEYS/u);
  assert.match(migration, /"reference_provenance_json"::jsonb=jsonb_build_object\(/u);
  assert.match(grants, /"referenceProvenance",\s*"disclosure"/u);
  assert.match(grants, /referenceProvenance: input\.source\.referenceProvenance/u);
  assert.match(persistence, /reference_provenance_json/u);
  assert.match(persistence, /source\.referenceProvenance\.derivationSource === "rateloop_network"/u);
});
