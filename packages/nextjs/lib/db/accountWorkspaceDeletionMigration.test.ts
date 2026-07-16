import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DataType, newDb } from "pg-mem";

const MIGRATION_BREAKPOINT = "--> statement-breakpoint";
const migration = readFileSync(join(process.cwd(), "drizzle", "0053_account_workspace_deletion.sql"), "utf8");

function applyMigration(database: ReturnType<typeof newDb>) {
  for (const statement of migration
    .split(MIGRATION_BREAKPOINT)
    .map(part => part.trim())
    .filter(Boolean)) {
    database.public.none(statement);
  }
}

function createLegacyDatabase() {
  const database = newDb();
  database.public.registerOperator({
    operator: "~",
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value, pattern) => new RegExp(pattern).test(value),
  });
  database.public.none(`
    CREATE TABLE tokenless_workspaces (
      workspace_id text PRIMARY KEY,
      status text NOT NULL
    );
    CREATE TABLE tokenless_subject_requests (
      request_id text PRIMARY KEY
    );
    CREATE TABLE tokenless_public_question_media (
      asset_id text PRIMARY KEY,
      technical_status text NOT NULL
    );
    INSERT INTO tokenless_workspaces (workspace_id, status) VALUES ('ws_1', 'active');
    INSERT INTO tokenless_subject_requests (request_id) VALUES ('dsr_1');
    INSERT INTO tokenless_public_question_media (asset_id, technical_status) VALUES ('asset_1', 'ready');
  `);
  return database;
}

test("0053 stores deletion lifecycle evidence as opaque references and digests", () => {
  assert.match(migration, /ALTER TABLE "tokenless_workspaces"\s+ADD COLUMN "deleted_at"/);
  assert.match(migration, /ALTER TABLE "tokenless_public_question_media"\s+ADD COLUMN "deletion_requested_at"/);
  assert.match(migration, /tokenless_public_question_media_deletion_idx/);
  assert.match(migration, /CREATE TABLE "tokenless_deletion_jobs"/);
  assert.match(migration, /"scope_kind" IN \('account','workspace'\)/);
  assert.match(migration, /REFERENCES "tokenless_subject_requests"\("request_id"\) ON DELETE RESTRICT/);
  assert.match(migration, /CREATE TABLE "tokenless_deletion_job_categories"/);
  assert.match(migration, /"disposition" IN \('erase','anonymize','retain','public_chain'\)/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /tokenless_deletion_jobs_due_status_idx/);
  assert.match(migration, /tokenless_deletion_jobs_scope_idx/);
  assert.match(migration, /tokenless_deletion_job_categories_status_idx/);

  const jobTable = migration.slice(
    migration.indexOf('CREATE TABLE "tokenless_deletion_jobs"'),
    migration.indexOf('CREATE UNIQUE INDEX "tokenless_deletion_jobs_active_scope_unique"'),
  );
  assert.doesNotMatch(jobTable, /REFERENCES "tokenless_(?:workspaces|principals)"/);
  assert.doesNotMatch(
    migration,
    /"(?:email|wallet_address|name|reason|evidence_json|details_json|payload_json|metadata_json)"/,
  );
});

test("0053 enforces job and category state while retaining durable completion receipts", () => {
  const database = createLegacyDatabase();
  applyMigration(database);

  assert.deepEqual(
    database.public.one(`
      SELECT deleted_at FROM tokenless_workspaces WHERE workspace_id = 'ws_1'
    `),
    { deleted_at: null },
  );
  assert.deepEqual(
    database.public.one(`
      SELECT deletion_requested_at FROM tokenless_public_question_media WHERE asset_id = 'asset_1'
    `),
    { deletion_requested_at: null },
  );

  database.public.none(`
    INSERT INTO tokenless_deletion_jobs (
      job_id, scope_kind, scope_id, subject_request_id, requested_by,
      status, due_at, requested_at
    ) VALUES (
      'del_1', 'account', 'rlp_opaque_subject', 'dsr_1', 'rlp_opaque_subject',
      'pending', '2026-08-16T00:00:00Z', '2026-07-16T00:00:00Z'
    );
    INSERT INTO tokenless_deletion_job_categories (
      job_id, category, disposition, status, created_at
    ) VALUES (
      'del_1', 'account_authentication', 'erase', 'pending', '2026-07-16T00:00:00Z'
    );
  `);

  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_deletion_jobs (
        job_id, scope_kind, scope_id, requested_by, status, due_at, requested_at
      ) VALUES (
        'del_duplicate', 'account', 'rlp_opaque_subject', 'rlp_opaque_subject',
        'pending', '2026-08-16T00:00:00Z', '2026-07-16T00:00:00Z'
      )
    `),
  );
  assert.throws(() =>
    database.public.none(`
      UPDATE tokenless_deletion_jobs
      SET status = 'completed', started_at = '2026-07-16T00:01:00Z',
          completed_at = '2026-07-16T00:02:00Z'
      WHERE job_id = 'del_1'
    `),
  );
  assert.throws(() =>
    database.public.none(`
      INSERT INTO tokenless_deletion_job_categories (
        job_id, category, disposition, status, basis_code, retention_deadline, created_at
      ) VALUES (
        'del_1', 'public_chain', 'public_chain', 'pending', 'public_record',
        '2027-07-16T00:00:00Z', '2026-07-16T00:00:00Z'
      )
    `),
  );

  database.public.none(`
    UPDATE tokenless_deletion_job_categories
    SET status = 'completed', started_at = '2026-07-16T00:01:00Z',
        completed_at = '2026-07-16T00:02:00Z', evidence_digest = '${"a".repeat(64)}'
    WHERE job_id = 'del_1' AND category = 'account_authentication';
    UPDATE tokenless_deletion_jobs
    SET status = 'completed', started_at = '2026-07-16T00:01:00Z',
        completed_at = '2026-07-16T00:03:00Z', receipt_digest = '${"b".repeat(64)}'
    WHERE job_id = 'del_1';
  `);

  assert.deepEqual(
    database.public.one(`
      SELECT status, receipt_digest FROM tokenless_deletion_jobs WHERE job_id = 'del_1'
    `),
    { receipt_digest: "b".repeat(64), status: "completed" },
  );

  database.public.none("DELETE FROM tokenless_deletion_jobs WHERE job_id = 'del_1'");
  assert.equal(database.public.many("SELECT * FROM tokenless_deletion_job_categories").length, 0);
});
