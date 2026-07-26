import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { expireWorkspaceDeletionRetentionCategories } from "~~/lib/privacy/workspaceDeletionRetention";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2037-07-26T10:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function seedDueWorkspaceRetention() {
  const createdAt = new Date("2026-07-26T10:00:00.000Z");
  const workspace = await createWorkspace({ name: "Retention expiry", ownerAddress: OWNER });
  const requestId = "dsr_workspace_retention_expiry";
  const jobId = "del_workspace_retention_expiry";
  await appendAuditEvent({
    workspaceId: workspace.workspaceId,
    actorKind: "account",
    actorReference: OWNER,
    assuranceMethod: "rateloop_session",
    action: "workspace.deleted",
    targetKind: "workspace",
    targetId: workspace.workspaceId,
    purpose: "workspace_deletion",
    reason: "customer_request",
    result: "success",
    occurredAt: createdAt,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_subject_requests
          (request_id,principal_id,workspace_id,request_type,status,scope_json,
           identity_assurance,received_at,due_at,completed_at)
          VALUES (?,?,?,'deletion','completed','{}','rateloop_session',?,?,?)`,
    args: [requestId, OWNER, workspace.workspaceId, createdAt, createdAt, createdAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_deletion_jobs
          (job_id,scope_kind,scope_id,subject_request_id,requested_by,status,due_at,
           requested_at,started_at,completed_at,receipt_digest)
          VALUES (?,'workspace',?,?,?,'completed',?,?,?,?,?)`,
    args: [jobId, workspace.workspaceId, requestId, OWNER, createdAt, createdAt, createdAt, createdAt, "a".repeat(64)],
  });
  for (const category of ["billing_records", "referenced_private_quote_commitments", "settlement_audit"]) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_deletion_job_categories
            (job_id,category,disposition,status,basis_code,retention_deadline,
             evidence_digest,created_at,started_at,completed_at)
            VALUES (?,?,'retain','retained','settlement_and_audit',?,?,?, ?,?)`,
      args: [jobId, category, new Date(NOW.getTime() - 1), "b".repeat(64), createdAt, createdAt, createdAt],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payment_intents
          (payment_intent_id,workspace_id,idempotency_key,mode,payer_address,amount_atomic,
           payload_hash,payload_json,state,created_at,updated_at)
          VALUES ('payment_retention',?,'payment:retention','prepaid',?,'100','payload-hash',
                  '{"email":"payer@example.test"}','confirmed',?,?)`,
    args: [workspace.workspaceId, OWNER, createdAt, createdAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at)
          VALUES ('ledger_retention',?,'100','settled','stripe','customer-visible-reference',?)`,
    args: [workspace.workspaceId, createdAt],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_workspaces SET name='Deleted workspace',status='deleted',
          deleted_at=?,updated_at=? WHERE workspace_id=?`,
    args: [createdAt, createdAt, workspace.workspaceId],
  });
  return { jobId, requestId, workspaceId: workspace.workspaceId };
}

test("scheduled category expiry anonymizes due workspace billing and audit records", async () => {
  const fixture = await seedDueWorkspaceRetention();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_deletion_job_categories
          (job_id,category,disposition,status,basis_code,retention_deadline,
           evidence_digest,created_at,started_at,completed_at)
          VALUES (?,'aaa_poison','retain','retained','settlement_and_audit',?,?,?, ?,?)`,
    args: [
      fixture.jobId,
      new Date(NOW.getTime() - 2),
      "d".repeat(64),
      new Date("2026-07-26T10:00:00.000Z"),
      new Date("2026-07-26T10:00:00.000Z"),
      new Date("2026-07-26T10:00:00.000Z"),
    ],
  });
  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(NOW), {
    completed: 3,
    deferredByHold: 0,
    releasedHoldSchedules: 0,
  });
  const categories = await dbClient.execute({
    sql: `SELECT category,disposition,status,basis_code,retention_deadline
          FROM tokenless_deletion_job_categories
          WHERE job_id=? AND category <> 'aaa_poison' ORDER BY category`,
    args: [fixture.jobId],
  });
  assert.ok(
    categories.rows.every(
      row =>
        row.disposition === "anonymize" &&
        row.status === "completed" &&
        row.basis_code === null &&
        row.retention_deadline === null,
    ),
  );
  const payment = await dbClient.execute({
    sql: `SELECT payer_address,payload_json FROM tokenless_payment_intents
          WHERE payment_intent_id='payment_retention'`,
    args: [],
  });
  const ledger = await dbClient.execute({
    sql: `SELECT external_reference FROM tokenless_prepaid_ledger_entries
          WHERE entry_id='ledger_retention'`,
    args: [],
  });
  const audit = await dbClient.execute({
    sql: `SELECT COUNT(*) AS count FROM tokenless_audit_events WHERE workspace_id=?`,
    args: [fixture.workspaceId],
  });
  const request = await dbClient.execute({
    sql: `SELECT principal_id FROM tokenless_subject_requests WHERE request_id=?`,
    args: [fixture.requestId],
  });
  const job = await dbClient.execute({
    sql: `SELECT requested_by FROM tokenless_deletion_jobs WHERE job_id=?`,
    args: [fixture.jobId],
  });
  assert.match(String(payment.rows[0]?.payer_address), /^deleted-billing:/u);
  assert.equal(payment.rows[0]?.payload_json, "{}");
  assert.equal(ledger.rows[0]?.external_reference, null);
  assert.equal(Number(audit.rows[0]?.count), 0);
  assert.match(String(request.rows[0]?.principal_id), /^deleted-workspace-subject:/u);
  assert.equal(job.rows[0]?.requested_by, "system:retention_expiry");
  const failure = await dbClient.execute({
    sql: `SELECT status,attempt_count,last_error_code,last_error_digest,operator_alert_state,next_retry_at
          FROM tokenless_privacy_worker_failures
          WHERE worker_kind='workspace_retention' AND work_item_key=?`,
    args: [`${fixture.jobId}:aaa_poison`],
  });
  assert.equal(failure.rows[0]?.status, "retrying");
  assert.equal(Number(failure.rows[0]?.attempt_count), 1);
  assert.equal(failure.rows[0]?.last_error_code, "internal_error");
  assert.match(String(failure.rows[0]?.last_error_digest), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(failure.rows[0]?.operator_alert_state, "pending");
});

test("active legal holds defer due categories without claiming expiry", async () => {
  const fixture = await seedDueWorkspaceRetention();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_legal_holds
          (hold_id,workspace_id,project_id,scope,reason,status,created_by,created_at,review_at)
          VALUES ('hold_retention',?,NULL,'workspace','litigation','active','privacy:operator',?,?)`,
    args: [fixture.workspaceId, new Date("2037-01-01T00:00:00.000Z"), new Date("2038-01-01T00:00:00.000Z")],
  });
  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(NOW), {
    completed: 0,
    deferredByHold: 3,
    releasedHoldSchedules: 0,
  });
  const categories = await dbClient.execute({
    sql: `SELECT status,disposition,retention_deadline
          FROM tokenless_deletion_job_categories WHERE job_id=?`,
    args: [fixture.jobId],
  });
  assert.ok(categories.rows.every(row => row.status === "retained" && row.disposition === "retain"));
  assert.ok(
    categories.rows.every(row => new Date(String(row.retention_deadline)).toISOString() === "2037-08-25T10:00:00.000Z"),
  );
});

test("released legal holds receive a bounded post-hold audit deadline", async () => {
  const fixture = await seedDueWorkspaceRetention();
  const releasedAt = new Date("2037-07-01T00:00:00.000Z");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_legal_holds
          (hold_id,workspace_id,project_id,scope,reason,status,created_by,created_at,review_at,
           released_by,released_at,release_reason)
          VALUES ('hold_released',?,NULL,'workspace','litigation','released','privacy:operator',?,?,
                  'privacy:operator',?,'matter closed')`,
    args: [fixture.workspaceId, new Date("2036-07-01T00:00:00.000Z"), new Date("2037-06-01T00:00:00.000Z"), releasedAt],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_deletion_job_categories
          (job_id,category,disposition,status,basis_code,retention_deadline,
           evidence_digest,created_at,started_at,completed_at)
          VALUES (?,'legal_hold_records','retain','retained','active_legal_hold',NULL,?,?,?,?)`,
    args: [fixture.jobId, "c".repeat(64), releasedAt, releasedAt, releasedAt],
  });
  assert.deepEqual(await expireWorkspaceDeletionRetentionCategories(NOW), {
    completed: 3,
    deferredByHold: 0,
    releasedHoldSchedules: 1,
  });
  const category = await dbClient.execute({
    sql: `SELECT basis_code,retention_deadline,status
          FROM tokenless_deletion_job_categories
          WHERE job_id=? AND category='legal_hold_records'`,
    args: [fixture.jobId],
  });
  assert.equal(category.rows[0]?.basis_code, "settlement_and_audit");
  assert.equal(category.rows[0]?.status, "retained");
  assert.equal(new Date(String(category.rows[0]?.retention_deadline)).toISOString(), "2038-07-26T10:00:00.000Z");
});

test("released-hold scheduling honors retry backoff and permanently isolates dead rows", async () => {
  const fixture = await seedDueWorkspaceRetention();
  const workItemKey = `${fixture.jobId}:legal_hold_schedule`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_deletion_job_categories
          (job_id,category,disposition,status,basis_code,retention_deadline,
           evidence_digest,created_at,started_at,completed_at)
          VALUES (?,'legal_hold_records','retain','retained','active_legal_hold',NULL,?,?,?,?)`,
    args: [
      fixture.jobId,
      "e".repeat(64),
      new Date("2026-07-26T10:00:00.000Z"),
      new Date("2026-07-26T10:00:00.000Z"),
      new Date("2026-07-26T10:00:00.000Z"),
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_privacy_worker_failures
          (failure_id,worker_kind,work_item_key,status,attempt_count,first_failed_at,last_failed_at,
           next_retry_at,last_error_code,last_error_digest,operator_alert_state,resolved_at,updated_at)
          VALUES ('privacyfail_hold_schedule','workspace_retention',?,'retrying',1,?,?,?,
                  'internal_error',?,'pending',NULL,?)`,
    args: [
      workItemKey,
      new Date(NOW.getTime() - 60_000),
      new Date(NOW.getTime() - 60_000),
      new Date(NOW.getTime() + 60_000),
      `sha256:${"f".repeat(64)}`,
      new Date(NOW.getTime() - 60_000),
    ],
  });

  const backedOff = await expireWorkspaceDeletionRetentionCategories(NOW);
  assert.equal(backedOff.releasedHoldSchedules, 0);
  let category = await dbClient.execute({
    sql: `SELECT retention_deadline FROM tokenless_deletion_job_categories
          WHERE job_id=? AND category='legal_hold_records'`,
    args: [fixture.jobId],
  });
  assert.equal(category.rows[0]?.retention_deadline, null);

  await dbClient.execute({
    sql: `UPDATE tokenless_privacy_worker_failures SET next_retry_at=?,updated_at=?
          WHERE worker_kind='workspace_retention' AND work_item_key=?`,
    args: [NOW, NOW, workItemKey],
  });
  const retried = await expireWorkspaceDeletionRetentionCategories(NOW);
  assert.equal(retried.releasedHoldSchedules, 1);
  const resolved = await dbClient.execute({
    sql: `SELECT status,operator_alert_state FROM tokenless_privacy_worker_failures
          WHERE worker_kind='workspace_retention' AND work_item_key=?`,
    args: [workItemKey],
  });
  assert.deepEqual(resolved.rows[0], { operator_alert_state: "resolved", status: "resolved" });

  await dbClient.execute({
    sql: `UPDATE tokenless_deletion_job_categories
          SET basis_code='active_legal_hold',retention_deadline=NULL
          WHERE job_id=? AND category='legal_hold_records'`,
    args: [fixture.jobId],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_privacy_worker_failures
          SET status='dead',attempt_count=5,next_retry_at=NULL,operator_alert_state='pending',
              resolved_at=NULL,updated_at=?
          WHERE worker_kind='workspace_retention' AND work_item_key=?`,
    args: [NOW, workItemKey],
  });
  const dead = await expireWorkspaceDeletionRetentionCategories(new Date(NOW.getTime() + 86_400_000));
  assert.equal(dead.releasedHoldSchedules, 0);
  category = await dbClient.execute({
    sql: `SELECT retention_deadline FROM tokenless_deletion_job_categories
          WHERE job_id=? AND category='legal_hold_records'`,
    args: [fixture.jobId],
  });
  assert.equal(category.rows[0]?.retention_deadline, null);
});
