import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const migration = readFileSync(
  new URL("../../drizzle/0117_principal_bound_rater_identity.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

function migrationFixture() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_principals (
      principal_id text PRIMARY KEY, status text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_wallet_bindings (
      binding_id text PRIMARY KEY, principal_id text NOT NULL REFERENCES tokenless_principals(principal_id),
      purpose text NOT NULL, wallet_address text NOT NULL, created_at timestamptz NOT NULL, revoked_at timestamptz
    );
    CREATE TABLE tokenless_rater_profiles (
      rater_id text PRIMARY KEY, account_address text NOT NULL UNIQUE
    );
    CREATE TABLE tokenless_eligibility_provider_handoffs (
      state_hash text PRIMARY KEY, account_address text NOT NULL, status text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_world_id_requests (
      request_id text PRIMARY KEY, rater_id text NOT NULL, status text NOT NULL, expires_at timestamptz NOT NULL
    );
    CREATE TABLE tokenless_payout_eligibility (
      rater_id text PRIMARY KEY, payout_account text NOT NULL
    );
    CREATE TABLE tokenless_paid_vouchers (
      voucher_id text PRIMARY KEY, rater_id text NOT NULL
    );
    CREATE TABLE tokenless_assurance_assignments (
      assignment_id text PRIMARY KEY, reviewer_account_address text NOT NULL, paid_assignment boolean NOT NULL,
      status text NOT NULL, reservation_expires_at timestamptz NOT NULL
    );
  `);
  return database;
}

function apply0117(database: ReturnType<typeof newDb>) {
  for (const statement of migration
    .split("--> statement-breakpoint")
    .map(value => value.trim())
    .filter(Boolean)) {
    database.public.none(statement);
  }
}

function seedResolvedRater(database: ReturnType<typeof newDb>) {
  database.public.none(`
    INSERT INTO tokenless_principals VALUES
      ('rlp_principal_a', 'active', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
    INSERT INTO tokenless_wallet_bindings VALUES
      ('binding_a', 'rlp_principal_a', 'payout', '0x1111111111111111111111111111111111111111',
       '2026-07-01T00:00:00Z', NULL);
    INSERT INTO tokenless_rater_profiles VALUES
      ('rater_a', '0x1111111111111111111111111111111111111111');
    INSERT INTO tokenless_eligibility_provider_handoffs VALUES
      ('state_a', '0x1111111111111111111111111111111111111111', 'verified', '2026-08-01T00:00:00Z');
    INSERT INTO tokenless_world_id_requests VALUES
      ('request_a', 'rater_a', 'verified', '2026-08-01T00:00:00Z');
    INSERT INTO tokenless_payout_eligibility VALUES
      ('rater_a', '0x1111111111111111111111111111111111111111');
    INSERT INTO tokenless_paid_vouchers VALUES ('voucher_a', 'rater_a');
    INSERT INTO tokenless_assurance_assignments VALUES
      ('assignment_a', '0x1111111111111111111111111111111111111111', true, 'accepted', '2026-08-01T00:00:00Z');
  `);
}

test("0117 binds rater identity to principal-owned payout wallets", () => {
  assert.match(migration, /CREATE TABLE "tokenless_payout_wallet_ownership"/u);
  assert.match(migration, /WHERE binding\."purpose" = 'payout'/u);
  assert.match(
    migration,
    /UPDATE "tokenless_rater_profiles"\s+SET "principal_id" = ownership\."principal_id"\s+FROM "tokenless_payout_wallet_ownership" ownership/u,
  );
  assert.match(migration, /SET "account_address" = lower\(active\."wallet_address"\)/u);
  assert.match(migration, /active\."purpose" = 'payout' AND active\."revoked_at" IS NULL/u);
  assert.match(
    migration,
    /tokenless_rater_profiles_lifecycle_check[\s\S]*"principal_id" IS NULL[\s\S]*"deletion_receipt_hash"/u,
  );
  assert.match(migration, /CONSTRAINT "tokenless_rater_profiles_principal_unique" UNIQUE\("principal_id"\)/u);
  assert.match(migration, /ADD COLUMN "payout_account_snapshot" text/u);
  assert.match(migration, /"paid_assignment" = true/u);
  assert.equal(journal.entries.find(entry => entry.idx === 117)?.tag, "0117_principal_bound_rater_identity");
});

test("0117 keeps update targets unaliased and joined sources derived for test-database compatibility", () => {
  assert.doesNotMatch(migration, /UPDATE "[^"]+"\s+[a-z][a-z0-9_]*\s+SET/iu);
  assert.match(
    migration,
    /UPDATE "tokenless_assurance_assignments"[\s\S]*FROM \([\s\S]*JOIN "tokenless_payout_eligibility" payout[\s\S]*\) resolved/u,
  );
});

test("0117 executes in pg-mem and snapshots accepted paid work without changing the rater", () => {
  const database = migrationFixture();
  seedResolvedRater(database);
  apply0117(database);
  assert.deepEqual(
    database.public.one("SELECT rater_id, principal_id, account_address FROM tokenless_rater_profiles"),
    {
      rater_id: "rater_a",
      principal_id: "rlp_principal_a",
      account_address: "0x1111111111111111111111111111111111111111",
    },
  );
  assert.deepEqual(
    database.public.one("SELECT rater_id, payout_account_snapshot FROM tokenless_assurance_assignments"),
    { rater_id: "rater_a", payout_account_snapshot: "0x1111111111111111111111111111111111111111" },
  );
  assert.equal(
    database.public.one("SELECT payout_account_snapshot FROM tokenless_paid_vouchers").payout_account_snapshot,
    "0x1111111111111111111111111111111111111111",
  );
});

test("0117 fails closed for unresolved active profiles and historic cross-principal payout-wallet reuse", () => {
  assert.match(
    migration,
    /tokenless_rater_profiles_lifecycle_check[\s\S]*"principal_id" IS NOT NULL[\s\S]*OR[\s\S]*"principal_id" IS NULL[\s\S]*"deletion_receipt_hash"/u,
  );

  const relinked = migrationFixture();
  relinked.public.none(`
    INSERT INTO tokenless_principals VALUES
      ('rlp_a', 'active', NOW(), NOW()), ('rlp_b', 'active', NOW(), NOW());
    INSERT INTO tokenless_wallet_bindings VALUES
      ('binding_a', 'rlp_a', 'payout', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NOW(), NOW()),
      ('binding_b', 'rlp_b', 'payout', '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NOW(), NULL);
  `);
  assert.throws(() => apply0117(relinked), /duplicate|unique|primary key/iu);
});
