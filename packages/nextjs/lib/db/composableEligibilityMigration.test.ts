import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";

function statements(sqlText: string) {
  return sqlText
    .split(MIGRATION_BREAKPOINT)
    .map(statement => statement.trim())
    .filter(Boolean);
}

function applyMigration(database: ReturnType<typeof newDb>, filename: string) {
  const sqlText = readFileSync(join(process.cwd(), "drizzle", filename), "utf8");
  for (const statement of statements(sqlText)) database.public.none(statement);
}

function applyMigrationsThrough0016(database: ReturnType<typeof newDb>) {
  const drizzleDirectory = join(process.cwd(), "drizzle");
  const migrations = readdirSync(drizzleDirectory)
    .filter(filename => /^00(?:0\d|1[0-6])_.+\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right));
  for (const migration of migrations) applyMigration(database, migration);
}

function seedLegacyEligibility(database: ReturnType<typeof newDb>) {
  database.public.none(`
    INSERT INTO tokenless_rater_profiles
      (rater_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
       nullifier_key_domain, created_at, updated_at)
    VALUES
      ('rater_legacy', '0x1111111111111111111111111111111111111111', 'seed-ciphertext',
       'vote-v1', 'vote_mapping', '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');

    INSERT INTO tokenless_capability_eligibility
      (rater_id, provider_id, provider_assertion_hash, provider_assertion_id_hash,
       provider_subject_hash, capabilities_json, provider_evidence_ciphertext,
       provider_evidence_key_version, provider_evidence_key_domain, evidence_verified_at,
       evidence_expires_at, minimum_age_verified, document_issuing_country,
       nationality_country, verified_residence_country, declared_residence_country,
       tax_residence_country, residence_tax_status, tax_profile_status, dac7_status,
       tax_vault_ciphertext, tax_vault_key_version, tax_vault_key_domain,
       sanctions_consent_at, sanctions_status, sanctions_reference_hash,
       sanctions_screened_at, sanctions_expires_at, payout_account,
       payout_ownership_method, payout_verified_at, reviewer_source, cohort_ids_json,
       qualification_keys_json, eligibility_status, blocked_reason, created_at, updated_at)
    VALUES
      ('rater_legacy', 'legacy-provider', 'assertion-hash', 'assertion-id-hash',
       'subject-hash', '["live_human","unique_human","minimum_age"]', 'evidence-ciphertext',
       'evidence-v1', 'provider_evidence', '2026-07-01T00:00:00Z',
       '2026-08-01T00:00:00Z', 18, 'DE', 'FR', 'DE', 'DE',
       'DE', 'consistent', 'complete', 'complete', 'tax-ciphertext', 'tax-v1', 'tax_records',
       '2026-07-01T00:00:00Z', 'clear', 'sanctions-hash',
       '2026-07-01T00:00:00Z', '2026-08-01T00:00:00Z',
       '0x1111111111111111111111111111111111111111', 'siwe_base_account_session',
       '2026-07-01T00:00:00Z', 'rateloop_network', '["cohort_support"]',
       '["support_experience"]', 'eligible', NULL,
       '2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z');
  `);
}

test("composable eligibility migration preserves legacy-v2 evidence without removing the source row", () => {
  const database = newDb();
  applyMigrationsThrough0016(database);
  seedLegacyEligibility(database);
  applyMigration(database, "0017_composable_assurance_eligibility.sql");

  assert.equal(database.public.one("SELECT count(*) AS count FROM tokenless_capability_eligibility").count, 1);
  assert.deepEqual(
    database.public.one(`
      SELECT provider_id, provider_namespace, subject_reference_hash, subject_reference_scheme, status
      FROM tokenless_provider_subject_bindings
      WHERE rater_id = 'rater_legacy'
    `),
    {
      provider_id: "legacy-provider",
      provider_namespace: "legacy:v2",
      subject_reference_hash: "subject-hash",
      subject_reference_scheme: "legacy-sha256-v2",
      status: "active",
    },
  );
  assert.deepEqual(
    database.public.one(`
      SELECT provider_namespace, capabilities_json, minimum_age_verified,
             document_issuing_country, nationality_country, verified_residence_country,
             provider_evidence_key_domain
      FROM tokenless_assurance_assertions
      WHERE rater_id = 'rater_legacy'
    `),
    {
      provider_namespace: "legacy:v2",
      capabilities_json: '["live_human","unique_human","minimum_age"]',
      minimum_age_verified: 18,
      document_issuing_country: "DE",
      nationality_country: "FR",
      verified_residence_country: "DE",
      provider_evidence_key_domain: "provider_evidence",
    },
  );
  assert.deepEqual(
    database.public.one(`
      SELECT minimum_age_verified, declared_residence_country, tax_residence_country,
             sanctions_status, tax_vault_key_domain, eligibility_status
      FROM tokenless_legal_eligibility
      WHERE rater_id = 'rater_legacy'
    `),
    {
      minimum_age_verified: 18,
      declared_residence_country: "DE",
      tax_residence_country: "DE",
      sanctions_status: "clear",
      tax_vault_key_domain: "tax_records",
      eligibility_status: "eligible",
    },
  );
  assert.deepEqual(
    database.public.one(`
      SELECT payout_account, payout_ownership_method, eligibility_status
      FROM tokenless_payout_eligibility
      WHERE rater_id = 'rater_legacy'
    `),
    {
      payout_account: "0x1111111111111111111111111111111111111111",
      payout_ownership_method: "siwe_base_account_session",
      eligibility_status: "ready",
    },
  );
  assert.deepEqual(
    database.public.one(`
      SELECT reviewer_source, qualification_kind, cohort_ids_json, qualification_keys_json, status
      FROM tokenless_reviewer_qualifications
      WHERE rater_id = 'rater_legacy'
    `),
    {
      reviewer_source: "rateloop_network",
      qualification_kind: "legacy_snapshot",
      cohort_ids_json: '["cohort_support"]',
      qualification_keys_json: '["support_experience"]',
      status: "active",
    },
  );
});

test("provider subject uniqueness is scoped to provider and RP namespace", () => {
  const database = newDb();
  applyMigrationsThrough0016(database);
  applyMigration(database, "0017_composable_assurance_eligibility.sql");
  database.public.none(`
    INSERT INTO tokenless_rater_profiles
      (rater_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
       nullifier_key_domain, created_at, updated_at)
    VALUES
      ('rater_a', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'seed-a', 'v1', 'vote_mapping', NOW(), NOW()),
      ('rater_b', '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'seed-b', 'v1', 'vote_mapping', NOW(), NOW());

    INSERT INTO tokenless_provider_subject_bindings
      (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
       subject_reference_scheme, status, bound_at, last_verified_at, created_at, updated_at)
    VALUES
      ('binding_a', 'rater_a', 'world:poh', 'rp_primary', 'subject-hmac',
       'hmac-sha256-v1', 'active', NOW(), NOW(), NOW(), NOW());
  `);

  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_provider_subject_bindings
        (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
         subject_reference_scheme, status, bound_at, last_verified_at, created_at, updated_at)
      VALUES
        ('binding_duplicate', 'rater_b', 'world:poh', 'rp_primary', 'subject-hmac',
         'hmac-sha256-v1', 'active', NOW(), NOW(), NOW(), NOW());
    `),
  );

  database.public.none(`
    INSERT INTO tokenless_provider_subject_bindings
      (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
       subject_reference_scheme, status, bound_at, last_verified_at, created_at, updated_at)
    VALUES
      ('binding_other_rp', 'rater_b', 'world:poh', 'rp_secondary', 'subject-hmac',
       'hmac-sha256-v1', 'active', NOW(), NOW(), NOW(), NOW());
  `);
  assert.equal(database.public.one("SELECT count(*) AS count FROM tokenless_provider_subject_bindings").count, 2);
});
