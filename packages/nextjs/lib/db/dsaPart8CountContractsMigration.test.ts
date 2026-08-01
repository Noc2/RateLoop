import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0172_dsa_part8_count_contracts.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../tokenless/dsaPart8CountContracts.ts", import.meta.url), "utf8");

test("0172 binds the exact frozen population, reconciliation, and classifier inventory", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_count_contracts"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "population_id", "population_version", "reconciliation_version"\)/u,
  );
  assert.match(migration, /FOREIGN KEY \("workspace_id", "inventory_id", "inventory_root", "inventory_digest"\)/u);
  assert.match(migration, /population\.frozen_root=NEW\.population_root/u);
  assert.match(migration, /reconciliation\.reconciliation_hash=NEW\.reconciliation_hash/u);
  assert.match(migration, /inventory\.inventory_digest=NEW\.inventory_digest/u);
  assert.match(migration, /population_frozen_at" <= "source_frozen_at/u);
  assert.match(migration, /"source_frozen_at" <= "committed_at/u);
});

test("0172 keeps four exact roots and makes no-action decisions distinct from measures", () => {
  for (const root of [
    "decision_projection_root",
    "measure_projection_root",
    "evaluation_projection_root",
    "notice_projection_root",
  ]) {
    assert.match(migration, new RegExp(`"${root}" text NOT NULL`, "u"), root);
  }
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_count_decision_projections"/u);
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_count_measure_projections"/u);
  assert.match(migration, /AND measure_taken=true/u);
  assert.match(migration, /Part 8 measure projection is not the exact taken-measure subset/u);
  assert.match(migration, /expected_measure_count" BETWEEN 0 AND "expected_decision_count/u);
});

test("0172 rejects canonical-audit, engagement, and cross-decision evaluation substitution", () => {
  assert.match(migration, /UNIQUE \("workspace_id", "event_id", "event_digest"\)/u);
  assert.match(migration, /FOREIGN KEY \("workspace_id", "audit_event_id", "audit_head_digest"\)/u);
  assert.match(migration, /REFERENCES "tokenless_audit_events" \("workspace_id", "event_id", "event_digest"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "attestation_job_id", "attestation_artifact_kind", "audit_head_digest"\)/u,
  );
  assert.match(migration, /"attestation_artifact_kind" = 'audit_export_head'/u);
  assert.match(migration, /"attestation_requirement" = 'enqueued_audit_export_head'/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "population_id", "population_version", "provider_decision_id",\s*"decision_version", "engagement_id", "engagement_version"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "contract_id", "population_id", "population_version"\)[\s\S]*REFERENCES "tokenless_dsa_part8_count_contracts"[\s\S]*\("workspace_id", "contract_id", "population_id", "population_version"\)/u,
  );
  assert.match(
    migration,
    /REFERENCES "tokenless_dsa_engagement_versions"[\s\S]*"engagement_version"\) ON DELETE RESTRICT/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "contract_id", "source_decision_binding", "provider_decision_id", "decision_version"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "provider_decision_id", "decision_version", "evaluation_id"\)/u,
  );
  assert.match(migration, /REFERENCES "tokenless_dsa_automated_means_evaluations"/u);
});

test("0172 persists the exact official count-cell universe and typed notice gaps", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_part8_count_cells"/u);
  assert.match(migration, /PRIMARY KEY \("workspace_id", "contract_id", "indicator", "scope"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "contract_id", "indicator", "scope", "cell_hash"\)/u);
  assert.match(migration, /"result_kind"='count'[\s\S]*"result_kind"='coverage_gap'/u);
  assert.match(migration, /"gap_code"='incomplete_notice_processing'/u);
  assert.match(migration, /expected_cell_count := CASE NEW\.provider_type/u);
  assert.match(migration, /WHEN 'intermediary_service' THEN 4/u);
  assert.match(migration, /WHEN 'online_platform' THEN 8 WHEN 'vlop' THEN 56/u);
  assert.match(migration, /Part 8 count-cell universe is incomplete/u);
  assert.match(migration, /notice count cell does not preserve its typed completeness state/u);
  assert.match(migration, /tokenless_dsa_part8_count_cells_append_only/u);
});

test("0172 defers completeness and constructs the audit witness in the same repeatable-read transaction", () => {
  assert.match(migration, /CREATE CONSTRAINT TRIGGER tokenless_dsa_part8_count_contract_complete_at_commit/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  for (const table of [
    "tokenless_dsa_part8_count_contracts",
    "tokenless_dsa_part8_count_decision_projections",
    "tokenless_dsa_part8_count_measure_projections",
    "tokenless_dsa_part8_count_evaluation_projections",
    "tokenless_dsa_part8_count_notice_projections",
    "tokenless_dsa_part8_count_results",
    "tokenless_dsa_part8_count_cells",
  ])
    assert.match(migration, new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`, "u"), table);
  assert.match(service, /BEGIN ISOLATION LEVEL REPEATABLE READ/u);
  const sourceClock = service.indexOf("const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client)");
  const decisionRead = service.indexOf("const decisionRows = await client.query");
  const commitClock = service.indexOf("const committedAt = await dsaEvidenceCommitTimestamp(client)");
  const facade = service.indexOf("const bundle = await commitCountPersistenceFacade", commitClock);
  const audit = service.indexOf("const audit = await dependencies.appendAudit");
  const attestation = service.indexOf("const attestation = await dependencies.enqueueAttestation");
  const persist = service.indexOf("await dependencies.persist");
  assert.ok(sourceClock >= 0 && sourceClock < decisionRead && decisionRead < commitClock);
  assert.ok(commitClock < facade);
  assert.ok(audit >= 0 && audit < attestation && attestation < persist);
  assert.match(service, /buildDsaPart8CountWitness\(\{[\s\S]*sourceFrozenAt: input\.sourceFrozenAt/u);
  assert.match(service, /artifactDigest: audit\.eventDigest/u);
});

test("0172 selects exactly the latest v3 notice fact at the frozen source clock", () => {
  assert.match(service, /SELECT DISTINCT ON \(notice_id\) fact_json,fact_hash/u);
  assert.match(service, /created_at <= \$5/u);
  assert.match(service, /ORDER BY notice_id,fact_version DESC/u);
  assert.match(service, /DSA_PART8_NOTICE_PROCESSING_FACT_SCHEMA_VERSION/u);
  assert.match(migration, /projection\.fact_version <> \(SELECT max\(latest\.fact_version\)/u);
});
