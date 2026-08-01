import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0177_network_benchmark_activation.sql", import.meta.url), "utf8");
const service = readFileSync(new URL("../tokenless/networkBenchmarkActivation.ts", import.meta.url), "utf8");

test("0177 is an execution activation distinct from 0176 research-export authority", () => {
  assert.match(migration, /CREATE TABLE "tokenless_network_benchmark_activations"/u);
  assert.match(migration, /exact_public_safe_benchmark_network_execution/u);
  assert.match(migration, /"unrelated_opportunity_authority" = 'none'/u);
  assert.doesNotMatch(migration, /ALTER TABLE "tokenless_benchmark_activations"/u);
  assert.doesNotMatch(migration, /contractual_public_safe_benchmark_research/u);
  assert.doesNotMatch(migration, /article.?40/iu);
});

test("0177 requires accepted method and pilot evidence plus hosted keeper and indexer exercises", () => {
  for (const evidenceType of [
    "audit_partner_method_acceptance",
    "provider_pilot_acceptance",
    "hosted_end_to_end_exercise",
    "keeper_recovery_exercise",
    "indexer_recovery_exercise",
    "paid_eligibility_payout_tax_dac7_readiness",
    "sanctions_screening_readiness",
    "reviewer_contract_worker_information_appeal_readiness",
    "worker_data_privacy_governance_readiness",
  ]) {
    assert.match(migration, new RegExp(`'${evidenceType}'`, "u"));
  }
  assert.match(migration, /provider_count < 2/u);
  assert.match(migration, /paid_readiness_count < 1/u);
  assert.match(migration, /sanctions_readiness_count < 1/u);
  assert.match(migration, /worker_contract_readiness_count < 1/u);
  assert.match(migration, /worker_privacy_readiness_count < 1/u);
  assert.match(migration, /COUNT\(DISTINCT e\."counterparty_reference_hash"\)/u);
  assert.match(migration, /network benchmark activation evidence is incomplete or unrelated/u);
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
});

test("0177 binds exact opportunities and fails closed at publication round binding and reservation", () => {
  assert.match(migration, /tokenless_agent_review_opportunities_network_activation_exact_unique/u);
  assert.match(migration, /UNIQUE \("workspace_id", "opportunity_id"\)/u);
  assert.match(
    migration,
    /AFTER INSERT ON "tokenless_public_network_review_bindings"[\s\S]*?tokenless_bind_network_benchmark_publication/u,
  );
  assert.match(migration, /tokenless_guard_network_benchmark_round_binding/u);
  assert.match(
    migration,
    /BEFORE INSERT ON "tokenless_assurance_assignments"[\s\S]*?tokenless_guard_network_benchmark_assignment_reservation/u,
  );
  assert.match(migration, /transaction_timestamp\(\) < a\."authorization_expires_at"/u);
  assert.match(migration, /tokenless_network_benchmark_activation_deactivations/u);
});

test("activation evidence deactivation supersession authorization and execution bindings are append-only", () => {
  for (const table of [
    "tokenless_network_benchmark_activation_evidence",
    "tokenless_network_benchmark_activations",
    "tokenless_network_benchmark_activation_evidence_bindings",
    "tokenless_network_benchmark_opportunity_authorizations",
    "tokenless_network_benchmark_activation_deactivations",
    "tokenless_network_benchmark_execution_bindings",
  ]) {
    assert.match(migration, new RegExp(`${table}.*append_only`, "u"));
  }
  assert.match(migration, /"reason" IN \('manual_deactivation','release_gate_failure','superseded'\)/u);
  assert.match(migration, /supersession must preserve the exact project and benchmark/u);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
});

test("the concrete service uses manager authorization database time and serializable activation", () => {
  assert.match(service, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.match(service, /SELECT transaction_timestamp\(\) AS transaction_time/u);
  assert.match(migration, /date_trunc\('milliseconds', transaction_timestamp\(\)\)/u);
  assert.match(service, /\["owner", "admin"\]/u);
  assert.match(service, /p\.status AS project_status/u);
  assert.match(service, /createNetworkBenchmarkActivationService/u);
  assert.match(service, /tokenless_require_active_network_benchmark_for_run/u);
});
