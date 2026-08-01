import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0171_dsa_part8_inventory_and_notices.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("../tokenless/dsaPart8InventoryAndNotices.ts", import.meta.url), "utf8");

test("0171 freezes one complete classifier inventory for each population and service", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_classifier_inventories"/u);
  assert.match(migration, /CREATE TABLE "tokenless_dsa_classifier_inventory_entries"/u);
  assert.match(migration, /UNIQUE \("workspace_id", "population_id", "population_version", "service_id"\)/u);
  assert.match(migration, /"expected_system_count" BETWEEN 0 AND 64/u);
  assert.match(migration, /"source_frozen_at" <= "frozen_at"/u);
  assert.match(migration, /population_frozen_at timestamp with time zone/u);
  assert.match(migration, /source_engagement\.engagement_json::jsonb ->> 'service' = NEW\.service_id/u);
  assert.match(migration, /source_engagement\.created_at <= NEW\.source_frozen_at/u);
  assert.match(migration, /evaluation\.created_at <= NEW\.source_frozen_at/u);
  assert.doesNotMatch(migration, /scoped_decision_count/u);
  assert.match(migration, /entry_count <> NEW\.expected_system_count/u);
  assert.match(migration, /missing_or_conflicting_system_count <> 0/u);
  assert.match(migration, /incorrect_observation_count <> 0/u);
  assert.match(migration, /CREATE CONSTRAINT TRIGGER tokenless_dsa_classifier_inventory_complete_at_commit/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
});

test("0171 preserves declared zero-observation systems and rejects formula-capable designations", () => {
  assert.match(migration, /"observation_state" = 'observed'[\s\S]*"observed_evaluation_count" > 0/u);
  assert.match(
    migration,
    /"observation_state" = 'unobserved'[\s\S]*"observed_evaluation_count" = 0[\s\S]*"gap_code" = 'zero_observations'/u,
  );
  assert.match(migration, /NOT \("public_designation" ~ '\[\[:cntrl:\]\]'\)/u);
  assert.match(migration, /NOT \("public_designation" ~ '\^\[=\+@-\]'\)/u);
  assert.match(
    migration,
    /UNIQUE INDEX "tokenless_dsa_classifier_inventory_entries_designation_unique"[\s\S]*lower\("public_designation"\)/u,
  );
  assert.match(migration, /tokenless_dsa_classifier_inventory_entry_insert_guard/u);
  assert.match(migration, /existing_count >= expected_count/u);
});

test("0171 records append-only, versioned notice-processing facts with exact state", () => {
  assert.match(migration, /CREATE TABLE "tokenless_dsa_notice_processing_fact_versions"/u);
  assert.match(migration, /"schema_version" = 'rateloop\.dsa-part8-notice-processing-fact\.v3'/u);
  assert.match(
    migration,
    /"processing_status" = 'processed_final'[\s\S]*"automation_processing" IN \('solely_automated', 'partially_automated', 'not_automated'\)/u,
  );
  assert.match(migration, /"processing_status" = 'processing_incomplete' AND "automation_processing" IS NULL/u);
  assert.match(migration, /"received_at" <= "created_at"/u);
  assert.match(migration, /"supersedes_fact_version" = "fact_version" - 1/u);
  assert.match(migration, /char_length\(btrim\("correction_reason"\)\) BETWEEN 1 AND 500/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "notice_id", "supersedes_fact_version", "service_id", "received_at",[\s\S]*"source_notice_binding", "notifier_class"\)[\s\S]*REFERENCES "tokenless_dsa_notice_processing_fact_versions"/u,
  );
});

test("0171 uses restrictive foreign keys and makes every evidence relation append-only", () => {
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
  assert.equal((migration.match(/ON DELETE RESTRICT/gu) ?? []).length, 4);
  for (const table of [
    "tokenless_dsa_classifier_inventories",
    "tokenless_dsa_classifier_inventory_entries",
    "tokenless_dsa_notice_processing_fact_versions",
  ]) {
    assert.match(migration, new RegExp(`BEFORE UPDATE OR DELETE ON "${table}"`, "u"), table);
  }
});

test("0171 service takes both evidence clocks from Postgres inside repeatable-read transactions", () => {
  assert.match(service, /BEGIN ISOLATION LEVEL REPEATABLE READ/u);
  assert.match(service, /dsaEvidenceTransactionTimestamp\(client\)/u);
  assert.match(service, /dsaEvidenceCommitTimestamp\(client\)/u);
  assert.match(service, /source_engagement\.created_at<=\$5 AND evaluation\.created_at<=\$5/u);
  const sourceClock = service.indexOf("const sourceFrozenAt = await dsaEvidenceTransactionTimestamp(client)");
  const observationRead = service.indexOf("const observedResult = await client.query");
  const commitClock = service.indexOf("const frozenAt = await dsaEvidenceCommitTimestamp(client)");
  const inventoryInsert = service.indexOf("INSERT INTO tokenless_dsa_classifier_inventories");
  assert.ok(sourceClock >= 0 && sourceClock < observationRead);
  assert.ok(observationRead < commitClock && commitClock < inventoryInsert);
  const noticeClock = service.indexOf(
    "const createdAt = await dsaEvidenceTransactionTimestamp(client)",
    sourceClock + 1,
  );
  const noticeInsert = service.indexOf("INSERT INTO tokenless_dsa_notice_processing_fact_versions");
  assert.ok(noticeClock > commitClock && noticeClock < noticeInsert);
});
