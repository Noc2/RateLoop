import {
  TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_SQL_PATTERN_SOURCE,
  normalizeCompleteTokenlessDeploymentKey,
} from "../tokenless/deploymentKey";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0177_network_benchmark_activation.sql", import.meta.url), "utf8");
const hardening = readFileSync(
  new URL("../../drizzle/0183_network_benchmark_activation_v2.sql", import.meta.url),
  "utf8",
);
const deploymentKeyHardening = readFileSync(
  new URL("../../drizzle/0188_network_benchmark_deployment_key.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("../tokenless/networkBenchmarkActivation.ts", import.meta.url), "utf8");
const assignmentService = readFileSync(new URL("../tokenless/audienceAssignments.ts", import.meta.url), "utf8");
const residencePolicy = readFileSync(new URL("../tokenless/publicNetworkLegalResidence.ts", import.meta.url), "utf8");
const publicNetworkReachability = readFileSync(
  new URL("../tokenless/publicNetworkReviewReachability.ts", import.meta.url),
  "utf8",
);

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

test("the concrete service verifies an active workspace-manager reference and uses serializable database time", () => {
  assert.match(service, /BEGIN ISOLATION LEVEL SERIALIZABLE/u);
  assert.match(service, /SELECT transaction_timestamp\(\) AS transaction_time/u);
  assert.match(migration, /date_trunc\('milliseconds', transaction_timestamp\(\)\)/u);
  assert.match(service, /\["owner", "admin"\]/u);
  assert.match(service, /p\.status AS project_status/u);
  assert.match(service, /createNetworkBenchmarkActivationService/u);
  assert.match(service, /tokenless_require_active_network_benchmark_for_run/u);
});

test("0183 requires a closed window, distinct method reviewer, demand, and worker protections", () => {
  assert.match(hardening, /completed_at" BETWEEN "evidence_window_start" AND "evidence_window_end/u);
  assert.match(hardening, /evidence_window_end" <= "recorded_at/u);
  assert.match(hardening, /evidence_window_end" <= "activated_at/u);
  assert.match(hardening, /network_supply_demand_confirmation/u);
  assert.match(
    hardening,
    /COUNT\(DISTINCT e\."counterparty_reference_hash"\)[\s\S]*network_supply_demand_confirmation/u,
  );
  assert.match(hardening, /demand_count < 2/u);
  assert.match(hardening, /audit_count <> 1/u);
  assert.match(
    hardening,
    /commercial_binding\."evidence_type" IN \([\s\S]*'provider_pilot_acceptance','network_supply_demand_confirmation'/u,
  );
  assert.match(hardening, /algorithmic_management_human_review_readiness/u);
  assert.match(hardening, /private_worker_communication_readiness/u);
  assert.match(hardening, /hosted_paid_core_testnet_exercise/u);
  assert.doesNotMatch(hardening, /hosted_end_to_end_exercise/u);
  assert.match(hardening, /algorithmic_human_review_readiness_count < 1/u);
  assert.match(hardening, /private_worker_communication_readiness_count < 1/u);
  assert.match(service, /demandCounterparties\.size < 2/u);
  assert.match(service, /auditCounterparties\.size !== 1/u);
});

test("0183 and 0188 can authorize only the active complete Base Sepolia benchmark deployment", () => {
  assert.match(hardening, /\^tokenless-v4:84532:/u);
  assert.match(hardening, /"activation_scope" = 'testnet_network_benchmark_exercise'/u);
  assert.match(service, /NETWORK_BENCHMARK_ACTIVATION_SCOPE = "testnet_network_benchmark_exercise"/u);
  assert.match(service, /normalizeCompleteTokenlessDeploymentKey/u);
  assert.match(service, /must match the active tokenless deployment/u);
  assert.doesNotMatch(hardening, /'live_marketplace_release'/u);

  const activeKey =
    "tokenless-v4:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333:0x4444444444444444444444444444444444444444";
  assert.ok(deploymentKeyHardening.includes(`~ '${TOKENLESS_V4_BASE_SEPOLIA_DEPLOYMENT_KEY_SQL_PATTERN_SOURCE}'`));
  assert.equal(
    (deploymentKeyHardening.match(/tokenless_is_complete_v4_base_sepolia_deployment_key\("deployment_key"\)/gu) ?? [])
      .length,
    6,
  );
  assert.equal(normalizeCompleteTokenlessDeploymentKey(activeKey), activeKey);
  for (const invalid of [
    "tokenless-v4:84532:any-text",
    `${activeKey}:extra`,
    activeKey.replace("0x1111111111111111111111111111111111111111", "0x0000000000000000000000000000000000000000"),
  ]) {
    assert.equal(normalizeCompleteTokenlessDeploymentKey(invalid), null, invalid);
  }
});

test("activation evidence opportunities and acceptance share one exact worker-jurisdiction boundary", () => {
  assert.equal((hardening.match(/'permittedWorkerJurisdictions'/gu) ?? []).length, 3);
  assert.equal((hardening.match(/'permittedWorkerJurisdictionsHash'/gu) ?? []).length, 3);
  assert.match(hardening, /tokenless_is_permitted_network_worker_jurisdiction_set/u);
  assert.match(hardening, /permitted_worker_jurisdictions_json"::jsonb \? p_residence_country/u);
  assert.match(hardening, /tokenless_require_network_benchmark_assignment_acceptance/u);
  assert.match(
    hardening,
    /BEFORE INSERT OR UPDATE ON "tokenless_assurance_assignments"[\s\S]*tokenless_guard_network_benchmark_assignment_reservation/u,
  );
  assert.match(assignmentService, /requireActiveNetworkBenchmarkAssignmentAcceptance/u);
  assert.match(assignmentService, /publicNetworkLegalResidence\.countryCode !== frozenResidence\.countryCode/u);

  const sqlCountries = [...hardening.matchAll(/'([A-Z]{2})'/gu)]
    .map(match => match[1]!)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const policyArray = residencePolicy.match(/const EEA_COUNTRY_CODES = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
  const policyCountries = [...policyArray.matchAll(/"([A-Z]{2})"/gu)].map(match => match[1]!).sort();
  assert.deepEqual(sqlCountries, policyCountries);
});

test("0183 binds v2 evidence to the operator and an explicitly non-participating manager reference", () => {
  for (const schemaVersion of [
    "rateloop.network-benchmark-activation-evidence.v2",
    "rateloop.network-benchmark-opportunity-authorization.v2",
    "rateloop.network-benchmark-activation.v2",
    "rateloop.network-benchmark-activation-deactivation.v2",
  ]) {
    assert.match(hardening, new RegExp(schemaVersion.replaceAll(".", "\\."), "u"));
  }
  assert.match(hardening, /compliance_operator_key_version/u);
  assert.match(hardening, /workspace_manager_reference_principal_id/u);
  assert.doesNotMatch(hardening, /authorized_manager_principal_id/u);
  assert.match(hardening, /tokenless_compliance_operator:/u);
  assert.match(hardening, /IS JSON OBJECT WITH UNIQUE KEYS/u);
  assert.equal((hardening.match(/::jsonb = jsonb_build_object\(/gu) ?? []).length, 4);
  assert.match(
    hardening,
    /provenance_evidence\."compliance_operator_key_version"[\s\S]*activation_record\."compliance_operator_key_version"/u,
  );
  assert.match(
    hardening,
    /provenance_authorization\."workspace_manager_reference_principal_id"[\s\S]*activation_record\."workspace_manager_reference_principal_id"/u,
  );
  assert.match(
    hardening,
    /"workspace_manager_reference_principal_id"=NEW\."workspace_manager_reference_principal_id"/u,
  );
  assert.match(service, /attestedBy: `tokenless_compliance_operator:\$\{complianceOperatorKeyVersion\}`/u);
  assert.doesNotMatch(service, /schemaVersion: "rateloop\.network-benchmark-activation\.v1"/u);
});

test("all network activation consumers share the public-material project boundary", () => {
  assert.match(hardening, /JOIN "tokenless_workspaces" w[\s\S]*w\."status"='active'/u);
  assert.match(hardening, /JOIN "tokenless_assurance_projects" p[\s\S]*p\."status"='active'/u);
  assert.equal((hardening.match(/p\."visibility"='public'/gu) ?? []).length, 2);
  assert.equal((hardening.match(/p\."data_classification"='public'/gu) ?? []).length, 2);
  assert.equal((hardening.match(/p\."material_kind" IN \('public','synthetic','redacted'\)/gu) ?? []).length, 2);
  assert.equal((hardening.match(/FOR SHARE OF a,w,p/gu) ?? []).length, 2);
  assert.equal((hardening.match(/profile\."audience"='public_network'/gu) ?? []).length, 3);
  assert.equal((hardening.match(/profile\."content_boundary"='public_or_test'/gu) ?? []).length, 3);
  assert.equal((hardening.match(/profile\."compensation_mode"='usdc'/gu) ?? []).length, 3);
  assert.equal((hardening.match(/profile\."configuration_status"='ready'/gu) ?? []).length, 3);
  assert.equal((hardening.match(/profile\."superseded_at" IS NULL/gu) ?? []).length, 3);
  assert.match(service, /rowString\(row, "project_visibility"\) !== "public"/u);
  assert.match(service, /rowString\(row, "project_data_classification"\) !== "public"/u);
  assert.match(service, /\["public", "synthetic", "redacted"\]\.includes/u);
  assert.match(publicNetworkReachability, /p\.visibility='public'/u);
  assert.match(publicNetworkReachability, /p\.data_classification='public'/u);
  assert.match(publicNetworkReachability, /p\.material_kind=\?/u);
  assert.doesNotMatch(
    service.slice(service.indexOf("async deactivate"), service.indexOf("return { ...artifact, deactivationHash }")),
    /requireWorkspaceManagerReference/u,
  );
});

test("the activation preflight binds the exact ready public-network request profile", () => {
  assert.match(service, /JOIN tokenless_agent_review_request_profiles profile/u);
  assert.match(service, /profile\.profile_id=opportunity\.request_profile_id/u);
  assert.match(service, /profile\.version=opportunity\.request_profile_version/u);
  assert.match(service, /profile\.profile_hash=opportunity\.request_profile_hash/u);
  assert.match(service, /profile\.audience='public_network'/u);
  assert.match(service, /profile\.content_boundary='public_or_test'/u);
  assert.match(service, /profile\.compensation_mode='usdc'/u);
  assert.match(service, /profile\.configuration_status='ready'/u);
  assert.match(service, /profile\.superseded_at IS NULL/u);
});
