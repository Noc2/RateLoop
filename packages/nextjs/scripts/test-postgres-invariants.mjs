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

async function dsaNullableDisjunctionChecks(client) {
  const digest = `sha256:${"1".repeat(64)}`;
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TEMP TABLE dsa_decision_fact_null_probe
         (LIKE tokenless_dsa_content_moderation_decision_facts INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const factInsert = overrides => ({
      text: `INSERT INTO dsa_decision_fact_null_probe
        (workspace_id,provider_decision_id,decision_version,schema_version,measure_taken,moderation_measure_id,
         origin,automation_processing,expected_evaluation_count,evaluation_set_root,article16_notice_id,notifier_class,
         language_codes_json,no_language_reason,fact_json,fact_hash,
         created_by,created_at)
       VALUES ('ws_dsa_null_probe',$1,1,'rateloop.dsa-part8-content-moderation-decision.v3',true,$2,
               $3,$4,$5,$6,$7,$8,$9,$10,'{}',$11,'principal:ci',clock_timestamp())`,
      values: [
        overrides.decisionId,
        overrides.measureId,
        overrides.origin,
        overrides.automation,
        overrides.expectedEvaluationCount,
        overrides.evaluationSetRoot,
        overrides.noticeId,
        overrides.notifierClass,
        overrides.languageCodes,
        overrides.noLanguageReason,
        digest,
      ],
    });
    const valid = {
      decisionId: "decision_null_probe",
      measureId: "measure_null_probe_00000001",
      origin: "own_initiative",
      automation: "solely_automated",
      noticeId: null,
      notifierClass: null,
      expectedEvaluationCount: 1,
      evaluationSetRoot: digest,
      languageCodes: '["en"]',
      noLanguageReason: null,
    };
    for (const [name, change] of [
      ["notice", { origin: "article16_notice", noticeId: "notice_null_probe_00000001", notifierClass: null }],
      ["automation", { automation: "not_automated", expectedEvaluationCount: 1 }],
      ["language", { languageCodes: "[]", noLanguageReason: null }],
    ]) {
      await client.query(`SAVEPOINT dsa_${name}_null_probe`);
      await expectPostgresError(
        client,
        factInsert({
          ...valid,
          ...change,
          decisionId: `${valid.decisionId}_${name}`,
          measureId: `${valid.measureId}_${name}`,
        }),
        "23514",
      );
      await client.query(`ROLLBACK TO SAVEPOINT dsa_${name}_null_probe`);
    }

    await client.query(
      `CREATE TEMP TABLE dsa_projection_null_probe
         (LIKE tokenless_dsa_reference_decision_projections INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    await expectPostgresError(
      client,
      {
        text: `INSERT INTO dsa_projection_null_probe
          (workspace_id,epoch_id,population_id,population_version,provider_decision_id,decision_version,
           engagement_id,engagement_version,source_decision_binding,source_decision_hash,engagement_hash,
           measure_taken,moderation_measure_id,part8_fact_json,part8_fact_hash,origin,article16_notice_id,
           notifier_class,decision_at,source_eligibility_status,source_exclusion_reason,automation_processing,
           expected_evaluation_count,evaluation_set_root,language_codes_json,no_language_reason,disposition,
           projection_json,projection_hash)
         VALUES ('ws_dsa_null_probe','rse_${"2".repeat(40)}','population_null_probe',1,'decision_projection_probe',1,
                 'engagement_projection_probe',1,$1,$1,$1,true,'measure_projection_probe_00000001','{}',$1,
                 'own_initiative',NULL,NULL,clock_timestamp(),'excluded',NULL,'solely_automated',
                 1,$1,'["en"]',NULL,'excluded','{}',$1)`,
        values: [digest],
      },
      "23514",
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaBeaconUsesLateCommitClock(client) {
  await client.query(
    `CREATE TEMP TABLE dsa_beacon_commit_clock_probe
       (beacon_available_at timestamp with time zone NOT NULL)`,
  );
  await client.query(
    `CREATE CONSTRAINT TRIGGER dsa_beacon_commit_clock_probe_guard
       AFTER INSERT ON dsa_beacon_commit_clock_probe
       DEFERRABLE INITIALLY DEFERRED
       FOR EACH ROW EXECUTE FUNCTION tokenless_guard_dsa_reference_beacon_lead_at_commit()`,
  );
  await client.query("BEGIN");
  try {
    const inserted = await client.query(
      `INSERT INTO dsa_beacon_commit_clock_probe(beacon_available_at)
       VALUES (transaction_timestamp() + interval '5 minutes 250 milliseconds')
       RETURNING beacon_available_at >= transaction_timestamp() + interval '5 minutes' AS old_clock_passes`,
    );
    assert.equal(inserted.rows[0]?.old_clock_passes, true, "The stale transaction clock should pass the old guard.");
    await client.query("SELECT pg_sleep(0.4)");
    await expectPostgresError(client, "COMMIT", "23514");
  } finally {
    await client.query("ROLLBACK");
    await client.query("DROP TABLE IF EXISTS dsa_beacon_commit_clock_probe");
  }
}

async function projectWindowAccessRequiresTerminalSnapshot(client) {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const eventId = `pwae_${"a".repeat(22)}`;
  const accessId = `pwca_${"b".repeat(22)}`;
  const digest = `sha256:${"c".repeat(64)}`;
  const event = {
    text: `INSERT INTO tokenless_project_window_compliance_share_access_events
      (event_id,access_id,idempotency_key,request_binding_hash,share_lookup_hash,token_lookup_hash,
       result,denial_reason,occurred_at,event_json,event_hash)
     VALUES ($1,$2,'pg-invariant-denial',$3,$3,$3,'denied','not_found',$4,'{}',$3)`,
    values: [eventId, accessId, digest, now],
  };

  await client.query("BEGIN");
  try {
    await client.query(event);
    await expectPostgresError(
      client,
      "SET CONSTRAINTS tokenless_project_window_access_terminal_at_commit IMMEDIATE",
      "23514",
    );
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(event);
    await client.query(
      `INSERT INTO tokenless_project_window_compliance_share_access_snapshots
        (access_id,idempotency_key,share_lookup_hash,token_lookup_hash,request_binding_hash,
         event_id,event_hash,result,denial_reason,response_json,response_hash,occurred_at)
       VALUES ($1,'pg-invariant-denial',$2,$2,$2,$3,$2,'denied','not_found',NULL,NULL,$4)`,
      [accessId, digest, eventId, now],
    );
    await client.query(
      "SET CONSTRAINTS tokenless_project_window_access_terminal_at_commit, tokenless_project_window_access_exact_at_commit IMMEDIATE",
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function runPostgresInvariantTests(databaseUrl = process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: localTestDatabaseUrl(databaseUrl),
    connectionTimeoutMillis: 10_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await prepaidReferenceUniquenessAndRollback(client);
    await projectAccessPartialUniquenessAndChecks(client);
    await signingLedgerTerminalPartialUniqueness(client);
    await dsaNullableDisjunctionChecks(client);
    await dsaBeaconUsesLateCommitClock(client);
    await projectWindowAccessRequiresTerminalSnapshot(client);
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
