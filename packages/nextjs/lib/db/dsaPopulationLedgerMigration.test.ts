import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0168_dsa_population_ledger.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0168 persists a versioned population contract, raw decisions, engagements, pages, and reconciliation", () => {
  for (const table of [
    "tokenless_dsa_population_versions",
    "tokenless_dsa_source_decision_versions",
    "tokenless_dsa_source_engagement_versions",
    "tokenless_dsa_engagement_versions",
    "tokenless_dsa_population_ingest_pages",
    "tokenless_dsa_population_reconciliation_versions",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"), table);
  }
  assert.match(migration, /"declared_source_totals_json" text NOT NULL/u);
  assert.match(migration, /"declared_partition_totals_json" text NOT NULL/u);
  assert.match(migration, /"declared_contract_hash" text NOT NULL/u);
  assert.match(migration, /"declared_source_manifest_root" text NOT NULL/u);
  assert.match(migration, /"frozen_root" text/u);
  assert.match(migration, /UNIQUE \("workspace_id", "population_id", "population_version", "provider_decision_id"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "population_id", "population_version", "idempotency_key_hash"\)/u);
  assert.match(migration, /rateloop\.dsa-population-reconciliation\.v1/u);
  assert.match(migration, /"transparency_payload_version" integer/u);
  assert.match(migration, /tokenless_dsa_engagement_versions_payload_fk/u);
  assert.match(migration, /tokenless_dsa_engagement_versions_engagement_unique/u);
  assert.match(migration, /UNIQUE \("workspace_id", "population_id", "population_version", "engagement_id"\)/u);
  assert.match(migration, /tokenless_dsa_population_versions_controlled_transition/u);
  assert.match(migration, /OLD\.status = 'ingesting'/u);
  assert.doesNotMatch(migration, /ON DELETE RESTRICT/u);
});

test("0168 separates versioned Commission payloads, attempts, receipts, and the private crosswalk", () => {
  for (const table of [
    "tokenless_dsa_transparency_payload_versions",
    "tokenless_dsa_transparency_private_crosswalks",
    "tokenless_dsa_transparency_delivery_attempts",
    "tokenless_dsa_transparency_receipt_versions",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"), table);
  }
  assert.match(migration, /dsa-transparency-database-api-v2-2025-07-01/u);
  assert.match(migration, /"puid" ~ '\^\[A-Za-z0-9_-\]\{1,500\}\$'/u);
  assert.match(migration, /'unknown_pending_puid_lookup'/u);
  assert.match(migration, /'puid_absent_retry_allowed'/u);
  assert.match(migration, /'puid_exists_verified'/u);
  assert.match(migration, /"receipt_json" text NOT NULL/u);
  assert.match(migration, /"receipt_hash" text NOT NULL/u);
  assert.match(migration, /'verified_puid_lookup_302'/u);
  assert.match(migration, /tokenless_dsa_transparency_payload_versions_scope_puid_unique/u);
  assert.match(migration, /tokenless_dsa_transparency_delivery_attempts_scope_unique/u);
  assert.match(
    migration,
    /FOREIGN KEY \("attempt_id", "workspace_id", "provider_decision_id", "decision_version", "payload_version"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "provider_decision_id", "decision_version", "payload_version", "puid"\)/u,
  );
  assert.match(migration, /DSA population and Transparency Database evidence is append-only/u);
});

test("0168 encodes the Article 17 applicability subset and follows 0167", () => {
  for (const value of [
    "required",
    "no_recipient_electronic_contact",
    "deceptive_high_volume_commercial_content",
    "article_9_order",
    "service_not_online_platform",
    "restriction_outside_article_17",
    "other_documented_exclusion",
  ]) {
    assert.match(migration, new RegExp(`'${value}'`, "u"), value);
  }
  assert.match(migration, /"sor_applicability" = 'required' AND "non_required_basis" IS NULL/u);
  assert.match(migration, /"sor_applicability" <> 'required' AND "non_required_basis" = "sor_applicability"/u);
  assert.deepEqual(
    journal.entries.slice(-2).map(entry => ({ idx: entry.idx, tag: entry.tag })),
    [
      { idx: 167, tag: "0167_reviewer_engagement_events" },
      { idx: 168, tag: "0168_dsa_population_ledger" },
    ],
  );
});
