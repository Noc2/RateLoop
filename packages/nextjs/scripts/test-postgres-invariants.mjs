import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

function localTestDatabaseUrl(rawUrl) {
  if (!rawUrl || rawUrl === "memory:") {
    throw new Error("DATABASE_URL must identify the migrated local PostgreSQL test database.");
  }
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("PostgreSQL invariant tests require a postgres:// or postgresql:// DATABASE_URL.");
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("PostgreSQL invariant tests refuse non-local database hosts.");
  }
  if (!/^\/rateloop_(?:ci|e2e|test)(?:_|$)/u.test(url.pathname)) {
    throw new Error("PostgreSQL invariant tests require a rateloop_ci_*, rateloop_e2e*, or rateloop_test* database.");
  }
  return url.toString();
}

async function expectPostgresError(client, input, code) {
  let actual = null;
  try {
    await client.query(input);
  } catch (error) {
    actual = error;
  }
  assert.ok(actual, `Expected PostgreSQL error ${code}.`);
  assert.equal(actual.code, code);
}

async function prepaidReferenceUniquenessAndRollback(client) {
  const now = new Date("2026-07-29T18:00:00.000Z");
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO tokenless_workspaces
         (workspace_id,name,status,created_at,updated_at)
       VALUES ('ws_pg_invariant_refund','Postgres invariant fixture','active',$1,$1)`,
      [now],
    );

    await client.query("SAVEPOINT rollback_probe");
    await client.query(
      `INSERT INTO tokenless_prepaid_ledger_entries
         (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
       VALUES ('ledger_pg_rolled_back','ws_pg_invariant_refund','-1000000','settled',
               'fiat_topup_reversal','stripe_reversal:rollback_probe',$1,$1)`,
      [now],
    );
    await client.query("ROLLBACK TO SAVEPOINT rollback_probe");
    const rolledBack = await client.query(
      "SELECT 1 FROM tokenless_prepaid_ledger_entries WHERE entry_id='ledger_pg_rolled_back'",
    );
    assert.equal(rolledBack.rowCount, 0, "ROLLBACK TO SAVEPOINT must remove the ledger write.");

    await client.query(
      `INSERT INTO tokenless_prepaid_ledger_entries
         (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
       VALUES ('ledger_pg_refund_one','ws_pg_invariant_refund','-1000000','settled',
               'fiat_topup_reversal','stripe_reversal:unique_probe',$1,$1)`,
      [now],
    );
    await client.query("SAVEPOINT uniqueness_probe");
    await expectPostgresError(
      client,
      {
        text: `INSERT INTO tokenless_prepaid_ledger_entries
                 (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
               VALUES ('ledger_pg_refund_two','ws_pg_invariant_refund','-2000000','settled',
                       'fiat_topup_reversal','stripe_reversal:unique_probe',$1,$1)`,
        values: [now],
      },
      "23505",
    );
    await client.query("ROLLBACK TO SAVEPOINT uniqueness_probe");
    const retained = await client.query(
      "SELECT entry_id FROM tokenless_prepaid_ledger_entries WHERE external_reference='stripe_reversal:unique_probe'",
    );
    assert.deepEqual(retained.rows, [{ entry_id: "ledger_pg_refund_one" }]);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function projectAccessPartialUniquenessAndChecks(client) {
  const now = new Date("2026-07-29T18:05:00.000Z");
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO tokenless_workspaces
         (workspace_id,name,status,created_at,updated_at)
       VALUES ('ws_pg_invariant_access','Postgres invariant fixture','active',$1,$1)`,
      [now],
    );
    await client.query(
      `INSERT INTO tokenless_assurance_projects
         (project_id,workspace_id,name,description,data_classification,status,retention_days,
          created_by,created_at,updated_at)
       VALUES ('project_pg_invariant_access','ws_pg_invariant_access','Invariant project',NULL,
               'synthetic','active',30,'principal:ci',$1,$1)`,
      [now],
    );
    const assignment = (id, status) => ({
      text: `INSERT INTO tokenless_project_access_assignments
               (assignment_id,workspace_id,project_id,subject_kind,subject_reference,role,status,
                expires_at,granted_by,reason,created_at,revoked_at,revoked_by)
             VALUES ($1,'ws_pg_invariant_access','project_pg_invariant_access','principal',
                     'principal:auditor','auditor',$2,NULL,'principal:ci','CI invariant',$3::timestamptz,
                     CASE WHEN $2='revoked' THEN $3::timestamptz ELSE NULL END,
                     CASE WHEN $2='revoked' THEN 'principal:ci' ELSE NULL END)`,
      values: [id, status, now],
    });
    await client.query(assignment("access_pg_revoked_one", "revoked"));
    await client.query(assignment("access_pg_revoked_two", "revoked"));
    await client.query(assignment("access_pg_active_one", "active"));

    await client.query("SAVEPOINT active_uniqueness_probe");
    await expectPostgresError(client, assignment("access_pg_active_two", "active"), "23505");
    await client.query("ROLLBACK TO SAVEPOINT active_uniqueness_probe");

    await client.query("SAVEPOINT role_check_probe");
    await expectPostgresError(
      client,
      {
        ...assignment("access_pg_invalid_role", "revoked"),
        text: assignment("access_pg_invalid_role", "revoked").text.replace("'auditor',$2", "'owner',$2"),
      },
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT role_check_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function signingLedgerTerminalPartialUniqueness(client) {
  const now = new Date("2026-07-29T18:10:00.000Z");
  const attemptedEvent = `sig_evt_${"1".repeat(32)}`;
  const succeededEvent = `sig_evt_${"2".repeat(32)}`;
  const failedEvent = `sig_evt_${"3".repeat(32)}`;
  const attemptId = `sig_att_${"4".repeat(32)}`;
  const digest = `0x${"5".repeat(64)}`;
  const signatureHash = `0x${"6".repeat(64)}`;
  const common = [attemptId, "keeper", "test-provider", "test-key", digest, "raw_hash", now];
  await client.query("BEGIN");
  try {
    await client.query(
      `INSERT INTO tokenless_evm_signing_ledger
         (event_id,attempt_id,outcome,signer_role,provider,key_id,digest,purpose,
          provider_request_id,error_class,retryable,signature_hash,transaction_hash,
          started_at,completed_at,recorded_at)
       VALUES ($1,$2,'attempted',$3,$4,$5,$6,$7,NULL,NULL,NULL,NULL,NULL,$8,NULL,$8)`,
      [attemptedEvent, ...common],
    );
    await client.query(
      `INSERT INTO tokenless_evm_signing_ledger
         (event_id,attempt_id,outcome,signer_role,provider,key_id,digest,purpose,
          provider_request_id,error_class,retryable,signature_hash,transaction_hash,
          started_at,completed_at,recorded_at)
       VALUES ($1,$2,'succeeded',$3,$4,$5,$6,$7,'request-ci',NULL,NULL,$8,NULL,$9,$9,$9)`,
      [succeededEvent, ...common.slice(0, 6), signatureHash, now],
    );

    await client.query("SAVEPOINT terminal_uniqueness_probe");
    await expectPostgresError(
      client,
      {
        text: `INSERT INTO tokenless_evm_signing_ledger
                 (event_id,attempt_id,outcome,signer_role,provider,key_id,digest,purpose,
                  provider_request_id,error_class,retryable,signature_hash,transaction_hash,
                  started_at,completed_at,recorded_at)
               VALUES ($1,$2,'failed',$3,$4,$5,$6,$7,NULL,'outage',true,NULL,NULL,$8,$8,$8)`,
        values: [failedEvent, ...common],
      },
      "23505",
    );
    await client.query("ROLLBACK TO SAVEPOINT terminal_uniqueness_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function runPostgresInvariantTests(databaseUrl = process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: localTestDatabaseUrl(databaseUrl), max: 1 });
  const client = await pool.connect();
  try {
    await prepaidReferenceUniquenessAndRollback(client);
    await projectAccessPartialUniquenessAndChecks(client);
    await signingLedgerTerminalPartialUniqueness(client);
  } finally {
    client.release();
    await pool.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runPostgresInvariantTests()
    .then(() => console.log("PostgreSQL rollback and uniqueness invariants passed."))
    .catch(error => {
      console.error(error instanceof Error ? error.message : "PostgreSQL invariant tests failed.");
      process.exitCode = 1;
    });
}
