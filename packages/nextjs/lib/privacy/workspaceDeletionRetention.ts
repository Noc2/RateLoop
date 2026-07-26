import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import { recordPrivacyWorkerFailure, resolvePrivacyWorkerFailure } from "~~/lib/privacy/privacyWorkerFailures";

const HOLD_RECHECK_MS = 30 * 86_400_000;
const POST_HOLD_AUDIT_RETENTION_MS = 365 * 86_400_000;
const EXPIRABLE_CATEGORIES = new Set(["billing_records", "referenced_private_quote_commitments", "settlement_audit"]);

type Row = Record<string, unknown>;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Retention expiry limit is invalid.");
  return Math.min(value, 100);
}

async function anonymizeBilling(client: PoolClient, input: { jobId: string; workspaceId: string; now: Date }) {
  const billingSubject = `deleted-billing:${digest(`${input.jobId}:billing`).slice(0, 48)}`;
  await client.query(
    `UPDATE tokenless_payment_intents
     SET payer_address=$1,payload_json=$2,updated_at=$3 WHERE workspace_id=$4`,
    [billingSubject, "{}", input.now, input.workspaceId],
  );
  await client.query(`UPDATE tokenless_prepaid_ledger_entries SET external_reference=NULL WHERE workspace_id=$1`, [
    input.workspaceId,
  ]);
  await client.query(
    `UPDATE tokenless_workspace_billing_customers
     SET provider_customer_id=$1,updated_at=$2 WHERE workspace_id=$3`,
    [billingSubject, input.now, input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_workspace_subscriptions
     SET provider_subscription_id=NULL,provider_price_id=NULL,provider_event_id=NULL,
         updated_at=$1 WHERE workspace_id=$2`,
    [input.now, input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_workspace_fund_resolution_requests
     SET requested_by='system:retention_expiry',
         resolved_by=CASE WHEN resolved_by IS NULL THEN NULL ELSE 'system:retention_expiry' END,
         resolution_reference=CASE WHEN resolution_reference IS NULL THEN NULL ELSE $1 END,
         updated_at=$2
     WHERE workspace_id=$3`,
    [`retention-expired:${digest(`${input.jobId}:fund-resolution`)}`, input.now, input.workspaceId],
  );
}

async function anonymizeSettlementAudit(
  client: PoolClient,
  input: { jobId: string; requestId: string | null; workspaceId: string; now: Date },
) {
  await client.query(
    `DELETE FROM tokenless_artifact_deletion_jobs
     WHERE workspace_id=$1 AND state='completed'`,
    [input.workspaceId],
  );
  const artifactAuditReferences = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_artifact_deletion_jobs
     WHERE workspace_id=$1 AND audit_event_id IS NOT NULL`,
    [input.workspaceId],
  );
  if (Number((artifactAuditReferences.rows[0] as Row | undefined)?.count ?? 0) !== 0) {
    throw new Error("Artifact deletion audit references remain after retention expiry.");
  }
  await client.query("DELETE FROM tokenless_audit_events WHERE workspace_id=$1", [input.workspaceId]);
  await client.query("DELETE FROM tokenless_audit_heads WHERE workspace_id=$1", [input.workspaceId]);
  await client.query(
    `UPDATE tokenless_agent_integration_events
     SET actor_reference='system:retention_expiry',details_json='{}' WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_agent_connection_intent_events
     SET actor_type='service',actor_reference='system:retention_expiry',details_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_private_group_events
     SET principal_address=NULL,actor_reference='system:retention_expiry',details_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_enterprise_identity_audit_outbox
     SET actor_reference='system:retention_expiry',target_id='deleted-subject',metadata_json='{}'
     WHERE workspace_id=$1`,
    [input.workspaceId],
  );
  await client.query(
    `UPDATE tokenless_deletion_jobs
     SET requested_by='system:retention_expiry' WHERE job_id=$1`,
    [input.jobId],
  );
  if (input.requestId) {
    await client.query(`UPDATE tokenless_subject_requests SET principal_id=$1 WHERE request_id=$2`, [
      `deleted-workspace-subject:${digest(`${input.jobId}:subject`).slice(0, 40)}`,
      input.requestId,
    ]);
    await client.query(
      `UPDATE tokenless_subject_request_events
       SET actor_reference='system:retention_expiry' WHERE request_id=$1`,
      [input.requestId],
    );
  }
}

export async function expireWorkspaceDeletionRetentionCategories(now = new Date(), requestedLimit = 25) {
  const limit = boundedLimit(requestedLimit);
  const releasedHoldRows = await dbPool.query(
    `SELECT category.job_id
     FROM tokenless_deletion_job_categories category
     JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
     WHERE job.scope_kind='workspace' AND category.category='legal_hold_records'
       AND category.status='retained' AND category.retention_deadline IS NULL
       AND job.scope_id NOT IN (
         SELECT hold.workspace_id FROM tokenless_legal_holds hold WHERE hold.status='active'
       )
     ORDER BY category.job_id`,
  );
  let releasedHoldSchedules = 0;
  for (const value of releasedHoldRows.rows as Row[]) {
    const jobId = text(value, "job_id")!;
    const workItemKey = `${jobId}:legal_hold_schedule`;
    try {
      const released = await dbPool.query(
        `UPDATE tokenless_deletion_job_categories
         SET basis_code='settlement_and_audit',retention_deadline=$1
         WHERE job_id=$2 AND category='legal_hold_records'
           AND status='retained' AND retention_deadline IS NULL`,
        [new Date(now.getTime() + POST_HOLD_AUDIT_RETENTION_MS), jobId],
      );
      await resolvePrivacyWorkerFailure({ now, workerKind: "workspace_retention", workItemKey });
      releasedHoldSchedules += released.rowCount ?? 0;
    } catch (error) {
      await recordPrivacyWorkerFailure({
        error,
        now,
        workerKind: "workspace_retention",
        workItemKey,
      });
    }
  }
  const due = await dbPool.query(
    `SELECT category.job_id,category.category,job.scope_id,job.subject_request_id
     FROM tokenless_deletion_job_categories category
     JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
     LEFT JOIN tokenless_privacy_worker_failures failure
       ON failure.worker_kind='workspace_retention'
      AND failure.work_item_key=category.job_id || ':' || category.category
     WHERE job.scope_kind='workspace' AND job.status='completed'
       AND category.disposition='retain' AND category.status='retained'
       AND category.retention_deadline IS NOT NULL AND category.retention_deadline<=$1
       AND (failure.failure_id IS NULL OR (failure.status='retrying' AND failure.next_retry_at<=$1))
     ORDER BY category.retention_deadline,category.job_id,category.category LIMIT $2`,
    [now, limit],
  );
  const summary = {
    completed: 0,
    deferredByHold: 0,
    releasedHoldSchedules,
  };
  for (const value of due.rows as Row[]) {
    const jobId = text(value, "job_id")!;
    const category = text(value, "category")!;
    const workspaceId = text(value, "scope_id")!;
    const requestId = text(value, "subject_request_id");
    const workItemKey = `${jobId}:${category}`;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      if (!EXPIRABLE_CATEGORIES.has(category) && category !== "legal_hold_records") {
        throw new Error(`Workspace retention category ${category} has no expiry handler.`);
      }
      const locked = await client.query(
        `SELECT category.status
         FROM tokenless_deletion_job_categories category
         JOIN tokenless_deletion_jobs job ON job.job_id=category.job_id
         WHERE category.job_id=$1 AND category.category=$2
           AND job.scope_kind='workspace' AND job.scope_id=$3
           AND category.status='retained' AND category.retention_deadline<=$4
         FOR UPDATE`,
        [jobId, category, workspaceId, now],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        continue;
      }
      const workspace = await client.query(
        "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id=$1 FOR UPDATE",
        [workspaceId],
      );
      if (workspace.rowCount !== 1) {
        throw new Error("Retention expiry workspace no longer exists.");
      }
      const hold = await client.query(
        `SELECT hold_id FROM tokenless_legal_holds
         WHERE workspace_id=$1 AND status='active' LIMIT 1 FOR SHARE`,
        [workspaceId],
      );
      if ((hold.rowCount ?? 0) > 0) {
        await client.query(
          `UPDATE tokenless_deletion_job_categories
           SET retention_deadline=$1 WHERE job_id=$2 AND category=$3`,
          [new Date(now.getTime() + HOLD_RECHECK_MS), jobId, category],
        );
        await client.query("COMMIT");
        summary.deferredByHold += 1;
        continue;
      }
      if (category === "billing_records") {
        await anonymizeBilling(client, { jobId, workspaceId, now });
      } else if (category === "settlement_audit" || category === "legal_hold_records") {
        await anonymizeSettlementAudit(client, { jobId, requestId, workspaceId, now });
      } else {
        const ownerLinks = await client.query(
          `SELECT COUNT(*) AS count FROM tokenless_agent_quotes WHERE owner_workspace_id=$1`,
          [workspaceId],
        );
        if (Number((ownerLinks.rows[0] as Row | undefined)?.count ?? 0) !== 0) {
          throw new Error("Referenced private quote ownership was not anonymized before retention expiry.");
        }
      }
      const updated = await client.query(
        `UPDATE tokenless_deletion_job_categories
         SET disposition='anonymize',status='completed',basis_code=NULL,retention_deadline=NULL,
             evidence_digest=$1,completed_at=$2
         WHERE job_id=$3 AND category=$4 AND status='retained'`,
        [digest(`${jobId}:${category}:retention-expired:${now.toISOString()}`), now, jobId, category],
      );
      if (updated.rowCount !== 1) throw new Error("Retention expiry category transition failed.");
      await client.query(
        `UPDATE tokenless_privacy_worker_failures
         SET status='resolved',next_retry_at=NULL,operator_alert_state='resolved',
             resolved_at=$1,updated_at=$1
         WHERE worker_kind='workspace_retention' AND work_item_key=$2 AND status <> 'resolved'`,
        [now, workItemKey],
      );
      await client.query("COMMIT");
      summary.completed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      await recordPrivacyWorkerFailure({
        error,
        now,
        workerKind: "workspace_retention",
        workItemKey,
      });
    } finally {
      client.release();
    }
  }
  return summary;
}
