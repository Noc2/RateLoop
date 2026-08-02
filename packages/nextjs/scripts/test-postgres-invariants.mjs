import { dsaNamedPanelResponseEvidenceRoot } from "../lib/tokenless/dsaNamedPanelResponseRoot.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

async function dsaNamedPanelJsonAndResponseChecks(client) {
  const digest = `sha256:${"a".repeat(64)}`;
  const contentDigest = `sha256:${"b".repeat(64)}`;
  const payload = JSON.stringify({
    schemaVersion: "rateloop.dsa-blinded-case.v1",
    blindedCaseId: `dsa_case_${"c".repeat(40)}`,
    content: {
      artifactId: "artifact_dsa_projection",
      artifactVersion: 1,
      contentHash: contentDigest,
      contentType: "text/plain",
      language: "en",
    },
    policy: {
      categoryCode: "illegal_content",
      policyHash: digest,
      policyVersion: 1,
      question: "Does this content match the frozen policy definition?",
    },
    reference: {
      populationId: "population_dsa_projection",
      populationVersion: 1,
      frameId: "frame_dsa_projection",
      frameVersion: 1,
      sampleId: `rse_${"d".repeat(40)}`,
      sampleVersion: 1,
      position: 1,
    },
  });
  const createdAt = new Date("2030-01-01T00:00:00.000Z");
  const responseWindowMs = 72 * 60 * 60_000;
  const unitJson = JSON.stringify({
    schemaVersion: "rateloop.dsa-named-panel-unit.v1",
    workspaceId: "ws_dsa_projection",
    projectId: "project_dsa_projection",
    epochId: `rse_${"d".repeat(40)}`,
    unitId: "rsu_abcdefghijklmnopqrstuv",
    evaluationId: "evaluation_dsa_projection",
    runId: "run_dsa_projection",
    caseId: "case_dsa_projection",
    mappingCommitment: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
    withheldSnapshotDigest: digest,
    sourceEvidence: {
      providerDecisionId: "decision_dsa_projection",
      decisionVersion: 1,
      sourceDecisionHash: digest,
      engagementId: "engagement_dsa_projection",
      engagementVersion: 1,
      engagementHash: digest,
      transparencyPayloadVersion: null,
      transparencyPuid: null,
      transparencyPayloadHash: null,
      transparencyReceiptVersion: null,
      transparencyAttemptId: null,
      transparencyReceiptHash: null,
    },
    referenceDefinitionVersion: "1",
    referenceDefinitionHash: digest,
    requiredCefrLevel: "C1",
    requiredReviewerCount: 2,
    responseWindowMs,
    createdBy: "principal:ci",
    createdAt: createdAt.toISOString(),
  });
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TEMP TABLE dsa_named_unit_projection_probe
         (LIKE tokenless_dsa_named_panel_units INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const unitInsert = candidatePayload => ({
      text: `INSERT INTO dsa_named_unit_projection_probe
        (workspace_id,project_id,epoch_id,unit_id,population_id,population_version,frame_id,selection_rank,
         evaluation_id,provider_decision_id,decision_version,manifest_selected,source_decision_binding,
         source_evaluation_binding,source_evaluation_hash,system_identity,system_id,system_version,
         automated_outcome,evaluation_hash,evaluation_projection_hash,manifest_row_hash,run_id,case_id,
         baseline_artifact_id,candidate_artifact_id,variant_a_artifact_id,variant_b_artifact_id,
         blinding_commitment,blinded_case_id,blinded_payload_json,blinded_payload_hash,mapping_commitment,
         withheld_snapshot_digest,content_artifact_id,content_artifact_digest,content_type,language_tag,
         policy_category_code,required_cefr_level,required_reviewer_count,unit_json,unit_hash,created_by,created_at,
         source_engagement_id,source_engagement_version,source_engagement_hash,source_decision_hash,
         transparency_payload_version,transparency_puid,transparency_payload_hash,
         transparency_receipt_version,transparency_attempt_id,transparency_receipt_hash,
         reference_definition_version,reference_definition_hash,reference_definition_question,response_window_ms)
       VALUES ('ws_dsa_projection','project_dsa_projection','rse_${"d".repeat(40)}','rsu_abcdefghijklmnopqrstuv',
               'population_dsa_projection',1,'frame_dsa_projection',1,'evaluation_dsa_projection',
               'decision_dsa_projection',1,true,$1,$1,$1,'system-identity','system-id','system-version','fail',
               $1,$1,$1,'run_dsa_projection','case_dsa_projection','artifact_baseline','artifact_dsa_projection',
               'artifact_baseline','artifact_dsa_projection',$1,'dsa_case_${"c".repeat(40)}',$2,
               'sha256:'||encode(digest(convert_to($2,'UTF8'),'sha256'),'hex'),
               'sha256:'||encode(digest(convert_to($2,'UTF8'),'sha256'),'hex'),$1,
               'artifact_dsa_projection',$3,'text/plain','en','illegal_content','C1',2,$4,
               'sha256:'||encode(digest(convert_to($4,'UTF8'),'sha256'),'hex'),'principal:ci',$5,
               'engagement_dsa_projection',1,$1,$1,NULL,NULL,NULL,NULL,NULL,NULL,
               1,$1,'Does this content match the frozen policy definition?',$6)`,
      values: [digest, candidatePayload, contentDigest, unitJson, createdAt, responseWindowMs],
    });
    await client.query(unitInsert(payload));

    await client.query("SAVEPOINT named_payload_projection_probe");
    const mismatchedPayload = JSON.stringify({
      ...JSON.parse(payload),
      content: { ...JSON.parse(payload).content, contentHash: digest },
    });
    await expectPostgresError(client, unitInsert(mismatchedPayload), "23514");
    await client.query("ROLLBACK TO SAVEPOINT named_payload_projection_probe");

    await client.query("SAVEPOINT named_payload_extra_key_probe");
    const payloadWithWithheldKey = JSON.stringify({ ...JSON.parse(payload), providerIdentity: "hidden-provider" });
    await expectPostgresError(client, unitInsert(payloadWithWithheldKey), "23514");
    await client.query("ROLLBACK TO SAVEPOINT named_payload_extra_key_probe");

    await client.query(
      `CREATE TEMP TABLE dsa_named_reference_definition_probe
         (LIKE tokenless_dsa_named_panel_reference_definitions INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const definition = {
      schemaVersion: "rateloop.dsa-named-panel-reference-definition.v1",
      workspaceId: "ws_dsa_projection",
      projectId: "project_dsa_projection",
      epochId: `rse_${"d".repeat(40)}`,
      version: 1,
      question: "Does this content match the frozen policy definition?",
      standardId: "dsa_policy_standard",
      standardVersion: "2026-08",
      standardHash: digest,
      responsePolarity: { policyMatches: "fail", policyDoesNotMatch: "pass" },
      uncertaintyRule: "reviewers_binary_adjudicator_may_choose_uncertain",
      adjudicationRule: "qualified_non_panel_principal_required_on_disagreement",
      authorityKind: "project_auditor_without_workspace_membership",
      auditorAccessAssignmentId: "access_dsa_projection",
      createdBy: "principal:ci",
    };
    const definitionInsert = candidateDefinition => ({
      text: `INSERT INTO dsa_named_reference_definition_probe
        (workspace_id,project_id,epoch_id,version,question,standard_id,standard_version,standard_hash,
         authority_kind,auditor_access_assignment_id,definition_json,definition_hash,created_by,created_at)
       VALUES ('ws_dsa_projection','project_dsa_projection','rse_${"d".repeat(40)}',1,
               'Does this content match the frozen policy definition?','dsa_policy_standard','2026-08',$1,
               'project_auditor_without_workspace_membership','access_dsa_projection',$2,
               'sha256:'||encode(digest(convert_to($2,'UTF8'),'sha256'),'hex'),'principal:ci',$3)`,
      values: [digest, candidateDefinition, createdAt],
    });
    await client.query(definitionInsert(JSON.stringify(definition)));
    for (const [name, invalidDefinition] of [
      [
        "wrong_polarity",
        JSON.stringify({ ...definition, responsePolarity: { policyMatches: "pass", policyDoesNotMatch: "fail" } }),
      ],
      ["wrong_standard", JSON.stringify({ ...definition, standardVersion: "different" })],
      ["extra_key", JSON.stringify({ ...definition, providerIdentity: "hidden-provider" })],
    ]) {
      await client.query(`SAVEPOINT definition_${name}_probe`);
      await expectPostgresError(client, definitionInsert(invalidDefinition), "23514");
      await client.query(`ROLLBACK TO SAVEPOINT definition_${name}_probe`);
    }

    await client.query(
      `CREATE TEMP TABLE dsa_named_response_polarity_probe
         (LIKE tokenless_dsa_named_panel_response_evidence INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const responseAccessedAt = new Date("2030-01-01T01:00:00.000Z");
    const responseSubmittedAt = new Date("2030-01-01T01:05:00.000Z");
    const responseInsert = (assignmentId, responseId, responseChoice, derivedLabel, evidenceOverride = {}) => {
      const evidenceJson = JSON.stringify({
        schemaVersion: "rateloop.dsa-named-panel-response-evidence.v1",
        workspaceId: "ws_dsa_projection",
        epochId: `rse_${"d".repeat(40)}`,
        unitId: "rsu_abcdefghijklmnopqrstuv",
        assignmentId,
        reviewerPrincipalId: "principal:reviewer",
        responseId,
        responseDigest: digest,
        responseChoice,
        derivedLabel,
        accessId: "access_dsa_projection",
        accessedAt: responseAccessedAt.toISOString(),
        responseSubmittedAt: responseSubmittedAt.toISOString(),
        ...evidenceOverride,
      });
      return {
        text: `INSERT INTO dsa_named_response_polarity_probe
        (workspace_id,project_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,run_id,case_id,
         response_id,reviewer_key,reviewer_source,response_digest,response_validity,response_choice,derived_label,
         access_id,accessed_at,response_submitted_at,evidence_json,evidence_hash,observed_at)
       VALUES ('ws_dsa_projection','project_dsa_projection','rse_${"d".repeat(40)}','rsu_abcdefghijklmnopqrstuv',
               $1,'principal:reviewer','run_dsa_projection','case_dsa_projection',$2,'reviewer-key',
               'customer_invited',$3,'valid',$4,$5,'access_dsa_projection',$6,$7,
               $8,'sha256:'||encode(digest(convert_to($8,'UTF8'),'sha256'),'hex'),$7)`,
        values: [
          assignmentId,
          responseId,
          digest,
          responseChoice,
          derivedLabel,
          responseAccessedAt,
          responseSubmittedAt,
          evidenceJson,
        ],
      };
    };
    await client.query(responseInsert("assignment_candidate", "response_candidate", "candidate", "pass"));
    await client.query(responseInsert("assignment_baseline", "response_baseline", "baseline", "fail"));
    for (const [name, choice, label] of [
      ["candidate_fail", "candidate", "fail"],
      ["baseline_pass", "baseline", "pass"],
    ]) {
      await client.query(`SAVEPOINT response_${name}_probe`);
      await expectPostgresError(
        client,
        responseInsert(`assignment_${name}`, `response_${name}`, choice, label),
        "23514",
      );
      await client.query(`ROLLBACK TO SAVEPOINT response_${name}_probe`);
    }
    await client.query("SAVEPOINT response_json_projection_probe");
    await expectPostgresError(
      client,
      responseInsert("assignment_json", "response_json", "candidate", "pass", { responseChoice: "baseline" }),
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT response_json_projection_probe");

    await client.query(
      `CREATE TEMP TABLE dsa_named_artifact_access_projection_probe
         (LIKE tokenless_dsa_named_panel_artifact_accesses INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const accessInsert = (artifactDigest, suffix) => {
      const accessId = `access_dsa_projection_${suffix}`;
      const accessJson = JSON.stringify({
        schemaVersion: "rateloop.dsa-named-panel-access.v1",
        workspaceId: "ws_dsa_projection",
        projectId: "project_dsa_projection",
        epochId: `rse_${"d".repeat(40)}`,
        unitId: "rsu_abcdefghijklmnopqrstuv",
        assignmentId: "assignment_access",
        reviewerPrincipalId: "principal:reviewer",
        artifactId: "artifact_dsa_projection",
        artifactDigest,
        leaseId: "lease_dsa_projection",
        accessedAt: responseAccessedAt.toISOString(),
      });
      return {
        text: `INSERT INTO dsa_named_artifact_access_projection_probe
          (access_id,workspace_id,project_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,
           artifact_id,artifact_digest,lease_id,lease_expires_at,lease_revoked_at,access_json,access_hash,accessed_at)
         VALUES ($1,'ws_dsa_projection','project_dsa_projection','rse_${"d".repeat(40)}',
                 'rsu_abcdefghijklmnopqrstuv','assignment_access','principal:reviewer','artifact_dsa_projection',
                 $2,'lease_dsa_projection',$3,NULL,$4,
                 'sha256:'||encode(digest(convert_to($4,'UTF8'),'sha256'),'hex'),$5)`,
        values: [accessId, digest, new Date("2030-01-01T02:00:00.000Z"), accessJson, responseAccessedAt],
      };
    };
    await client.query(accessInsert(digest, "valid"));
    await client.query("SAVEPOINT access_json_projection_probe");
    await expectPostgresError(client, accessInsert(`sha256:${"f".repeat(64)}`, "mismatch"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT access_json_projection_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaReferenceProvenanceChecks(client) {
  const digest = `sha256:${"e".repeat(64)}`;
  const bridgeHash = `sha256:${"f".repeat(64)}`;
  const provenance = JSON.stringify({
    schemaVersion: "rateloop.benchmark-research-reference-provenance.v1",
    derivationSource: "independent_reference_panel",
    labelSetId: `rsls_${"1".repeat(40)}`,
    labelSetHash: digest,
    bridgeHash,
    reportingMode: "independent_reference_panel_research_only",
    populationClaim: false,
    operationalRollupEligible: false,
    adaptiveReuseAllowed: false,
  });
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TEMP TABLE dsa_reference_provenance_probe
         (LIKE tokenless_benchmark_research_approved_exports INCLUDING CONSTRAINTS)
       ON COMMIT DROP`,
    );
    const exportInsert = (exportId, candidateProvenance) => ({
      text: `INSERT INTO dsa_reference_provenance_probe
        (workspace_id,project_id,benchmark_id,activation_reference,deployment_key,export_id,schema_version,
         approval_id,approval_status,data_classification,activation_status,public_safe_only,derivation,epoch_id,
         commitment_digest,sample_digest,manifest_root,label_set_id,label_root,label_set_hash,audit_event_id,
         audit_event_digest,attestation_job_id,attestation_artifact_kind,attestation_artifact_digest,export_json,
         export_digest,approved_by,approved_at,reference_derivation_source,reference_bridge_hash,
         reference_network_bridge_hash,reference_named_panel_bridge_hash,reference_reporting_mode,
         reference_population_claim,reference_operational_rollup_eligible,reference_adaptive_reuse_allowed,
         reference_provenance_json,reference_provenance_hash)
       VALUES ('ws_dsa_provenance','project_dsa_provenance','benchmark_dsa_provenance','activation-dsa',
               'deployment-dsa',$1,'rateloop.approved-public-safe-reference-export.v1','approval-dsa',
               'approved_immutable','public_safe','active',true,'verified_committed_and_frozen_reference_sample',
               'rse_${"2".repeat(40)}',$2,$2,$2,'rsls_${"1".repeat(40)}',$2,$2,
               'audit_${"3".repeat(32)}',$2,'aat_${"4".repeat(40)}','audit_export_head',$2,'{}',
               'sha256:'||encode(digest(convert_to('{}','UTF8'),'sha256'),'hex'),'principal:ci',clock_timestamp(),
               'independent_reference_panel',$3,NULL,$3,'independent_reference_panel_research_only',
               false,false,false,$4,'sha256:'||encode(digest(convert_to($4,'UTF8'),'sha256'),'hex'))`,
      values: [exportId, digest, bridgeHash, candidateProvenance],
    });
    await client.query(exportInsert("export_valid", provenance));

    for (const [name, candidate] of [
      ["duplicate_keys", provenance.replace('{"schemaVersion":', '{"schemaVersion":"duplicate","schemaVersion":')],
      [
        "wrong_mode",
        JSON.stringify({
          ...JSON.parse(provenance),
          reportingMode: "descriptive_panel_vs_network_only",
        }),
      ],
    ]) {
      await client.query(`SAVEPOINT provenance_${name}_probe`);
      await expectPostgresError(client, exportInsert(`export_${name}`, candidate), "23514");
      await client.query(`ROLLBACK TO SAVEPOINT provenance_${name}_probe`);
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelReleaseGuardChecks(client) {
  const runUnique = await client.query(
    `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE conname='tokenless_dsa_named_panel_units_run_unique'`,
  );
  assert.match(runUnique.rows[0]?.definition ?? "", /UNIQUE \(workspace_id, project_id, run_id\)/u);
  const defaultValue = await client.query(
    `SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='tokenless_dsa_reference_label_sets'
        AND column_name='derivation_source'`,
  );
  assert.equal(defaultValue.rows[0]?.column_default, null);

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_units (workspace_id text,project_id text,epoch_id text,unit_id text,run_id text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_reference_definitions (workspace_id text,epoch_id text,created_by text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_workspace_members (workspace_id text,account_address text,role text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_project_access_assignments (workspace_id text,project_id text,subject_kind text,subject_reference text,role text,status text,expires_at timestamptz)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_assignments (workspace_id text,project_id text,run_id text,source text,selection text,reviewer_account_address text)",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_reviewer_independence_probe
       BEFORE INSERT ON tokenless_assurance_assignments FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_reviewer_independence()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws_guard','project_guard','epoch_guard','unit_guard','run_guard')",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws_guard','project_guard','epoch_guard','unit_expired','run_expired')",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_reference_definitions VALUES ('ws_guard','epoch_guard','principal:author')",
    );
    const assignment = reviewer => ({
      text: "INSERT INTO tokenless_assurance_assignments VALUES ('ws_guard','project_guard','run_guard','customer_invited','customer_named',$1)",
      values: [reviewer],
    });
    await client.query(assignment("principal:eligible"));
    await client.query("SAVEPOINT randomized_assignment_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_assurance_assignments VALUES ('ws_guard','project_guard','run_guard','customer_invited','randomized','principal:randomized')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT randomized_assignment_probe");
    await client.query("SAVEPOINT author_independence_probe");
    await expectPostgresError(client, assignment("principal:author"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT author_independence_probe");
    await client.query("INSERT INTO tokenless_workspace_members VALUES ('ws_guard','principal:owner','owner')");
    await client.query("SAVEPOINT owner_independence_probe");
    await expectPostgresError(client, assignment("principal:owner"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT owner_independence_probe");
    await client.query(
      "INSERT INTO tokenless_project_access_assignments VALUES ('ws_guard','project_guard','principal','principal:auditor','auditor','active',NULL)",
    );
    await client.query("SAVEPOINT project_independence_probe");
    await expectPostgresError(client, assignment("principal:auditor"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT project_independence_probe");

    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_selections (workspace_id text,project_id text,epoch_id text,unit_id text,reviewer_principal_id text,panel_deadline timestamptz)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_unit_outcomes (workspace_id text,epoch_id text,unit_id text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_adjudication_artifact_leases (workspace_id text,project_id text,epoch_id text,unit_id text,adjudicator_principal_id text)",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_selections VALUES ('ws_guard','project_guard','epoch_guard','unit_guard','principal:live',transaction_timestamp()+interval '1 hour')",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_selections VALUES ('ws_guard','project_guard','epoch_guard','unit_expired','principal:expired',transaction_timestamp()-interval '1 hour')",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_adjudication_artifact_leases VALUES ('ws_guard','project_guard','epoch_guard','unit_guard','principal:adjudicator')",
    );
    await client.query(
      `CREATE TRIGGER dsa_live_workspace_authority_probe
       BEFORE INSERT ON tokenless_workspace_members FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_live_authority_grant()`,
    );
    await client.query(
      `CREATE TRIGGER dsa_live_project_authority_probe
       BEFORE INSERT ON tokenless_project_access_assignments FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_live_authority_grant()`,
    );
    await client.query("SAVEPOINT live_workspace_grant_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_workspace_members VALUES ('ws_guard','principal:live','member')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT live_workspace_grant_probe");
    await client.query("SAVEPOINT live_project_grant_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_project_access_assignments VALUES ('ws_guard','project_guard','principal','principal:live','reviewer','active',NULL)",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT live_project_grant_probe");
    await client.query("SAVEPOINT adjudicator_workspace_grant_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_workspace_members VALUES ('ws_guard','principal:adjudicator','member')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT adjudicator_workspace_grant_probe");
    await client.query("SAVEPOINT adjudicator_project_grant_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_project_access_assignments VALUES ('ws_guard','project_guard','principal','principal:adjudicator','reviewer','active',NULL)",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT adjudicator_project_grant_probe");
    await client.query("SAVEPOINT expired_project_grant_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_project_access_assignments VALUES ('ws_guard','project_guard','principal','principal:expired','reviewer','active',NULL)",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT expired_project_grant_probe");
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_unit_outcomes VALUES ('ws_guard','epoch_guard','unit_expired')",
    );
    await client.query(
      "INSERT INTO tokenless_project_access_assignments VALUES ('ws_guard','project_guard','principal','principal:expired','reviewer','active',NULL)",
    );
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_reference_label_sets (workspace_id text,label_set_id text,epoch_id text,label_root text,set_hash text,derivation_source text)",
    );
    await client.query(
      `INSERT INTO tokenless_dsa_reference_label_sets VALUES
       ('ws_guard','labels_legacy','epoch_guard','root_legacy','hash_legacy','independent_reference_panel')`,
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_label_set_bridges (workspace_id text,label_set_id text,epoch_id text,label_root text,label_set_hash text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_reference_label_set_quarantines (workspace_id text,label_set_id text,epoch_id text,label_root text,label_set_hash text,reason text)",
    );
    await client.query(
      `INSERT INTO tokenless_dsa_reference_label_set_quarantines
         (workspace_id,label_set_id,epoch_id,label_root,label_set_hash,reason)
       SELECT workspace_id,label_set_id,epoch_id,label_root,set_hash,'legacy_pre_0182_unverified'
       FROM tokenless_dsa_reference_label_sets WHERE derivation_source='independent_reference_panel'`,
    );
    const seededUpgrade = await client.query(
      "SELECT reason FROM tokenless_dsa_reference_label_set_quarantines WHERE label_set_id='labels_legacy'",
    );
    assert.equal(seededUpgrade.rows[0]?.reason, "legacy_pre_0182_unverified");
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_part8_report_versions (workspace_id text,label_set_id text,epoch_id text,label_root text,label_set_hash text)",
    );
    await client.query(
      `CREATE TRIGGER dsa_part8_named_bridge_probe BEFORE INSERT ON tokenless_dsa_part8_report_versions
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_part8_independent_reference_panel()`,
    );
    await client.query(
      `CREATE TRIGGER dsa_named_bridge_quarantine_probe BEFORE INSERT ON tokenless_dsa_named_panel_label_set_bridges
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_quarantine_consumption()`,
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_benchmark_research_approved_exports (workspace_id text,label_set_id text,reference_derivation_source text,export_id text)",
    );
    await client.query(
      "INSERT INTO tokenless_benchmark_research_approved_exports VALUES ('ws_guard','labels_legacy','independent_reference_panel','export_legacy')",
    );
    await client.query("CREATE TEMP TABLE tokenless_benchmark_research_grants (workspace_id text,export_id text)");
    await client.query(
      `CREATE TRIGGER dsa_research_quarantine_probe BEFORE INSERT ON tokenless_benchmark_research_approved_exports
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_research_export_quarantine()`,
    );
    await client.query(
      `CREATE TRIGGER dsa_research_grant_quarantine_probe BEFORE INSERT ON tokenless_benchmark_research_grants
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_research_grant_quarantine()`,
    );
    await client.query("SAVEPOINT seeded_bridge_quarantine_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_dsa_named_panel_label_set_bridges VALUES ('ws_guard','labels_legacy','epoch_guard','root_legacy','hash_legacy')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT seeded_bridge_quarantine_probe");
    await client.query("SAVEPOINT seeded_research_quarantine_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_benchmark_research_approved_exports VALUES ('ws_guard','labels_legacy','independent_reference_panel','export_new')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT seeded_research_quarantine_probe");
    await client.query("SAVEPOINT seeded_research_grant_quarantine_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_benchmark_research_grants VALUES ('ws_guard','export_legacy')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT seeded_research_grant_quarantine_probe");
    await client.query(
      `INSERT INTO tokenless_dsa_reference_label_sets VALUES
       ('ws_guard','labels_guard','epoch_guard','root_guard','hash_guard','independent_reference_panel')`,
    );
    const report =
      "INSERT INTO tokenless_dsa_part8_report_versions VALUES ('ws_guard','labels_guard','epoch_guard','root_guard','hash_guard')";
    await client.query("SAVEPOINT missing_bridge_probe");
    await expectPostgresError(client, report, "23514");
    await client.query("ROLLBACK TO SAVEPOINT missing_bridge_probe");
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_label_set_bridges VALUES ('ws_guard','labels_guard','epoch_guard','root_guard','hash_guard')",
    );
    await client.query(
      "INSERT INTO tokenless_dsa_reference_label_set_quarantines VALUES ('ws_guard','labels_guard','epoch_guard','root_guard','hash_guard','legacy_pre_0182_unverified')",
    );
    await client.query("SAVEPOINT quarantine_probe");
    await expectPostgresError(client, report, "23514");
    await client.query("ROLLBACK TO SAVEPOINT quarantine_probe");
    await client.query("DELETE FROM tokenless_dsa_reference_label_set_quarantines WHERE label_set_id='labels_guard'");
    await client.query(report);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelGapChecks(client) {
  const digest = `sha256:${"9".repeat(64)}`;
  const epochId = `rse_${"8".repeat(40)}`;
  const unitId = "rsu_gapcheckabcdefghijklmn";
  const assignmentDeadline = new Date("2030-01-01T00:00:00.000Z");
  const declaredAt = new Date("2030-01-02T00:00:00.000Z");
  const partialResponseRoot = `sha256:${createHash("sha256")
    .update("rateloop.dsa-named-panel-response-root.v1\0", "utf8")
    .digest("hex")}`;
  const gapEvidenceId = `dsapa_gap_${"7".repeat(40)}`;
  const gap = {
    schemaVersion: "rateloop.dsa-named-panel-unit-gap.v1",
    workspaceId: "ws_gap",
    projectId: "project_gap",
    epochId,
    unitId,
    gapEvidenceId,
    reason: "reviewer_nonresponse",
    referenceDefinitionVersion: 1,
    referenceDefinitionHash: digest,
    referenceDefinitionQuestion: "Does this content match the frozen policy definition?",
    requiredReviewerCount: 2,
    assignmentCount: 2,
    acceptedAssignmentCount: 0,
    responseCount: 0,
    accessCount: 1,
    assignmentDeadline: assignmentDeadline.toISOString(),
    partialResponseRoot,
    authorityKind: "project_auditor_without_workspace_membership",
    auditorAccessAssignmentId: "access_gap_auditor",
    declaredBy: "principal:gap-auditor",
    declaredAt: declaredAt.toISOString(),
  };
  const gapJson = JSON.stringify(gap);
  const gapHash = `sha256:${createHash("sha256").update(gapJson, "utf8").digest("hex")}`;
  const insert = (candidateDeclaredAt = declaredAt) => ({
    text: `INSERT INTO tokenless_dsa_named_panel_unit_gaps
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,gap_evidence_id,gap_reason,
       reference_definition_version,reference_definition_hash,reference_definition_question,required_reviewer_count,
       assignment_count,accepted_assignment_count,response_count,access_count,assignment_deadline,partial_response_root,authority_kind,
       auditor_access_assignment_id,gap_json,gap_hash,declared_by,declared_at,
       content_self_identification_report_count,content_self_identification_report_root)
     VALUES ('ws_gap','project_gap',$1,$2,'run_gap','case_gap',$3,$4,'reviewer_nonresponse',1,$3,
             'Does this content match the frozen policy definition?',2,2,0,0,1,$5,$6,
             'project_auditor_without_workspace_membership','access_gap_auditor',$7,$8,'principal:gap-auditor',$9,
             0,NULL)`,
    values: [
      epochId,
      unitId,
      digest,
      gapEvidenceId,
      assignmentDeadline,
      partialResponseRoot,
      gapJson,
      gapHash,
      candidateDeclaredAt,
    ],
  });
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_selections (workspace_id text,epoch_id text,unit_id text,reviewer_principal_id text,panel_deadline timestamptz)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_assignments (workspace_id text,epoch_id text,unit_id text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_response_evidence (workspace_id text,epoch_id text,unit_id text,assignment_id text,reviewer_principal_id text,response_id text,response_digest text,derived_label text,evidence_hash text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_artifact_accesses (workspace_id text,epoch_id text,unit_id text,assignment_id text)",
    );
    await client.query("CREATE TEMP TABLE tokenless_workspace_members (workspace_id text,account_address text)");
    await client.query(
      "CREATE TEMP TABLE tokenless_project_access_assignments (assignment_id text,workspace_id text,project_id text,subject_kind text,subject_reference text,role text,status text,expires_at timestamptz)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_unit_gaps (LIKE public.tokenless_dsa_named_panel_unit_gaps INCLUDING CONSTRAINTS) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_gap_probe BEFORE INSERT ON tokenless_dsa_named_panel_unit_gaps
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_unit_gap()`,
    );
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_selections VALUES
       ('ws_gap',$1,$2,'principal:reviewer-1',$3),('ws_gap',$1,$2,'principal:reviewer-2',$3)`,
      [epochId, unitId, assignmentDeadline],
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_artifact_accesses VALUES ('ws_gap',$1,$2,'assignment-1')",
      [epochId, unitId],
    );
    await client.query(
      `INSERT INTO tokenless_project_access_assignments VALUES
       ('access_gap_auditor','ws_gap','project_gap','principal','principal:gap-auditor','auditor','active',NULL)`,
    );
    await client.query("SAVEPOINT pending_gap_probe");
    await expectPostgresError(client, insert(new Date("2029-12-31T00:00:00.000Z")), "23514");
    await client.query("ROLLBACK TO SAVEPOINT pending_gap_probe");
    await client.query("INSERT INTO tokenless_workspace_members VALUES ('ws_gap','principal:gap-auditor')");
    await client.query("SAVEPOINT member_gap_probe");
    await expectPostgresError(client, insert(), "23514");
    await client.query("ROLLBACK TO SAVEPOINT member_gap_probe");
    await client.query("DELETE FROM tokenless_workspace_members");
    await client.query(insert());
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelSelectionChecks(client) {
  const digest = `sha256:${"a".repeat(64)}`;
  const epochId = `rse_${"5".repeat(40)}`;
  const unitId = "rsu_selectionabcdefghijkl";
  const selectedAt = new Date("2031-01-01T00:00:00.000Z");
  const acceptanceDeadline = new Date("2031-01-01T00:15:00.000Z");
  const responseWindowMs = 72 * 60 * 60_000;
  const panelDeadline = new Date(selectedAt.getTime() + responseWindowMs);
  const assignment = id => ({
    assignmentId: `assignment-${id}`,
    reviewerPrincipalId: `principal:selection-${id}`,
    assuranceSnapshotHash: `sha256:${id.repeat(64)}`,
  });
  const selectionInsert = (seat, overrides = {}) => {
    const values = {
      ...seat,
      status: "reserved",
      acceptanceDeadline,
      responseWindowMs,
      panelDeadline,
      selectedAt,
      ...overrides,
    };
    const snapshot = {
      schemaVersion: "rateloop.dsa-named-panel-selection.v1",
      workspaceId: "ws_selection",
      projectId: "project_selection",
      epochId,
      unitId,
      runId: "run_selection",
      caseId: "case_selection",
      mappingCommitment: digest,
      assignmentId: values.assignmentId,
      subpanelId: "subpanel_selection",
      cohortId: "cohort_selection",
      reviewerPrincipalId: values.reviewerPrincipalId,
      reviewerSource: "customer_invited",
      selection: "customer_named",
      statusAtSelection: "reserved",
      assuranceSnapshotHash: values.assuranceSnapshotHash,
      acceptanceDeadline: values.acceptanceDeadline.toISOString(),
      responseWindowMs: values.responseWindowMs,
      panelDeadline: values.panelDeadline.toISOString(),
      selectedAt: values.selectedAt.toISOString(),
    };
    const snapshotJson = JSON.stringify(snapshot);
    return {
      text: `INSERT INTO tokenless_dsa_named_panel_selections
        (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,assignment_id,subpanel_id,cohort_id,
         reviewer_principal_id,reviewer_source,selection,status_at_selection,assurance_snapshot_hash,acceptance_deadline,
         response_window_ms,panel_deadline,selection_snapshot_json,selection_snapshot_hash,selected_at,
         response_binding_required)
       VALUES ('ws_selection','project_selection',$1,$2,'run_selection','case_selection',$3,$4,
               'subpanel_selection','cohort_selection',$5,'customer_invited','customer_named','reserved',$6,$7,$8,$9,
               $10,'sha256:'||encode(digest(convert_to($10,'UTF8'),'sha256'),'hex'),$11,true)`,
      values: [
        epochId,
        unitId,
        digest,
        values.assignmentId,
        values.reviewerPrincipalId,
        values.assuranceSnapshotHash,
        values.acceptanceDeadline,
        values.responseWindowMs,
        values.panelDeadline,
        snapshotJson,
        values.selectedAt,
      ],
    };
  };
  const assignmentInsert = (seat, status = "reserved") => ({
    text: `INSERT INTO tokenless_assurance_assignments VALUES
      ('ws_selection','project_selection','run_selection',$1,'subpanel_selection','cohort_selection',$2,
       'customer_invited','customer_named',$3,$4,$5,$6)`,
    values: [
      seat.assignmentId,
      seat.reviewerPrincipalId,
      status,
      seat.assuranceSnapshotHash,
      acceptanceDeadline,
      selectedAt,
    ],
  });

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_units (workspace_id text,project_id text,epoch_id text,unit_id text,run_id text,required_reviewer_count integer,response_window_ms integer) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_assignments (workspace_id text,project_id text,run_id text,assignment_id text,subpanel_id text,cohort_id text,reviewer_account_address text,source text,selection text,status text,assurance_snapshot_hash text,reservation_expires_at timestamptz,created_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_selections (LIKE public.tokenless_dsa_named_panel_selections INCLUDING CONSTRAINTS) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_selection_probe BEFORE INSERT ON tokenless_dsa_named_panel_selections
       FOR EACH ROW EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_selection()`,
    );
    await client.query(
      `CREATE CONSTRAINT TRIGGER dsa_named_panel_reservation_probe
       AFTER INSERT ON tokenless_assurance_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_reservation_frozen()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws_selection','project_selection',$1,$2,'run_selection',2,$3)",
      [epochId, unitId, responseWindowMs],
    );

    const first = assignment("1");
    await client.query(assignmentInsert(first));
    await client.query(selectionInsert(first));
    await client.query("SET CONSTRAINTS dsa_named_panel_reservation_probe IMMEDIATE");
    await client.query("SET CONSTRAINTS dsa_named_panel_reservation_probe DEFERRED");

    const missing = assignment("2");
    await client.query("SAVEPOINT missing_selection_probe");
    await client.query(assignmentInsert(missing));
    await expectPostgresError(client, "SET CONSTRAINTS dsa_named_panel_reservation_probe IMMEDIATE", "23514");
    await client.query("ROLLBACK TO SAVEPOINT missing_selection_probe");

    const alreadyAccepted = assignment("3");
    await client.query("SAVEPOINT accepted_selection_probe");
    await client.query(assignmentInsert(alreadyAccepted, "accepted"));
    await expectPostgresError(client, selectionInsert(alreadyAccepted), "23514");
    await client.query("ROLLBACK TO SAVEPOINT accepted_selection_probe");

    await client.query("SAVEPOINT short_response_window_probe");
    await client.query(assignmentInsert(missing));
    await expectPostgresError(client, selectionInsert(missing, { panelDeadline: acceptanceDeadline }), "23514");
    await client.query("ROLLBACK TO SAVEPOINT short_response_window_probe");

    await client.query(assignmentInsert(missing));
    await client.query(selectionInsert(missing));
    await client.query("SET CONSTRAINTS dsa_named_panel_reservation_probe IMMEDIATE");
    await client.query("SET CONSTRAINTS dsa_named_panel_reservation_probe DEFERRED");

    const replacement = assignment("4");
    await client.query("SAVEPOINT replacement_probe");
    await client.query(assignmentInsert(replacement));
    await expectPostgresError(client, selectionInsert(replacement), "23514");
    await client.query("ROLLBACK TO SAVEPOINT replacement_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelResponseRootChecks(client) {
  const workspaceId = "ws_response_root";
  const epochId = `rse_${"6".repeat(40)}`;
  const unitId = "rsu_responseabcdefghijklmn";
  const rows = [
    ["assignment-a", "principal:a", "response-a", `sha256:${"1".repeat(64)}`, "fail", `sha256:${"2".repeat(64)}`],
    ["assignment-b", "principal:b", "response-b", `sha256:${"3".repeat(64)}`, "pass", `sha256:${"4".repeat(64)}`],
    ["assignment-c", "principal:c", "response-c", `sha256:${"5".repeat(64)}`, "fail", `sha256:${"6".repeat(64)}`],
  ];
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_response_evidence (workspace_id text,epoch_id text,unit_id text,assignment_id text,reviewer_principal_id text,response_id text,response_digest text,derived_label text,evidence_hash text) ON COMMIT DROP",
    );
    for (const count of [0, 1, 3]) {
      await client.query("TRUNCATE tokenless_dsa_named_panel_response_evidence");
      for (const row of rows.slice(0, count)) {
        await client.query(
          `INSERT INTO tokenless_dsa_named_panel_response_evidence
           (workspace_id,epoch_id,unit_id,assignment_id,reviewer_principal_id,response_id,response_digest,derived_label,evidence_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [workspaceId, epochId, unitId, ...row],
        );
      }
      const actual = await client.query("SELECT public.tokenless_dsa_named_panel_response_root($1,$2,$3) AS root", [
        workspaceId,
        epochId,
        unitId,
      ]);
      assert.equal(actual.rows[0]?.root, dsaNamedPanelResponseEvidenceRoot(rows.slice(0, count)));
    }
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelAdjudicationEvidenceChecks(client) {
  const digest = `sha256:${"b".repeat(64)}`;
  const epochId = `rse_${"4".repeat(40)}`;
  const unitId = "rsu_adjudicateabcdefghijk";
  const createdAt = new Date("2032-01-01T12:00:00.000Z");
  const accessedAt = new Date("2032-01-01T11:59:00.000Z");
  const qualificationExpiresAt = new Date("2032-02-01T00:00:00.000Z");
  const principalId = "principal:adjudication-evidence";
  const language = {
    key: "language:de:reading:cefr",
    value: "C1",
    source: "verified-language",
    assertedBy: "qualification-provider",
    verifiedAt: "2031-12-01T00:00:00.000Z",
    expiresAt: qualificationExpiresAt.toISOString(),
    evidenceReferenceHash: digest,
    evidenceVersion: "v1",
  };
  const category = {
    key: "dsa-policy-category:illegal_content",
    value: true,
    source: "verified-category",
    assertedBy: "qualification-provider",
    verifiedAt: "2031-12-01T00:00:00.000Z",
    expiresAt: qualificationExpiresAt.toISOString(),
    evidenceReferenceHash: digest,
    evidenceVersion: "v1",
  };
  const insert = ({ conflictOverride = {}, adjudicationOverride = {}, languageOverride = {} } = {}) => {
    const conflict = {
      schemaVersion: "rateloop.dsa-named-panel-adjudicator-conflict.v1",
      workspaceId: "ws_adjudication",
      epochId,
      unitId,
      adjudicatorPrincipalId: principalId,
      hasConflict: false,
      relationships: [],
      declaredAt: createdAt.toISOString(),
      ...conflictOverride,
    };
    const rationaleDigest = `sha256:${"c".repeat(64)}`;
    const adjudication = {
      schemaVersion: "rateloop.dsa-named-panel-adjudication.v1",
      workspaceId: "ws_adjudication",
      epochId,
      unitId,
      adjudicatorPrincipalId: principalId,
      artifactId: "artifact_adjudication",
      artifactLeaseId: "lease_adjudication",
      artifactAccessLogId: "log_adjudication",
      artifactAccessedAt: accessedAt.toISOString(),
      referenceLabel: "uncertain",
      rationaleDigest,
      createdAt: createdAt.toISOString(),
      ...adjudicationOverride,
    };
    const languageJson = JSON.stringify({ ...language, ...languageOverride });
    const categoryJson = JSON.stringify(category);
    const conflictJson = JSON.stringify(conflict);
    const adjudicationJson = JSON.stringify(adjudication);
    return {
      text: `INSERT INTO tokenless_dsa_named_panel_adjudications
        (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,adjudication_id,
         adjudicator_principal_id,reference_label,language_evidence_json,language_evidence_hash,
         category_competence_evidence_json,category_competence_evidence_hash,conflict_declaration_json,
         conflict_declaration_hash,qualification_expires_at,rationale_digest,adjudication_json,adjudication_hash,
         created_at,artifact_id,artifact_lease_id,artifact_access_log_id,artifact_accessed_at,
         adjudicator_label_binding)
       VALUES ('ws_adjudication','project_adjudication',$1,$2,'run_adjudication','case_adjudication',$3,
               'adjudication-evidence',$4,'uncertain',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
               'artifact_adjudication','lease_adjudication','log_adjudication',$16,$17)`,
      values: [
        epochId,
        unitId,
        digest,
        principalId,
        languageJson,
        `sha256:${createHash("sha256").update(languageJson).digest("hex")}`,
        categoryJson,
        `sha256:${createHash("sha256").update(categoryJson).digest("hex")}`,
        conflictJson,
        `sha256:${createHash("sha256").update(conflictJson).digest("hex")}`,
        qualificationExpiresAt,
        rationaleDigest,
        adjudicationJson,
        `sha256:${createHash("sha256").update(adjudicationJson).digest("hex")}`,
        createdAt,
        accessedAt,
        `hmac-sha256:v1:${"b".repeat(64)}`,
      ],
    };
  };

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_units (workspace_id text,project_id text,epoch_id text,unit_id text,language_tag text,required_cefr_level text,policy_category_code text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_adjudication_artifact_leases (workspace_id text,project_id text,epoch_id text,unit_id text,adjudicator_principal_id text,artifact_id text,lease_id text,qualification_expires_at timestamptz,issued_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_artifact_leases (lease_id text,workspace_id text,project_id text,artifact_id text,account_address text,purpose text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_access_logs (log_id text,workspace_id text,project_id text,artifact_id text,lease_id text,actor_kind text,action text,purpose text,occurred_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_unit_outcomes (workspace_id text,epoch_id text,unit_id text,agreement_state text,adjudication_id text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_adjudications (LIKE public.tokenless_dsa_named_panel_adjudications INCLUDING CONSTRAINTS) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_adjudication_evidence_probe
       BEFORE INSERT ON tokenless_dsa_named_panel_adjudications FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_adjudicator_artifact_access()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws_adjudication','project_adjudication',$1,$2,'de','B2','illegal_content')",
      [epochId, unitId],
    );
    await client.query(
      "INSERT INTO tokenless_assurance_artifact_leases VALUES ('lease_adjudication','ws_adjudication','project_adjudication','artifact_adjudication',$1,'dsa_named_panel_adjudication',$2,$3,NULL)",
      [principalId, new Date("2032-01-01T11:50:00.000Z"), qualificationExpiresAt],
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_adjudication_artifact_leases VALUES ('ws_adjudication','project_adjudication',$1,$2,$3,'artifact_adjudication','lease_adjudication',$4,$5)",
      [epochId, unitId, principalId, qualificationExpiresAt, new Date("2032-01-01T11:55:00.000Z")],
    );
    await client.query(
      "INSERT INTO tokenless_assurance_access_logs VALUES ('log_adjudication','ws_adjudication','project_adjudication','artifact_adjudication','lease_adjudication','principal','read','dsa_named_panel_adjudication',$1)",
      [accessedAt],
    );

    for (const [name, candidate] of [
      ["conflict_positive", insert({ conflictOverride: { hasConflict: true } })],
      ["unrelated_scope", insert({ adjudicationOverride: { workspaceId: "ws_other" } })],
      ["wrong_qualification", insert({ languageOverride: { key: "language:fr:reading:cefr" } })],
    ]) {
      await client.query(`SAVEPOINT adjudication_${name}_probe`);
      await expectPostgresError(client, candidate, "23514");
      await client.query(`ROLLBACK TO SAVEPOINT adjudication_${name}_probe`);
    }
    await client.query(insert());
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_unit_outcomes VALUES ('ws_adjudication',$1,$2,'adjudicated','adjudication-evidence')",
      [epochId, unitId],
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_reference_labels (workspace_id text,epoch_id text,unit_id text,agreement_state text,adjudicated_by text) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_reference_label_binding_probe
       BEFORE INSERT ON tokenless_dsa_reference_labels FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_reference_label_binding()`,
    );
    await client.query("SAVEPOINT wrong_adjudicator_label_binding_probe");
    await expectPostgresError(
      client,
      {
        text: "INSERT INTO tokenless_dsa_reference_labels VALUES ('ws_adjudication',$1,$2,'adjudicated',$3)",
        values: [epochId, unitId, `hmac-sha256:v1:${"c".repeat(64)}`],
      },
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT wrong_adjudicator_label_binding_probe");
    await client.query("INSERT INTO tokenless_dsa_reference_labels VALUES ('ws_adjudication',$1,$2,'adjudicated',$3)", [
      epochId,
      unitId,
      `hmac-sha256:v1:${"b".repeat(64)}`,
    ]);
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelAdjudicationLeaseClosureChecks(client) {
  const epochId = `rse_${"3".repeat(40)}`;
  const unitId = "rsu_leaseclosureabcdefghij";
  const principalId = "principal:lease-closure";
  const issuedAt = new Date("2033-01-01T00:00:00.000Z");
  const expiresAt = new Date("2033-01-01T01:00:00.000Z");
  const marker = leaseId => ({
    text: `INSERT INTO tokenless_dsa_named_panel_adjudication_artifact_leases
      (workspace_id,project_id,epoch_id,unit_id,adjudicator_principal_id,artifact_id,artifact_digest,lease_id,
       qualification_expires_at,issued_at)
     VALUES ('ws_lease','project_lease',$1,$2,$3,'artifact_lease',$4,$5,$6,$7)`,
    values: [epochId, unitId, principalId, `sha256:${"d".repeat(64)}`, leaseId, expiresAt, issuedAt],
  });
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_units (workspace_id text,project_id text,epoch_id text,unit_id text,content_artifact_id text,content_artifact_digest text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_artifact_leases (lease_id text,workspace_id text,project_id text,artifact_id text,account_address text,purpose text,assignment_id text,revoked_at timestamptz,expires_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_adjudications (workspace_id text,epoch_id text,unit_id text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_unit_outcomes (workspace_id text,epoch_id text,unit_id text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_selections (workspace_id text,epoch_id text,unit_id text,reviewer_principal_id text) ON COMMIT DROP",
    );
    await client.query("CREATE TEMP TABLE tokenless_workspace_members (workspace_id text,account_address text)");
    await client.query(
      "CREATE TEMP TABLE tokenless_project_access_assignments (workspace_id text,project_id text,subject_kind text,subject_reference text,status text,expires_at timestamptz)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_reference_definitions (workspace_id text,epoch_id text,created_by text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_workspace_reviewers (workspace_id text,principal_address text,status text)",
    );
    await client.query("CREATE TEMP TABLE tokenless_principals (principal_id text,status text)");
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_cohort_reviewers (reviewer_account_address text,project_id text,status text)",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_adjudication_artifact_leases (LIKE public.tokenless_dsa_named_panel_adjudication_artifact_leases INCLUDING CONSTRAINTS) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_lease_closure_probe
       BEFORE INSERT ON tokenless_dsa_named_panel_adjudication_artifact_leases FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_adjudication_artifact_lease()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_units VALUES ('ws_lease','project_lease',$1,$2,'artifact_lease',$3)",
      [epochId, unitId, `sha256:${"d".repeat(64)}`],
    );
    await client.query("INSERT INTO tokenless_principals VALUES ($1,'active')", [principalId]);
    await client.query("INSERT INTO tokenless_workspace_reviewers VALUES ('ws_lease',$1,'active')", [principalId]);
    await client.query("INSERT INTO tokenless_assurance_cohort_reviewers VALUES ($1,'project_lease','active')", [
      principalId,
    ]);
    for (const leaseId of ["lease-before-terminal", "lease-after-outcome", "lease-after-adjudication"]) {
      await client.query(
        "INSERT INTO tokenless_assurance_artifact_leases VALUES ($1,'ws_lease','project_lease','artifact_lease',$2,'dsa_named_panel_adjudication',NULL,NULL,$3)",
        [leaseId, principalId, expiresAt],
      );
    }
    await client.query(marker("lease-before-terminal"));
    await client.query("INSERT INTO tokenless_dsa_named_panel_unit_outcomes VALUES ('ws_lease',$1,$2)", [
      epochId,
      unitId,
    ]);
    await client.query("SAVEPOINT lease_after_outcome_probe");
    await expectPostgresError(client, marker("lease-after-outcome"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT lease_after_outcome_probe");
    await client.query("DELETE FROM tokenless_dsa_named_panel_unit_outcomes");
    await client.query("INSERT INTO tokenless_dsa_named_panel_adjudications VALUES ('ws_lease',$1,$2)", [
      epochId,
      unitId,
    ]);
    await client.query("SAVEPOINT lease_after_adjudication_probe");
    await expectPostgresError(client, marker("lease-after-adjudication"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT lease_after_adjudication_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaNamedPanelAssignmentResponseBindingChecks(client) {
  const constraints = await client.query(
    `SELECT conname,pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE conrelid='tokenless_dsa_named_panel_assignment_response_bindings'::regclass
     ORDER BY conname`,
  );
  const definitions = constraints.rows.map(row => String(row.definition)).join("\n");
  assert.match(
    definitions,
    /FOREIGN KEY \(response_id, run_id, case_id, reviewer_key, reviewer_source, response_digest, response_validity, response_choice, response_submitted_at\)/u,
  );
  assert.match(
    definitions,
    /FOREIGN KEY \(workspace_id, project_id, epoch_id, unit_id, run_id, case_id, assignment_id, reviewer_principal_id, response_binding_required, panel_deadline\)/u,
  );

  const deadline = new Date("2034-01-04T00:00:00.000Z");
  const submittedAt = new Date("2034-01-03T00:00:00.000Z");
  const binding = (responseId, candidateSubmittedAt = submittedAt) => ({
    text: `INSERT INTO tokenless_dsa_named_panel_assignment_response_bindings
      (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,assignment_id,reviewer_principal_id,
       response_binding_required,panel_deadline,response_id,reviewer_key,reviewer_source,response_digest,
       response_validity,response_choice,response_submitted_at,bound_at)
     VALUES ('ws_binding','project_binding','epoch_binding','unit_binding','run_binding','case_binding',
             'assignment_binding','principal:binding',true,$1,$2,'reviewer-key','customer_invited',$3,
             'valid','candidate',$4,$4)`,
    values: [deadline, responseId, `sha256:${"a".repeat(64)}`, candidateSubmittedAt],
  });
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_assignment_response_bindings (LIKE public.tokenless_dsa_named_panel_assignment_response_bindings INCLUDING ALL) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_response_binding_append_probe
       BEFORE UPDATE OR DELETE ON tokenless_dsa_named_panel_assignment_response_bindings FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_reject_dsa_named_panel_response_binding_mutation()`,
    );
    await client.query(binding("response-binding-valid"));
    const conflictingBinding = binding("response-binding-conflict");
    const conflictResult = await client.query({
      ...conflictingBinding,
      text: `${conflictingBinding.text}
             ON CONFLICT (workspace_id,epoch_id,unit_id,assignment_id,case_id) DO NOTHING`,
    });
    assert.equal(conflictResult.rowCount, 0, "An exact binding conflict must not replace stored evidence.");
    const preservedBinding = await client.query(
      "SELECT response_id FROM tokenless_dsa_named_panel_assignment_response_bindings",
    );
    assert.deepEqual(preservedBinding.rows, [{ response_id: "response-binding-valid" }]);
    await client.query("SAVEPOINT late_response_binding_probe");
    await expectPostgresError(client, binding("response-binding-late", new Date("2034-01-05T00:00:00.000Z")), "23514");
    await client.query("ROLLBACK TO SAVEPOINT late_response_binding_probe");
    await client.query("SAVEPOINT response_binding_mutation_probe");
    await expectPostgresError(
      client,
      "UPDATE tokenless_dsa_named_panel_assignment_response_bindings SET response_choice='baseline'",
      "55000",
    );
    await client.query("ROLLBACK TO SAVEPOINT response_binding_mutation_probe");
    await client.query("TRUNCATE tokenless_dsa_named_panel_assignment_response_bindings");
    const legacySubmittedAt = new Date("2020-01-01T00:00:00.000Z");
    const legacyDeadline = new Date("2020-01-02T00:00:00.000Z");
    const legacyInsert = boundAtSql => ({
      text: `INSERT INTO tokenless_dsa_named_panel_assignment_response_bindings
        (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,assignment_id,reviewer_principal_id,
         response_binding_required,panel_deadline,response_id,reviewer_key,reviewer_source,response_digest,
         response_validity,response_choice,response_submitted_at${boundAtSql ? ",bound_at" : ""})
       VALUES ('ws_legacy_binding','project_legacy_binding','epoch_legacy_binding','unit_legacy_binding',
               'run_legacy_binding','case_legacy_binding','assignment_legacy_binding','principal:legacy-binding',
               false,$1,'response-legacy-binding','reviewer-key-legacy','customer_invited',$2,
               'valid','baseline',$3${boundAtSql ? `,${boundAtSql}` : ""})`,
      values: [legacyDeadline, `sha256:${"b".repeat(64)}`, legacySubmittedAt],
    });
    await client.query(legacyInsert(null));
    const legacyStored = await client.query(
      `SELECT response_binding_required,response_submitted_at,bound_at
       FROM tokenless_dsa_named_panel_assignment_response_bindings`,
    );
    assert.equal(legacyStored.rows[0]?.response_binding_required, false);
    assert.ok(
      new Date(legacyStored.rows[0]?.bound_at).getTime() >
        new Date(legacyStored.rows[0]?.response_submitted_at).getTime(),
      "A legacy repair must record its later database binding time.",
    );
    await client.query("TRUNCATE tokenless_dsa_named_panel_assignment_response_bindings");
    await client.query("SAVEPOINT legacy_binding_backdate_probe");
    await expectPostgresError(client, legacyInsert("$3::timestamptz-interval '1 second'"), "23514");
    await client.query("ROLLBACK TO SAVEPOINT legacy_binding_backdate_probe");
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_selections (assignment_id text,workspace_id text,project_id text,run_id text,reviewer_principal_id text,response_binding_required boolean) ON COMMIT DROP",
    );
    await client.query("CREATE TEMP TABLE tokenless_assurance_run_cases (run_id text,case_id text) ON COMMIT DROP");
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_assignment_response_bindings (assignment_id text,workspace_id text,project_id text,run_id text,reviewer_principal_id text,reviewer_source text,response_validity text) ON COMMIT DROP",
    );
    await client.query(
      "CREATE TEMP TABLE tokenless_assurance_assignments (assignment_id text,workspace_id text,project_id text,run_id text,reviewer_account_address text,source text,status text,paid_assignment boolean) ON COMMIT DROP",
    );
    await client.query(
      `CREATE CONSTRAINT TRIGGER dsa_completed_response_binding_probe
       AFTER INSERT OR UPDATE ON tokenless_assurance_assignments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_completed_response_binding()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_selections VALUES ('assignment_binding','ws_binding','project_binding','run_binding','principal:binding',true)",
    );
    await client.query("INSERT INTO tokenless_assurance_run_cases VALUES ('run_binding','case_binding')");
    await client.query("SAVEPOINT missing_completed_binding_probe");
    await client.query(
      "INSERT INTO tokenless_assurance_assignments VALUES ('assignment_binding','ws_binding','project_binding','run_binding','principal:binding','customer_invited','completed',false)",
    );
    await expectPostgresError(client, "SET CONSTRAINTS ALL IMMEDIATE", "23514");
    await client.query("ROLLBACK TO SAVEPOINT missing_completed_binding_probe");
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_assignment_response_bindings VALUES ('assignment_binding','ws_binding','project_binding','run_binding','principal:binding','customer_invited','valid')",
    );
    await client.query(
      "INSERT INTO tokenless_assurance_assignments VALUES ('assignment_binding','ws_binding','project_binding','run_binding','principal:binding','customer_invited','completed',false)",
    );
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_assignment_response_bindings (response_binding_required boolean,bound_at timestamptz) ON COMMIT DROP",
    );
    await client.query(
      `CREATE TRIGGER dsa_response_binding_transaction_probe
       BEFORE INSERT ON tokenless_dsa_named_panel_assignment_response_bindings FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_response_binding_transaction()`,
    );
    await client.query(
      "INSERT INTO tokenless_dsa_named_panel_assignment_response_bindings VALUES (true,date_trunc('milliseconds',transaction_timestamp()))",
    );
    await client.query("SAVEPOINT required_binding_backdate_probe");
    await expectPostgresError(
      client,
      "INSERT INTO tokenless_dsa_named_panel_assignment_response_bindings VALUES (true,date_trunc('milliseconds',transaction_timestamp())-interval '1 second')",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT required_binding_backdate_probe");
  } finally {
    await client.query("ROLLBACK");
  }

  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TEMP TABLE tokenless_assurance_assignments
       (assignment_id text,workspace_id text,project_id text,run_id text,reviewer_account_address text,
        paid_assignment boolean) ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_dsa_named_panel_selections
       (assignment_id text,workspace_id text,project_id text,run_id text,reviewer_principal_id text,
        response_binding_required boolean) ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TRIGGER dsa_unpaid_selection_probe
       BEFORE INSERT ON tokenless_dsa_named_panel_selections FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_unpaid_selection()`,
    );
    await client.query(
      `CREATE TRIGGER dsa_assignment_stays_unpaid_probe
       BEFORE UPDATE OF paid_assignment ON tokenless_assurance_assignments FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_assignment_stays_unpaid()`,
    );
    await client.query(
      "INSERT INTO tokenless_assurance_assignments VALUES ('assignment_paid','ws_paid','project_paid','run_paid','principal:paid',true)",
    );
    const selectionInsert =
      "INSERT INTO tokenless_dsa_named_panel_selections VALUES ('assignment_paid','ws_paid','project_paid','run_paid','principal:paid',true)";
    await client.query("SAVEPOINT paid_selection_probe");
    await expectPostgresError(client, selectionInsert, "23514");
    await client.query("ROLLBACK TO SAVEPOINT paid_selection_probe");
    await client.query("ALTER TABLE tokenless_dsa_named_panel_selections DISABLE TRIGGER dsa_unpaid_selection_probe");
    await client.query(selectionInsert);
    await client.query("ALTER TABLE tokenless_dsa_named_panel_selections ENABLE TRIGGER dsa_unpaid_selection_probe");
    await client.query("SAVEPOINT existing_paid_selection_migration_probe");
    await expectPostgresError(
      client,
      `DO $$ BEGIN
         IF EXISTS (
           SELECT 1 FROM tokenless_dsa_named_panel_selections selection
           JOIN tokenless_assurance_assignments assignment
             ON assignment.assignment_id=selection.assignment_id
            AND assignment.workspace_id=selection.workspace_id AND assignment.project_id=selection.project_id
            AND assignment.run_id=selection.run_id
            AND assignment.reviewer_account_address=selection.reviewer_principal_id
           WHERE assignment.paid_assignment=true
         ) THEN RAISE EXCEPTION 'paid selection' USING ERRCODE='55000'; END IF;
       END $$`,
      "55000",
    );
    await client.query("ROLLBACK TO SAVEPOINT existing_paid_selection_migration_probe");
    await client.query("DELETE FROM tokenless_dsa_named_panel_selections");
    await client.query("UPDATE tokenless_assurance_assignments SET paid_assignment=false");
    await client.query(selectionInsert);
    await client.query("SAVEPOINT paid_reverse_mutation_probe");
    await expectPostgresError(
      client,
      "UPDATE tokenless_assurance_assignments SET paid_assignment=true WHERE assignment_id='assignment_paid'",
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT paid_reverse_mutation_probe");
  } finally {
    await client.query("ROLLBACK");
  }

  const nullableEvidence = JSON.stringify({
    key: "language:en:reading:cefr",
    value: "C1",
    source: "verified-language",
    assertedBy: "qualification-provider",
    verifiedAt: null,
    expiresAt: "2035-01-05T00:00:00.000Z",
    evidenceReferenceHash: `sha256:${"e".repeat(64)}`,
    evidenceVersion: "v1",
  });
  const nullableQualification = await client.query(
    `SELECT public.tokenless_dsa_named_panel_qualification_evidence_valid(
       $1,'language:en:reading:cefr','"C1"'::jsonb,'verified-language','v1',
       '2035-01-01T00:00:00.000Z'::timestamptz,'2035-01-04T00:00:00.000Z'::timestamptz) AS valid`,
    [nullableEvidence],
  );
  assert.equal(nullableQualification.rows[0]?.valid, false, "Nullable qualification time must fail closed.");

  const acceptedAt = new Date("2035-01-01T10:00:00.000Z");
  const frozenAt = new Date("2035-01-01T11:00:00.000Z");
  const assignmentExpiresAt = new Date("2035-01-04T00:00:00.000Z");
  const evidenceDigest = `sha256:${"e".repeat(64)}`;
  const assignmentInsert = ({ verifiedAt, expiresAt }) => {
    const languageJson = JSON.stringify({
      key: "language:en:reading:cefr",
      value: "C1",
      source: "verified-language",
      assertedBy: "qualification-provider",
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      evidenceReferenceHash: evidenceDigest,
      evidenceVersion: "v1",
    });
    const categoryJson = JSON.stringify({
      key: "dsa-policy-category:illegal_content",
      value: true,
      source: "verified-category",
      assertedBy: "qualification-provider",
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      evidenceReferenceHash: evidenceDigest,
      evidenceVersion: "v1",
    });
    const conflictJson = JSON.stringify({
      schemaVersion: "rateloop.dsa-named-panel-conflict.v1",
      workspaceId: "ws_qualification",
      epochId: "epoch_qualification",
      unitId: "unit_qualification",
      assignmentId: "assignment_qualification",
      reviewerPrincipalId: "principal:qualification",
      hasConflict: false,
      relationships: [],
      declaredAt: frozenAt.toISOString(),
    });
    const snapshotJson = JSON.stringify({
      schemaVersion: "rateloop.dsa-named-panel-assignment.v1",
      workspaceId: "ws_qualification",
      epochId: "epoch_qualification",
      unitId: "unit_qualification",
      assignmentId: "assignment_qualification",
      reviewerPrincipalId: "principal:qualification",
      runId: "run_qualification",
      caseId: "case_qualification",
      mappingCommitment: evidenceDigest,
      acceptedAt: acceptedAt.toISOString(),
      expiresAt: assignmentExpiresAt.toISOString(),
      frozenAt: frozenAt.toISOString(),
    });
    const hash = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
    return {
      text: `INSERT INTO tokenless_dsa_named_panel_assignments
        (workspace_id,project_id,epoch_id,unit_id,run_id,case_id,mapping_commitment,assignment_id,
         reviewer_principal_id,reviewer_source,language_tag,required_language_activity,required_cefr_level,
         language_evidence_kind,language_evidence_version,language_evidence_json,language_evidence_hash,
         policy_category_code,category_evidence_kind,category_evidence_version,
         category_competence_evidence_json,category_competence_evidence_hash,
         conflict_declaration_json,conflict_declaration_hash,conflict_status,qualification_expires_at,
         assignment_snapshot_json,assignment_snapshot_hash,accepted_at,assignment_expires_at,frozen_at)
       VALUES ('ws_qualification','project_qualification','epoch_qualification','unit_qualification',
               'run_qualification','case_qualification',$1,'assignment_qualification','principal:qualification',
               'customer_invited','en','reading','C1','verified-language','v1',$2,$3,
               'illegal_content','verified-category','v1',$4,$5,$6,$7,'cleared',$8,$9,$10,$11,$12,$13)`,
      values: [
        evidenceDigest,
        languageJson,
        hash(languageJson),
        categoryJson,
        hash(categoryJson),
        conflictJson,
        hash(conflictJson),
        expiresAt,
        snapshotJson,
        hash(snapshotJson),
        acceptedAt,
        assignmentExpiresAt,
        frozenAt,
      ],
    };
  };
  await client.query("BEGIN");
  try {
    await client.query(
      "CREATE TEMP TABLE tokenless_dsa_named_panel_assignments (LIKE public.tokenless_dsa_named_panel_assignments INCLUDING CONSTRAINTS) ON COMMIT DROP",
    );
    await client.query(
      assignmentInsert({
        verifiedAt: new Date("2034-12-01T00:00:00.000Z"),
        expiresAt: new Date("2035-01-05T00:00:00.000Z"),
      }),
    );
    await client.query("TRUNCATE tokenless_dsa_named_panel_assignments");
    await client.query("SAVEPOINT future_qualification_probe");
    await expectPostgresError(
      client,
      assignmentInsert({
        verifiedAt: new Date("2035-01-02T00:00:00.000Z"),
        expiresAt: new Date("2035-01-05T00:00:00.000Z"),
      }),
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT future_qualification_probe");
    await client.query("SAVEPOINT expired_qualification_probe");
    await expectPostgresError(
      client,
      assignmentInsert({
        verifiedAt: new Date("2034-12-01T00:00:00.000Z"),
        expiresAt: new Date("2035-01-03T00:00:00.000Z"),
      }),
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT expired_qualification_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

async function dsaReconciliationSkipLockedProgressChecks(pool, client) {
  const table = "tokenless_ci_dsa_reconciliation_candidates";
  await client.query(`DROP TABLE IF EXISTS ${table}`);
  await client.query(`CREATE TABLE ${table} (unit_number integer PRIMARY KEY)`);
  await client.query(`INSERT INTO ${table} SELECT generate_series(1,101)`);
  const locker = await pool.connect();
  let clientInTransaction = false;
  let lockerInTransaction = false;
  try {
    await locker.query("BEGIN");
    lockerInTransaction = true;
    await locker.query(`SELECT unit_number FROM ${table} WHERE unit_number=1 FOR UPDATE`);
    await client.query("BEGIN");
    clientInTransaction = true;
    const selected = [];
    for (let attempt = 0; attempt < 128; attempt += 1) {
      const next = await client.query(
        `SELECT unit_number FROM ${table}
         WHERE unit_number<>ALL($1::integer[])
         ORDER BY unit_number LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [selected],
      );
      if (next.rowCount === 0) break;
      selected.push(Number(next.rows[0].unit_number));
    }
    assert.equal(selected.length, 100, "The locked first unit must not starve the other 100 candidates.");
    assert.equal(selected[0], 2);
    assert.equal(selected.at(-1), 101);
  } finally {
    if (clientInTransaction) await client.query("ROLLBACK");
    if (lockerInTransaction) await locker.query("ROLLBACK");
    locker.release();
    await client.query(`DROP TABLE IF EXISTS ${table}`);
  }
}

async function dsaNamedPanelMaterializationRetryChecks(client) {
  await client.query("BEGIN");
  try {
    await client.query(
      `CREATE TEMP TABLE tokenless_dsa_named_panel_materialization_retries
         (LIKE public.tokenless_dsa_named_panel_materialization_retries INCLUDING CONSTRAINTS) ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TRIGGER dsa_named_panel_materialization_retry_time_probe
       BEFORE INSERT OR UPDATE OR DELETE ON tokenless_dsa_named_panel_materialization_retries FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_guard_dsa_named_panel_materialization_retry_time()`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_ci_dsa_materialization_candidates
         (workspace_id text,epoch_id text,unit_id text,unit_number integer PRIMARY KEY,complete boolean NOT NULL)
       ON COMMIT DROP`,
    );
    await client.query(
      `INSERT INTO tokenless_ci_dsa_materialization_candidates
       SELECT 'ws_rotation','epoch_rotation','unit-'||unit_number,unit_number,false
       FROM generate_series(1,260) unit_number`,
    );
    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_materialization_retries
       (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
        last_attempt_at,resolved_at,updated_at)
       SELECT 'ws_rotation','epoch_rotation','unit-'||unit_number,'retrying',1,1,
              'response_evidence_materialization_failed',transaction_timestamp(),transaction_timestamp(),NULL,
              transaction_timestamp()
       FROM generate_series(1,128) unit_number`,
    );
    const firstRestartBatch = await client.query(
      `SELECT candidate.unit_number
       FROM tokenless_ci_dsa_materialization_candidates candidate
       LEFT JOIN tokenless_dsa_named_panel_materialization_retries retry
         ON retry.workspace_id=candidate.workspace_id AND retry.epoch_id=candidate.epoch_id
        AND retry.unit_id=candidate.unit_id
       WHERE candidate.complete=false
         AND (retry.unit_id IS NULL OR retry.state='resolved' OR retry.next_retry_at<=transaction_timestamp())
       ORDER BY COALESCE(retry.failure_count,0),COALESCE(retry.last_attempt_at,'-infinity'::timestamptz),
                candidate.unit_number
       LIMIT 128`,
    );
    assert.equal(firstRestartBatch.rows[0]?.unit_number, 129);
    assert.equal(firstRestartBatch.rows.at(-1)?.unit_number, 256);
    assert.equal(
      firstRestartBatch.rowCount,
      128,
      "Persisted failures must rotate behind untouched units after restart.",
    );
    await client.query(
      "UPDATE tokenless_ci_dsa_materialization_candidates SET complete=true WHERE unit_number BETWEEN 129 AND 256",
    );
    const secondRestartBatch = await client.query(
      `SELECT candidate.unit_number
       FROM tokenless_ci_dsa_materialization_candidates candidate
       LEFT JOIN tokenless_dsa_named_panel_materialization_retries retry
         ON retry.workspace_id=candidate.workspace_id AND retry.epoch_id=candidate.epoch_id
        AND retry.unit_id=candidate.unit_id
       WHERE candidate.complete=false
         AND (retry.unit_id IS NULL OR retry.state='resolved' OR retry.next_retry_at<=transaction_timestamp())
       ORDER BY COALESCE(retry.failure_count,0),COALESCE(retry.last_attempt_at,'-infinity'::timestamptz),
                candidate.unit_number
       LIMIT 1`,
    );
    assert.equal(secondRestartBatch.rows[0]?.unit_number, 257, "A second process must continue durable rotation.");

    await client.query(
      `INSERT INTO tokenless_dsa_named_panel_materialization_retries
        (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
         last_attempt_at,resolved_at,updated_at)
       VALUES ('ws_cooldown','epoch_cooldown','unit-cooldown','retrying',1,1,
               'response_evidence_materialization_failed',transaction_timestamp(),
               transaction_timestamp(),NULL,transaction_timestamp())`,
    );
    for (let failureCount = 2; failureCount <= 7; failureCount += 1) {
      await client.query(
        `UPDATE tokenless_dsa_named_panel_materialization_retries
         SET state='retrying',attempt_count=$1,failure_count=$1,
             failure_code='response_evidence_materialization_failed',next_retry_at=transaction_timestamp(),
             last_attempt_at=transaction_timestamp(),resolved_at=NULL,updated_at=transaction_timestamp()
         WHERE workspace_id='ws_cooldown' AND epoch_id='epoch_cooldown' AND unit_id='unit-cooldown'`,
        [failureCount],
      );
    }
    await client.query("SAVEPOINT invalid_materialization_cooldown_probe");
    await expectPostgresError(
      client,
      `UPDATE tokenless_dsa_named_panel_materialization_retries
       SET state='cooldown',attempt_count=8,failure_count=8,
           failure_code='response_evidence_materialization_failed',next_retry_at=transaction_timestamp(),
           last_attempt_at=transaction_timestamp(),resolved_at=NULL,updated_at=transaction_timestamp()
       WHERE workspace_id='ws_cooldown' AND epoch_id='epoch_cooldown' AND unit_id='unit-cooldown'`,
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT invalid_materialization_cooldown_probe");
    await client.query(
      `UPDATE tokenless_dsa_named_panel_materialization_retries
       SET state='cooldown',attempt_count=8,failure_count=8,
           failure_code='response_evidence_materialization_failed',
           next_retry_at=transaction_timestamp()+interval '15 minutes',
           last_attempt_at=transaction_timestamp(),resolved_at=NULL,updated_at=transaction_timestamp()
       WHERE workspace_id='ws_cooldown' AND epoch_id='epoch_cooldown' AND unit_id='unit-cooldown'`,
    );
    await client.query("SAVEPOINT private_materialization_failure_probe");
    await expectPostgresError(
      client,
      `UPDATE tokenless_dsa_named_panel_materialization_retries
       SET state='retrying',attempt_count=9,failure_count=9,failure_code='private_exception_detail',
           next_retry_at=transaction_timestamp(),last_attempt_at=transaction_timestamp(),
           resolved_at=NULL,updated_at=transaction_timestamp()
       WHERE workspace_id='ws_cooldown' AND epoch_id='epoch_cooldown' AND unit_id='unit-cooldown'`,
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT private_materialization_failure_probe");
    await client.query("SAVEPOINT materialization_retry_delete_probe");
    await expectPostgresError(
      client,
      `DELETE FROM tokenless_dsa_named_panel_materialization_retries
       WHERE workspace_id='ws_cooldown' AND epoch_id='epoch_cooldown' AND unit_id='unit-cooldown'`,
      "55000",
    );
    await client.query("ROLLBACK TO SAVEPOINT materialization_retry_delete_probe");
    await client.query("SAVEPOINT future_materialization_retry_time_probe");
    await expectPostgresError(
      client,
      {
        text: `INSERT INTO tokenless_dsa_named_panel_materialization_retries
          (workspace_id,epoch_id,unit_id,state,attempt_count,failure_count,failure_code,next_retry_at,
           last_attempt_at,resolved_at,updated_at)
         VALUES ('ws_future','epoch_future','unit-future','retrying',1,1,
                 'response_evidence_materialization_failed',transaction_timestamp()+interval '1 second',
                 transaction_timestamp()+interval '1 second',NULL,transaction_timestamp()+interval '1 second')`,
      },
      "23514",
    );
    await client.query("ROLLBACK TO SAVEPOINT future_materialization_retry_time_probe");
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function networkBenchmarkPublicBoundaryChecks(client) {
  const activationReference = "network_activation_public_boundary";
  const deploymentKey =
    "tokenless-v4:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333:0x4444444444444444444444444444444444444444";
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000);
  await client.query("BEGIN");
  try {
    await client.query("CREATE TEMP TABLE tokenless_workspaces (workspace_id text,status text) ON COMMIT DROP");
    await client.query(
      `CREATE TEMP TABLE tokenless_assurance_projects
         (workspace_id text,project_id text,status text,visibility text,data_classification text,material_kind text)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_network_benchmark_activations
         (workspace_id text,project_id text,benchmark_id text,activation_reference text,method_version text,
          deployment_key text,status text,activation_scope text,activation_json text,
          permitted_worker_jurisdictions_json text,permitted_worker_jurisdictions_hash text,
          authorization_not_before timestamptz,authorization_expires_at timestamptz)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_network_benchmark_opportunity_authorizations
         (workspace_id text,project_id text,activation_reference text,opportunity_id text,request_profile_id text,
          request_profile_version integer,request_profile_hash text,source_evidence_hash text,
          suggestion_commitment text,authorization_hash text,activation_scope text,
          permitted_worker_jurisdictions_json text,permitted_worker_jurisdictions_hash text)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_agent_review_request_profiles
         (workspace_id text,profile_id text,version integer,profile_hash text,audience text,content_boundary text,
          compensation_mode text,configuration_status text,superseded_at timestamptz)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_network_benchmark_activation_deactivations
         (workspace_id text,activation_reference text)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_network_benchmark_execution_bindings
         (workspace_id text,binding_id text,project_id text,benchmark_id text,activation_reference text,
          opportunity_id text,run_id text,request_profile_id text,request_profile_version integer,
          request_profile_hash text,source_evidence_hash text,suggestion_commitment text,authorization_hash text,
          method_version text,deployment_key text)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TEMP TABLE tokenless_public_network_review_bindings
         (workspace_id text,binding_id text,project_id text,opportunity_id text,run_id text,
          request_profile_id text,request_profile_version integer,request_profile_hash text,
          source_evidence_hash text,suggestion_commitment text,deployment_key text)
       ON COMMIT DROP`,
    );
    await client.query(
      `CREATE TRIGGER network_benchmark_public_boundary_probe
       AFTER INSERT ON tokenless_public_network_review_bindings FOR EACH ROW
       EXECUTE FUNCTION public.tokenless_bind_network_benchmark_publication()`,
    );
    await client.query("INSERT INTO tokenless_workspaces VALUES ('ws_network_boundary','active')");
    await client.query(
      `INSERT INTO tokenless_assurance_projects
       VALUES ('ws_network_boundary','project_network_boundary','active','private','internal',NULL)`,
    );
    await client.query(
      `INSERT INTO tokenless_network_benchmark_activations
       VALUES ('ws_network_boundary','project_network_boundary','benchmark_network_boundary',$1,'method_v1',$2,
               'active','testnet_network_benchmark_exercise',
               '{"schemaVersion":"rateloop.network-benchmark-activation.v2"}',
               '["DE","FR"]',$3,$4,$5)`,
      [activationReference, deploymentKey, `sha256:${"5".repeat(64)}`, new Date(now.getTime() - 60_000), expiresAt],
    );
    await client.query(
      `INSERT INTO tokenless_network_benchmark_opportunity_authorizations
       VALUES ('ws_network_boundary','project_network_boundary',$1,'opportunity_network_boundary',
               'profile_network_boundary',1,$2,$3,$4,$5,'testnet_network_benchmark_exercise',
               '["DE","FR"]',$6)`,
      [
        activationReference,
        `sha256:${"1".repeat(64)}`,
        `sha256:${"2".repeat(64)}`,
        `sha256:${"3".repeat(64)}`,
        `sha256:${"4".repeat(64)}`,
        `sha256:${"5".repeat(64)}`,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_agent_review_request_profiles
       VALUES ('ws_network_boundary','profile_network_boundary',1,$1,'public_network','public_or_test',
               'usdc','ready',NULL)`,
      [`sha256:${"1".repeat(64)}`],
    );
    const bindingInsert = {
      text: `INSERT INTO tokenless_public_network_review_bindings
             VALUES ('ws_network_boundary','binding_network_boundary','project_network_boundary',
                     'opportunity_network_boundary','run_network_boundary','profile_network_boundary',1,$1,$2,$3,$4)`,
      values: [`sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`, `sha256:${"3".repeat(64)}`, deploymentKey],
    };
    await client.query("SAVEPOINT private_publication_probe");
    await expectPostgresError(client, bindingInsert, "P0001");
    await client.query("ROLLBACK TO SAVEPOINT private_publication_probe");

    await client.query(
      `UPDATE tokenless_assurance_projects
       SET visibility='public',data_classification='public',material_kind='synthetic'`,
    );
    await client.query(bindingInsert);
    const execution = await client.query(
      "SELECT activation_reference FROM tokenless_network_benchmark_execution_bindings WHERE run_id='run_network_boundary'",
    );
    assert.deepEqual(execution.rows, [{ activation_reference: activationReference }]);

    await client.query("UPDATE tokenless_assurance_projects SET visibility='private'");
    await client.query("SAVEPOINT private_execution_probe");
    await expectPostgresError(
      client,
      {
        text: "SELECT public.tokenless_require_active_network_benchmark_for_run($1,$2,$3,$4)",
        values: ["ws_network_boundary", "project_network_boundary", "run_network_boundary", deploymentKey],
      },
      "P0001",
    );
    await client.query("ROLLBACK TO SAVEPOINT private_execution_probe");

    await client.query("UPDATE tokenless_assurance_projects SET visibility='public'");
    await client.query("UPDATE tokenless_agent_review_request_profiles SET audience='private_invited'");
    await client.query("SAVEPOINT private_profile_execution_probe");
    await expectPostgresError(
      client,
      {
        text: "SELECT public.tokenless_require_active_network_benchmark_for_run($1,$2,$3,$4)",
        values: ["ws_network_boundary", "project_network_boundary", "run_network_boundary", deploymentKey],
      },
      "P0001",
    );
    await client.query("ROLLBACK TO SAVEPOINT private_profile_execution_probe");

    await client.query("UPDATE tokenless_agent_review_request_profiles SET audience='public_network'");
    const acceptance = await client.query({
      text: "SELECT public.tokenless_require_network_benchmark_assignment_acceptance($1,$2,$3,$4) AS activation_reference",
      values: ["ws_network_boundary", "project_network_boundary", "run_network_boundary", "DE"],
    });
    assert.deepEqual(acceptance.rows, [{ activation_reference: activationReference }]);

    for (const [probe, mutation, values] of [
      [
        "unpermitted_residence",
        null,
        ["ws_network_boundary", "project_network_boundary", "run_network_boundary", "AT"],
      ],
      [
        "wrong_scope",
        "UPDATE tokenless_network_benchmark_activations SET activation_scope='live_marketplace_release'",
        ["ws_network_boundary", "project_network_boundary", "run_network_boundary", "DE"],
      ],
      [
        "expired_activation",
        "UPDATE tokenless_network_benchmark_activations SET authorization_expires_at=transaction_timestamp()",
        ["ws_network_boundary", "project_network_boundary", "run_network_boundary", "DE"],
      ],
    ]) {
      await client.query(`SAVEPOINT ${probe}_probe`);
      if (mutation) await client.query(mutation);
      await expectPostgresError(
        client,
        {
          text: "SELECT public.tokenless_require_network_benchmark_assignment_acceptance($1,$2,$3,$4)",
          values,
        },
        "P0001",
      );
      await client.query(`ROLLBACK TO SAVEPOINT ${probe}_probe`);
    }

    await client.query("INSERT INTO tokenless_network_benchmark_activation_deactivations VALUES ($1,$2)", [
      "ws_network_boundary",
      activationReference,
    ]);
    await expectPostgresError(
      client,
      {
        text: "SELECT public.tokenless_require_network_benchmark_assignment_acceptance($1,$2,$3,$4)",
        values: ["ws_network_boundary", "project_network_boundary", "run_network_boundary", "DE"],
      },
      "P0001",
    );
  } finally {
    await client.query("ROLLBACK");
  }
}

export async function runPostgresInvariantTests(databaseUrl = process.env.DATABASE_URL) {
  const pool = new Pool({
    connectionString: localTestDatabaseUrl(databaseUrl),
    connectionTimeoutMillis: 10_000,
    max: 2,
  });
  const client = await pool.connect();
  try {
    await prepaidReferenceUniquenessAndRollback(client);
    await projectAccessPartialUniquenessAndChecks(client);
    await signingLedgerTerminalPartialUniqueness(client);
    await dsaNullableDisjunctionChecks(client);
    await dsaBeaconUsesLateCommitClock(client);
    await projectWindowAccessRequiresTerminalSnapshot(client);
    await dsaNamedPanelJsonAndResponseChecks(client);
    await dsaReferenceProvenanceChecks(client);
    await dsaNamedPanelReleaseGuardChecks(client);
    await dsaNamedPanelSelectionChecks(client);
    await dsaNamedPanelResponseRootChecks(client);
    await dsaNamedPanelAdjudicationEvidenceChecks(client);
    await dsaNamedPanelAdjudicationLeaseClosureChecks(client);
    await dsaNamedPanelAssignmentResponseBindingChecks(client);
    await dsaReconciliationSkipLockedProgressChecks(pool, client);
    await dsaNamedPanelMaterializationRetryChecks(client);
    await dsaNamedPanelGapChecks(client);
    await networkBenchmarkPublicBoundaryChecks(client);
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
