import type { DatabaseClient, DatabaseResources, QueryInput } from "../index";
import * as schema from "../schema";
import { drizzle as drizzlePgProxy } from "drizzle-orm/pg-proxy";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type Pool } from "pg";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const patchedMemoryPgQueryTargets = new WeakSet<object>();

function normalizeQuery(input: QueryInput) {
  const text = typeof input === "string" ? input : input.sql;
  const values = typeof input === "string" ? [] : (input.args ?? []);

  let placeholderIndex = 0;
  const parameterizedText = values.length > 0 ? text.replace(/\?/g, () => `$${++placeholderIndex}`) : text;
  // pg-mem supports row locks but not PostgreSQL's joined-table lock target
  // syntax. Service tests still exercise the transaction and real-PostgreSQL
  // invariants pin the exact `FOR UPDATE OF ...` clauses.
  const memoryCompatibleText = memoryCompatibleLockTargets(parameterizedText);

  return {
    text: memoryCompatibleText,
    values,
  };
}

function memoryCompatibleLockTargets(text: string) {
  return text
    .replace(/date_trunc\('milliseconds',\s*transaction_timestamp\(\)\)/giu, "CURRENT_TIMESTAMP")
    .replace(/FOR (UPDATE|SHARE) OF [a-z_][a-z0-9_,]*/giu, (_clause, strength: string) => `FOR ${strength}`)
    .replace(/FOR UPDATE\s+FOR SHARE/giu, "FOR UPDATE");
}

function patchMemoryPgQueries<T extends { query: (...args: unknown[]) => unknown }>(target: T) {
  if (patchedMemoryPgQueryTargets.has(target)) return target;
  patchedMemoryPgQueryTargets.add(target);
  const query = target.query.bind(target);
  target.query = ((input: unknown, ...rest: unknown[]) => {
    if (typeof input === "string") return query(memoryCompatibleLockTargets(input), ...rest);
    if (input && typeof input === "object" && "text" in input && typeof input.text === "string") {
      return query({ ...input, text: memoryCompatibleLockTargets(input.text) }, ...rest);
    }
    return query(input, ...rest);
  }) as T["query"];
  return target;
}

function getMigrationDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../drizzle");
}

export function readJournalMigrationFiles(migrationDirectory: string): string[] {
  const journalPath = path.join(migrationDirectory, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Drizzle journal is missing at ${journalPath}.`);
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries?: Array<{ tag?: unknown }>;
  };
  if (!Array.isArray(journal.entries)) {
    throw new Error(`Drizzle journal at ${journalPath} declares no migration entries.`);
  }

  return journal.entries.map(entry => {
    if (typeof entry.tag !== "string" || entry.tag.length === 0) {
      throw new Error(`Drizzle journal at ${journalPath} has an entry without a tag.`);
    }
    const file = `${entry.tag}.sql`;
    if (!fs.existsSync(path.join(migrationDirectory, file))) {
      throw new Error(`Drizzle journal declares ${file}, but that migration file does not exist.`);
    }
    return file;
  });
}

function applySqlStatements(sqlText: string, execute: (statement: string) => void) {
  for (const statement of sqlText
    .split(MIGRATION_BREAKPOINT)
    .map(part => part.trim())
    .filter(Boolean)) {
    execute(statement);
  }
}

function memoryCompatibleMigrationStatement(file: string, statement: string): string | null {
  if (
    file === "0188_network_benchmark_deployment_key.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_[^"]+"[\s\S]*ADD CONSTRAINT[\s\S]*NOT VALID;?$/u.test(statement)
  ) {
    // PostgreSQL adds the checks without blocking writes and validates them in
    // the following statement. pg-mem cannot parse NOT VALID, so install the
    // same final validated check immediately in the in-memory harness.
    return statement.replace(/ NOT VALID;?$/u, "");
  }
  if (
    file === "0188_network_benchmark_deployment_key.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_[^"]+"\s+VALIDATE CONSTRAINT/u.test(statement)
  ) {
    // The transformed ADD CONSTRAINT above already validates existing rows.
    return null;
  }
  if (
    file === "0187_dsa_named_panel_materialization_retries.sql" &&
    /^(?:CREATE OR REPLACE FUNCTION|CREATE TRIGGER) tokenless_(?:guard_)?dsa_named_panel_materialization_retry/u.test(
      statement,
    )
  ) {
    // PostgreSQL owns the database-authored operational timestamp trigger.
    // pg-mem does not execute PL/pgSQL migration triggers.
    return null;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^DROP TRIGGER IF EXISTS tokenless_assurance_assignments_network_benchmark_guard/u.test(statement)
  ) {
    // pg-mem cannot parse PostgreSQL's DROP TRIGGER ... ON syntax. The memory
    // harness does not execute migration triggers, so there is nothing to drop.
    return null;
  }
  if (
    file === "0186_dsa_named_adjudicator_assignments.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_adjudicator_assignments"/u.test(statement)
  ) {
    // PostgreSQL owns the shared qualification predicate, SQL/JSON exactness,
    // and millisecond transaction timestamp. The memory harness retains the
    // assignment keys and relational shape used by service projections.
    return statement
      .replace("date_trunc('milliseconds',transaction_timestamp())", "CURRENT_TIMESTAMP")
      .replace(/,\n\s+CHECK \([\s\S]*\)\n\);?$/u, "\n);");
  }
  if (
    file === "0186_dsa_named_adjudicator_assignments.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_(?:unit_gaps|unit_outcomes)"/u.test(statement)
  ) {
    return null;
  }
  if (
    file === "0186_dsa_named_adjudicator_assignments.sql" &&
    /^ALTER TABLE "tokenless_dsa_reference_labels"/u.test(statement)
  ) {
    return null;
  }
  if (
    file === "0185_dsa_content_self_identification_gaps.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_capacity_releases"/u.test(statement)
  ) {
    return statement.replace("date_trunc('milliseconds',transaction_timestamp())", "CURRENT_TIMESTAMP");
  }
  if (
    file === "0185_dsa_content_self_identification_gaps.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"[\s\S]*ADD COLUMN "content_self_identification_report_count"/u.test(
      statement,
    )
  ) {
    return `ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"
      ADD COLUMN "content_self_identification_report_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "content_self_identification_report_root" text`;
  }
  if (
    file === "0185_dsa_content_self_identification_gaps.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_unit_gaps"/u.test(statement)
  ) {
    // PostgreSQL replaces the exact v2 gap contract here. pg-mem assigned the
    // prior inline check an implementation-specific name, so source and real
    // PostgreSQL tests own that replacement.
    return null;
  }
  if (
    file === "0185_dsa_content_self_identification_gaps.sql" &&
    /^ALTER TABLE "tokenless_dsa_reference_labels"/u.test(statement)
  ) {
    // PostgreSQL replaces the exact gap-reason contract. pg-mem assigned the
    // prior inline check an implementation-specific name, so its structural
    // harness retains that check while source and real-PG tests own v2.
    return null;
  }
  if (
    file === "0184_dsa_assignment_response_binding.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_assignment_response_bindings"/u.test(statement)
  ) {
    // PostgreSQL records millisecond-normalized transaction time. pg-mem does
    // not implement date_trunc(timestamptz), so its structural harness uses the
    // equivalent current-time default without asserting timestamp precision.
    return statement.replace("date_trunc('milliseconds',transaction_timestamp())", "CURRENT_TIMESTAMP");
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_[^"]+"\s+RENAME CONSTRAINT/u.test(statement)
  ) {
    // PostgreSQL keeps the renamed foreign-key semantics. pg-mem does not
    // implement constraint renames, so memory tests retain the legacy name.
    return null;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"[\s\S]*v2_contract_check/u.test(statement)
  ) {
    return `ALTER TABLE "tokenless_network_benchmark_opportunity_authorizations"
      ADD CONSTRAINT "tokenless_network_benchmark_opportunity_authorizations_v2_contract_check" CHECK (
        "workspace_manager_reference_principal_id" IS NOT NULL
        AND "activation_scope"='testnet_network_benchmark_exercise'
        AND "permitted_worker_jurisdictions_hash" IS NOT NULL
      )`;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_activation_evidence"[\s\S]*DROP CONSTRAINT/u.test(statement)
  ) {
    return `ALTER TABLE "tokenless_network_benchmark_activation_evidence"
      DROP CONSTRAINT "tokenless_network_benchmark_activation_evidence_contract_check",
      ADD CONSTRAINT "tokenless_network_benchmark_activation_evidence_contract_check" CHECK (
        "completed_at" BETWEEN "evidence_window_start" AND "evidence_window_end"
        AND "evidence_window_end" <= "recorded_at"
        AND "evidence_type" IN (
          'audit_partner_method_acceptance','provider_pilot_acceptance','network_supply_demand_confirmation',
          'hosted_paid_core_testnet_exercise','keeper_recovery_exercise','indexer_recovery_exercise',
          'paid_eligibility_payout_tax_dac7_readiness','sanctions_screening_readiness',
          'reviewer_contract_worker_information_appeal_readiness',
          'algorithmic_management_human_review_readiness','private_worker_communication_readiness',
          'worker_data_privacy_governance_readiness'
        )
      )`;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_activations"[\s\S]*v2_contract_check/u.test(statement)
  ) {
    return `ALTER TABLE "tokenless_network_benchmark_activations"
      DROP CONSTRAINT "tokenless_network_benchmark_activations_contract_check",
      ADD CONSTRAINT "tokenless_network_benchmark_activations_v2_contract_check" CHECK (
        "expected_evidence_count" >= 14
        AND "evidence_window_end" <= "activated_at"
        AND "activation_scope"='testnet_network_benchmark_exercise'
        AND "permitted_worker_jurisdictions_hash" IS NOT NULL
      )`;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^ALTER TABLE "tokenless_network_benchmark_activation_deactivations"[\s\S]*v2_contract_check/u.test(statement)
  ) {
    return `ALTER TABLE "tokenless_network_benchmark_activation_deactivations"
      ADD CONSTRAINT "tokenless_network_benchmark_deactivations_v2_contract_check" CHECK (
        "workspace_manager_reference_principal_id" IS NOT NULL
      )`;
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_reference_definitions"/u.test(statement)
  ) {
    // PostgreSQL 16 owns the unique-key JSON and exact jsonb reconstruction
    // checks. pg-mem cannot parse either form, but can exercise the remaining
    // table shape, hashes, foreign keys, and service behavior.
    return statement
      .replace(/\n\s+AND "definition_json" IS JSON OBJECT WITH UNIQUE KEYS/u, "")
      .replace(/\n\s+AND "definition_json"::jsonb=jsonb_build_object\([\s\S]*?'createdBy',"created_by"\n\s+\)/u, "");
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_selections"/u.test(statement)
  ) {
    // PostgreSQL owns the unique-key JSON and exact snapshot reconstruction.
    return statement
      .replace(/\n\s+AND "panel_deadline"="selected_at"\+\("response_window_ms"\*interval '1 millisecond'\)/u, "")
      .replace(/\n\s+AND "selection_snapshot_json" IS JSON OBJECT WITH UNIQUE KEYS/u, "")
      .replace(
        /\n\s+AND "selection_snapshot_json"::jsonb=jsonb_build_object\([\s\S]*?'selectedAt',to_char\("selected_at"[\s\S]*?\)\n\s+\)/u,
        "",
      );
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^INSERT INTO "tokenless_dsa_reference_label_set_quarantines"/u.test(statement)
  ) {
    // The in-memory database is always empty at this append-only backfill, and
    // pg-mem cannot resolve the correlated NOT EXISTS aliases used by PostgreSQL.
    return null;
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_label_set_bridges"[\s\S]*unique_json_check/u.test(statement)
  ) {
    return null;
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /ALTER TABLE "tokenless_dsa_named_panel_units"[\s\S]*tokenless_dsa_named_panel_units_exact_json_check/u.test(
      statement,
    )
  ) {
    // Keep the exact reference-definition foreign key in memory. PostgreSQL 16
    // owns the JSON unique-key predicates and nested jsonb reconstruction.
    return statement.replace(
      /,\n\s+ADD CONSTRAINT "tokenless_dsa_named_panel_units_exact_json_check" CHECK \([\s\S]*\)\s*;?$/u,
      "",
    );
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_unit_outcomes"/u.test(statement)
  ) {
    // pg-mem gives unnamed inline checks implementation-specific names. Real
    // PostgreSQL owns the replacement check and exact gap FK.
    return 'ALTER TABLE "tokenless_dsa_named_panel_unit_outcomes" ADD COLUMN "gap_evidence_id" text';
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^ALTER TABLE "tokenless_dsa_named_panel_adjudications"/u.test(statement)
  ) {
    return statement.replace(
      /,\n\s+ADD CONSTRAINT "tokenless_dsa_named_panel_adjudications_exact_json_check" CHECK \([\s\S]*\)\s*;?$/u,
      "",
    );
  }
  if (
    ["0182_dsa_named_panel_release_guards.sql", "0184_dsa_assignment_response_binding.sql"].includes(file) &&
    /^ALTER TABLE "tokenless_dsa_named_panel_(?:assignments|artifact_accesses|response_evidence)"[\s\S]*_exact_json_check/u.test(
      statement,
    )
  ) {
    // PostgreSQL owns exact unique-key JSON reconstruction for these immutable
    // evidence rows. pg-mem cannot parse SQL/JSON predicates.
    return null;
  }
  if (
    file === "0182_dsa_named_panel_release_guards.sql" &&
    /^ALTER TABLE "tokenless_dsa_reference_labels"/u.test(statement)
  ) {
    return 'ALTER TABLE "tokenless_dsa_reference_labels" ADD COLUMN "gap_reason" text';
  }
  if (
    file === "0179_dsa_named_reference_panel.sql" &&
    /^CREATE TABLE "tokenless_dsa_named_panel_units"/u.test(statement)
  ) {
    // pg-mem cannot resolve PostgreSQL's jsonb #>> text[] operator. The real
    // PostgreSQL suite and migration source tests pin these projection checks;
    // service tests still need the table and every constraint pg-mem supports.
    return statement.replace(/\n\s+AND "blinded_payload_json"::jsonb#>>'\{[^']+\}'=[^\n]+/gu, "");
  }
  if (
    file === "0180_dsa_derivation_consumer_safety.sql" &&
    /ADD CONSTRAINT "tokenless_benchmark_research_exports_reference_provenance_check"/u.test(statement)
  ) {
    // PostgreSQL 16 enforces IS JSON ... WITH UNIQUE KEYS and exact jsonb
    // reconstruction here. pg-mem parses neither form; source and real-PG
    // tests pin the production constraint while memory keeps the new columns.
    return null;
  }
  if (
    [
      "0060_human_review_opportunity_transition_events.sql",
      "0063_human_review_result_observations.sql",
      "0064_human_review_terminal_recovery.sql",
      "0065_human_review_continuations.sql",
      "0067_paid_review_voucher_receipts.sql",
      "0068_feedback_bonus_awards.sql",
      "0077_assurance_automated_eval_receipts.sql",
      "0086_enterprise_identity.sql",
      "0088_expertise_verification_queue.sql",
      "0094_assurance_override_decisions.sql",
      "0099_agent_per_request_review_questions.sql",
      "0100_workspace_expertise_definitions.sql",
      "0120_private_quote_ownership.sql",
      "0121_paid_assignment_operations.sql",
      "0122_evm_kms_signing_ledger.sql",
      "0123_evm_kms_signing_ledger_integrity.sql",
      "0156_provider_neutral_evm_signing_ledger.sql",
      "0126_evm_transaction_fee_replacements.sql",
      "0138_crowd_forecast_integrity.sql",
      "0139_paid_assignment_terminal_states.sql",
      "0140_network_assignment_settlement.sql",
      "0142_network_settlement_hardening.sql",
      "0144_forecast_appeal_resolution.sql",
      "0145_public_network_review_reachability.sql",
      "0146_hybrid_review_parent_settlement.sql",
      "0147_hybrid_request_profile_semantics.sql",
      "0166_employment_data_governance.sql",
      "0167_reviewer_engagement_events.sql",
      "0168_dsa_population_ledger.sql",
      "0169_dsa_part8_source_facts.sql",
      "0170_dsa_reference_sampling_epochs.sql",
      "0171_dsa_part8_inventory_and_notices.sql",
      "0172_dsa_part8_count_contracts.sql",
      "0173_dsa_reference_label_sets.sql",
      "0174_dsa_part8_report_versions.sql",
      "0175_project_window_compliance_shares.sql",
      "0176_benchmark_research_persistence.sql",
      "0177_network_benchmark_activation.sql",
      "0178_dsa_reference_network_provenance.sql",
      "0179_dsa_named_reference_panel.sql",
      "0180_dsa_derivation_consumer_safety.sql",
      "0181_compliance_capability_issuance_idempotency.sql",
      "0182_dsa_named_panel_release_guards.sql",
      "0183_network_benchmark_activation_v2.sql",
      "0184_dsa_assignment_response_binding.sql",
      "0185_dsa_content_self_identification_gaps.sql",
      "0186_dsa_named_adjudicator_assignments.sql",
    ].includes(file) &&
    (/\bDO \$\$/u.test(statement) ||
      /\bCREATE OR REPLACE FUNCTION\b/u.test(statement) ||
      /\bCREATE (?:CONSTRAINT )?TRIGGER\b/u.test(statement))
  ) {
    // pg-mem does not implement PostgreSQL trigger functions. The production
    // migration installs the append-only guard; migration source tests cover it.
    return null;
  }
  if (
    file === "0183_network_benchmark_activation_v2.sql" &&
    /^DROP TRIGGER IF EXISTS tokenless_assurance_assignments_network_benchmark_guard/u.test(statement)
  ) {
    return null;
  }
  if (
    file === "0142_network_settlement_hardening.sql" &&
    /^UPDATE "tokenless_network_assignment_settlements"/u.test(statement) &&
    /\bFROM "tokenless_assurance_assignments"/u.test(statement)
  ) {
    // The forward migration asserts the network feature was never activated,
    // so these production backfills are guaranteed empty. pg-mem does not
    // implement PostgreSQL's aliased UPDATE ... FROM form.
    return null;
  }
  if (
    file === "0144_forecast_appeal_resolution.sql" &&
    /^INSERT INTO "tokenless_forecast_integrity_appeal_events"/u.test(statement)
  ) {
    // Production backfills any pre-migration appeals. In-memory databases start
    // empty, and pg-mem does not provide PostgreSQL's built-in md5 function.
    return null;
  }
  if (
    file === "0151_dac7_statutory_records.sql" &&
    (/^INSERT INTO "tokenless_dac7_records"/u.test(statement) ||
      /^UPDATE "tokenless_legal_eligibility"/u.test(statement))
  ) {
    // Production migrates any existing encrypted DAC7 payloads into their
    // statutory-retention rows. Memory databases start empty, and pg-mem does
    // not implement the date-construction functions used by that backfill.
    return null;
  }
  if (
    file === "0130_workspace_reviewer_roster.sql" &&
    (/\bDO \$\$/u.test(statement) || /^WITH "legacy_/u.test(statement))
  ) {
    // pg-mem does not parse the production-only legacy reviewer CTE backfills
    // or procedural fail-closed guard. Memory databases start empty; source
    // tests pin those statements while service tests exercise the new schema.
    return null;
  }
  if (file === "0131_workspace_reviewer_policy_acceptances.sql") {
    if (/^ALTER TABLE "tokenless_workspace_agent_setups"\s+DROP CONSTRAINT/u.test(statement)) {
      // PostgreSQL generates the legacy inline FK with the `_fkey` suffix used
      // by the production migration. pg-mem calls the same constraint `_fk`.
      return statement.replace(
        "tokenless_workspace_agent_setups_people_invitation_id_fkey",
        "tokenless_workspace_agent_setups_people_invitation_id_fk",
      );
    }
    if (/^UPDATE\b/u.test(statement)) {
      // pg-mem does not support the production UPDATE ... FROM backfills. Memory
      // databases start empty, so only the structural migration is required here.
      return null;
    }
  }
  if (file === "0134_expired_private_review_capacity.sql") {
    // This is a one-time production data repair. In-memory databases start
    // empty, and pg-mem does not parse PostgreSQL's CREATE TABLE AS backfill.
    return null;
  }
  if (
    file === "0135_private_review_crowd_forecasts.sql" &&
    /^ALTER TABLE "tokenless_private_review_responses"/u.test(statement)
  ) {
    // pg-mem does not implement PostgreSQL's integer modulo operator inside a
    // CHECK constraint. Service validation and the migration source test pin
    // the same one-percent grid while memory tests retain the new column.
    return 'ALTER TABLE "tokenless_private_review_responses" ADD COLUMN "predicted_positive_bps" integer';
  }
  if (
    file === "0123_evm_kms_signing_ledger_integrity.sql" &&
    /^ALTER TABLE "tokenless_evm_kms_signing_ledger"\s+ADD CONSTRAINT/u.test(statement)
  ) {
    // pg-mem does not parse PostgreSQL's NOT VALID modifier. The in-memory
    // schema is empty, so installing the same CHECK immediately is equivalent.
    return statement.replace(/\s+NOT VALID;?$/u, "");
  }
  if (
    file === "0123_evm_kms_signing_ledger_integrity.sql" &&
    /^ALTER TABLE "tokenless_evm_kms_signing_ledger"\s+VALIDATE CONSTRAINT/u.test(statement)
  ) {
    return null;
  }
  if (
    file === "0156_provider_neutral_evm_signing_ledger.sql" &&
    /^CREATE UNIQUE INDEX "tokenless_evm_signing_ledger_terminal_unique"/u.test(statement)
  ) {
    // pg-mem does not honor the terminal-only partial-index predicate. The
    // production migration and source test retain the uniqueness guarantee.
    return null;
  }
  if (
    file === "0123_evm_kms_signing_ledger_integrity.sql" &&
    /^CREATE UNIQUE INDEX "tokenless_evm_kms_signing_ledger_terminal_unique"/u.test(statement)
  ) {
    // pg-mem applies this partial index to attempted rows and then returns only
    // the terminal row for attempt-id lookups. Production retains the index;
    // the migration source test pins its terminal-only predicate.
    return null;
  }
  if (
    file === "0094_assurance_override_decisions.sql" &&
    /^CREATE UNIQUE INDEX "tokenless_assurance_override_decisions_chain_root_unique"/u.test(statement)
  ) {
    // pg-mem ignores the partial-index predicate and then serves run_id
    // lookups from the (wrongly unique) index. Production enforces the single
    // chain root; the migration source test covers the predicate.
    return null;
  }
  if (file === "0083_gold_quality.sql" && /^CREATE TABLE "tokenless_assurance_gold_items"/u.test(statement)) {
    // pg-mem does not recognize the composite UNIQUE added to rubrics by the
    // preceding ALTER when resolving this FK. Production retains and source-
    // tests the stronger project-scoped FK; memory tests use the existing PK.
    return statement.replace(
      /FOREIGN KEY \("project_id", "rubric_id", "rubric_version"\)\s+REFERENCES "tokenless_assurance_rubrics"\("project_id", "rubric_id", "version"\)/u,
      'FOREIGN KEY ("rubric_id", "rubric_version") REFERENCES "tokenless_assurance_rubrics"("rubric_id", "version")',
    );
  }
  if (
    file === "0145_public_network_review_reachability.sql" &&
    /^CREATE TABLE "tokenless_public_network_review_bindings"/u.test(statement)
  ) {
    // pg-mem does not recognize composite UNIQUE constraints installed by
    // preceding ALTER statements when it resolves this table's scoped FKs.
    // Production retains every workspace/project-scoped FK; memory tests bind
    // the same rows through the referenced tables' existing primary keys.
    return statement
      .replace(
        /FOREIGN KEY \("workspace_id","integration_id"\)\s+REFERENCES "tokenless_agent_integrations" \("workspace_id","integration_id"\)/u,
        'FOREIGN KEY ("integration_id") REFERENCES "tokenless_agent_integrations" ("integration_id")',
      )
      .replace(
        /FOREIGN KEY \("workspace_id","project_id"\)\s+REFERENCES "tokenless_assurance_projects" \("workspace_id","project_id"\)/u,
        'FOREIGN KEY ("project_id") REFERENCES "tokenless_assurance_projects" ("project_id")',
      )
      .replace(
        /FOREIGN KEY \("project_id","audience_policy_id","audience_policy_version"\)\s+REFERENCES "tokenless_assurance_audience_policies" \("project_id","policy_id","version"\)/u,
        'FOREIGN KEY ("audience_policy_id","audience_policy_version") REFERENCES "tokenless_assurance_audience_policies" ("policy_id","version")',
      )
      .replace(
        /FOREIGN KEY \("project_id","suite_id","suite_version"\)\s+REFERENCES "tokenless_assurance_suites" \("project_id","suite_id","version"\)/u,
        'FOREIGN KEY ("suite_id","suite_version") REFERENCES "tokenless_assurance_suites" ("suite_id","version")',
      )
      .replace(
        /FOREIGN KEY \("project_id","case_id"\)\s+REFERENCES "tokenless_assurance_cases" \("project_id","case_id"\)/u,
        'FOREIGN KEY ("case_id") REFERENCES "tokenless_assurance_cases" ("case_id")',
      )
      .replace(
        /FOREIGN KEY \("project_id","run_id"\)\s+REFERENCES "tokenless_assurance_runs" \("project_id","run_id"\)/u,
        'FOREIGN KEY ("run_id") REFERENCES "tokenless_assurance_runs" ("run_id")',
      );
  }
  if (
    file === "0147_hybrid_request_profile_semantics.sql" &&
    /^ALTER TABLE "tokenless_agent_review_request_profiles"\s+ADD CONSTRAINT/u.test(statement)
  ) {
    // pg-mem's SQL parser does not implement PostgreSQL's JSONPath `@?`
    // operator. Production retains the source-scope CHECK; application and
    // migration tests exercise the same exact v4 source partition.
    return statement.replace(/\s+AND NOT \(\s*"expertise_requirements_json"::jsonb @\? '[^']+'\s*\)/u, "");
  }
  if (
    file === "0174_dsa_part8_report_versions.sql" &&
    /^CREATE TABLE "tokenless_dsa_part8_report_cells"/u.test(statement)
  ) {
    // pg-mem does not implement PostgreSQL's case-insensitive regular-expression
    // operator. Production keeps the public-cell identifier leak guard, and the
    // migration source/service tests pin the same denylist.
    return statement.replace(
      /\s+AND NOT \(concat_ws\(E'\\n',"applicability","service","reporting_period","section","indicator",\s*"scope","value","context_json"\)\s*~\* '[^']+'\)/u,
      "",
    );
  }
  if (file === "0174_dsa_part8_report_versions.sql" && /!?~\*/u.test(statement)) {
    return statement.replace(/\s+AND "public_path" !~\* 'latest'/u, "").replaceAll("~*", "~");
  }
  if (
    file === "0177_network_benchmark_activation.sql" &&
    /^CREATE TABLE "tokenless_network_benchmark_activations"/u.test(statement)
  ) {
    // pg-mem cannot parse PostgreSQL's named make_interval argument. The
    // production duration equality is source-tested and exercised in Postgres.
    return statement.replace(
      /\s+AND "authorization_expires_at" = "activated_at" \+ make_interval\(secs => "authorization_duration_seconds"\)/u,
      "",
    );
  }
  if (file !== "0058_human_review_binding_backfill.sql") return statement;

  // The in-memory test database applies migrations to a guaranteed-empty schema.
  // pg-mem cannot parse the PostgreSQL backfill's temporary CREATE TABLE AS WITH,
  // LATERAL joins, or correlated DISTINCT ON expressions. Apply the structural
  // constraints here and cover the production-only data migration separately.
  return /^ALTER TABLE/u.test(statement) ? statement : null;
}

function createDatabaseClient(pool: Pool): DatabaseClient {
  return {
    async execute(input) {
      const query = normalizeQuery(input);
      return pool.query(query);
    },
  };
}

/**
 * Fast service-test database only.
 *
 * This harness cannot prove PostgreSQL transaction or constraint behavior:
 *
 * - Drizzle `transaction()` is a passthrough, and pg-mem does not reliably undo writes after
 *   `ROLLBACK`.
 * - production migrations omit or relax unsupported CHECK constraints and partial unique indexes.
 *
 * Tests for rollback atomicity, CHECK enforcement, or partial/conditional uniqueness belong in
 * `scripts/test-postgres-invariants.mjs`, which CI runs against migrated PostgreSQL.
 */
export function createMemoryDatabaseResources(
  options: { transactionTimestamp?: () => Date; commitTimestamp?: () => Date } = {},
): DatabaseResources {
  const migrationDirectory = getMigrationDirectory();
  const memoryDb = newDb();
  memoryDb.public.registerFunction({
    name: "hashtext",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => [...value].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) | 0, 0),
  });
  memoryDb.public.registerFunction({
    name: "set_config",
    args: [DataType.text, DataType.text, DataType.bool],
    returns: DataType.text,
    implementation: (_name, value) => value,
  });
  memoryDb.public.registerFunction({
    name: "mod",
    args: [DataType.float, DataType.integer],
    returns: DataType.float,
    implementation: (left, right) => left % right,
  });
  memoryDb.public.registerFunction({
    name: "mod",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: (left, right) => left % right,
  });
  memoryDb.public.registerFunction({
    name: "convert_to",
    args: [DataType.text, DataType.text],
    returns: DataType.bytea,
    implementation: (value, encoding) => {
      if (encoding.toUpperCase() !== "UTF8") throw new Error("Only UTF8 test encoding is supported.");
      return Buffer.from(value, "utf8");
    },
  });
  memoryDb.public.registerFunction({
    name: "digest",
    args: [DataType.bytea, DataType.text],
    returns: DataType.bytea,
    implementation: (value, algorithm) => createHash(algorithm).update(value).digest(),
  });
  memoryDb.public.registerFunction({
    name: "octet_length",
    args: [DataType.bytea],
    returns: DataType.integer,
    implementation: value => value.byteLength,
  });
  memoryDb.public.registerFunction({
    name: "encode",
    args: [DataType.bytea, DataType.text],
    returns: DataType.text,
    implementation: (value, encoding) => {
      if (encoding !== "hex") throw new Error("Only hex test encoding is supported.");
      return value.toString("hex");
    },
  });
  memoryDb.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  memoryDb.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  memoryDb.public.registerFunction({
    name: "pg_try_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
  });
  memoryDb.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: value => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value),
  });
  memoryDb.public.registerFunction({
    name: "jsonb_array_length",
    args: [DataType.jsonb],
    returns: DataType.integer,
    implementation: value => (Array.isArray(value) ? value.length : 0),
  });
  memoryDb.public.registerFunction({
    name: "tokenless_dsa_part8_language_codes_are_canonical",
    args: [DataType.text],
    returns: DataType.bool,
    implementation: value => {
      try {
        const parsed: unknown = JSON.parse(value);
        const allowed = new Set([
          "bg",
          "cs",
          "da",
          "de",
          "el",
          "en",
          "es",
          "et",
          "fi",
          "fr",
          "ga",
          "hr",
          "hu",
          "it",
          "lt",
          "lv",
          "mt",
          "nl",
          "pl",
          "pt",
          "ro",
          "sk",
          "sl",
          "sv",
        ]);
        if (!Array.isArray(parsed) || parsed.some(code => typeof code !== "string" || !allowed.has(code))) {
          return false;
        }
        return new Set(parsed).size === parsed.length && JSON.stringify([...parsed].sort()) === value;
      } catch {
        return false;
      }
    },
  });
  memoryDb.public.registerFunction({
    name: "transaction_timestamp",
    args: [],
    returns: DataType.timestamptz,
    implementation: () => new Date((options.transactionTimestamp ?? (() => new Date()))().getTime()),
  });
  memoryDb.public.registerFunction({
    name: "tokenless_dsa_evidence_transaction_timestamp",
    args: [],
    returns: DataType.timestamptz,
    implementation: () => new Date((options.transactionTimestamp ?? (() => new Date()))().getTime()),
  });
  memoryDb.public.registerFunction({
    name: "tokenless_dsa_evidence_commit_timestamp",
    args: [],
    returns: DataType.timestamptz,
    implementation: () =>
      new Date((options.commitTimestamp ?? options.transactionTimestamp ?? (() => new Date()))().getTime()),
  });
  memoryDb.public.registerFunction({
    name: "jsonb_build_object",
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (firstKey, firstValue, secondKey, secondValue) => ({
      [firstKey]: firstValue,
      [secondKey]: secondValue,
    }),
  });
  memoryDb.public.registerFunction({
    name: "jsonb_build_object",
    args: [DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (firstKey, firstValue, secondKey, secondValue, thirdKey, thirdValue) => ({
      [firstKey]: firstValue,
      [secondKey]: secondValue,
      [thirdKey]: thirdValue,
    }),
  });
  memoryDb.public.registerFunction({
    name: "char_length",
    args: [DataType.text],
    returns: DataType.integer,
    implementation: value => value.length,
  });
  memoryDb.public.registerFunction({
    name: "btrim",
    args: [DataType.text],
    returns: DataType.text,
    implementation: value => value.trim(),
  });
  memoryDb.public.registerOperator({
    operator: "<@",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && left.every(value => right.includes(value)),
  });
  memoryDb.public.registerOperator({
    operator: "@>",
    left: DataType.jsonb,
    right: DataType.jsonb,
    returns: DataType.bool,
    implementation: (left, right) =>
      Array.isArray(left) && Array.isArray(right) && right.every(value => left.includes(value)),
  });
  memoryDb.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });

  if (fs.existsSync(migrationDirectory)) {
    // The journal is the authority on which migrations exist and in what order.
    // A filename sort would silently execute any stray `.sql` file the journal
    // deliberately excludes.
    for (const file of readJournalMigrationFiles(migrationDirectory)) {
      const sqlText = fs.readFileSync(path.join(migrationDirectory, file), "utf8");
      applySqlStatements(sqlText, statement => {
        if (/^CREATE EXTENSION IF NOT EXISTS pgcrypto;?$/iu.test(statement)) return;
        const compatibleStatement = memoryCompatibleMigrationStatement(file, statement);
        if (compatibleStatement === null) return;
        memoryDb.public.none(compatibleStatement);
      });
    }
  }

  const adapter = memoryDb.adapters.createPg();
  const pool = patchMemoryPgQueries(new adapter.Pool()) as unknown as Pool;
  const connect = pool.connect.bind(pool);
  pool.connect = (async () => patchMemoryPgQueries(await connect())) as typeof pool.connect;
  const client = createDatabaseClient(pool);
  const database = drizzlePgProxy(
    async (query, params, method) => {
      const result = await pool.query({
        text: query,
        values: params,
      });

      return {
        rows: method === "all" ? result.rows.map(row => (Array.isArray(row) ? row : Object.values(row))) : result.rows,
      };
    },
    { schema },
  ) as unknown as DatabaseResources["database"] & {
    transaction: <T>(callback: (tx: DatabaseResources["database"]) => Promise<T>) => Promise<T>;
  };

  (
    database as unknown as {
      transaction: <T>(callback: (tx: DatabaseResources["database"]) => Promise<T>) => Promise<T>;
    }
  ).transaction = async callback => callback(database as unknown as DatabaseResources["database"]);

  return {
    client,
    database,
    pool,
  };
}
