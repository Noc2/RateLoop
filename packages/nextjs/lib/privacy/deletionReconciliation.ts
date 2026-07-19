import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { erasePaidAssignmentSeatIdentities } from "~~/lib/privacy/paidAssignmentSeatIdentityErasure";

type Row = Record<string, unknown>;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowNumber(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function rowJsonObject(row: Row | undefined, key: string): Row {
  const value = row?.[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Row;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Row) : {};
  } catch {
    return {};
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function boundedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Deletion reconciliation limit is invalid.");
  return Math.min(value, 100);
}

export async function reconcileWorkspaceDeletionJobs(now = new Date(), requestedLimit = 25) {
  const limit = boundedLimit(requestedLimit);
  const jobs = await dbClient.execute({
    sql: `SELECT jobs.job_id, jobs.scope_id, jobs.subject_request_id, jobs.status, requests.scope_json
          FROM tokenless_deletion_jobs jobs
          JOIN tokenless_subject_requests requests ON requests.request_id = jobs.subject_request_id
          WHERE jobs.scope_kind = 'workspace' AND jobs.status IN ('running','blocked')
          ORDER BY jobs.requested_at ASC LIMIT ?`,
    args: [limit],
  });
  const summary = { blocked: 0, completed: 0, pending: 0 };
  for (const value of jobs.rows) {
    const job = value as Row;
    const jobId = rowString(job, "job_id")!;
    const workspaceId = rowString(job, "scope_id")!;
    const requestId = rowString(job, "subject_request_id")!;
    const privateQuotes = rowJsonObject(rowJsonObject(job, "scope_json"), "privateQuotes");
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT status FROM tokenless_deletion_jobs
         WHERE job_id = $1 AND status IN ('running','blocked') FOR UPDATE`,
        [jobId],
      );
      if (locked.rowCount !== 1) {
        await client.query("ROLLBACK");
        continue;
      }
      const counts = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM tokenless_assurance_artifact_objects
            WHERE workspace_id = $1 AND status = 'active') AS artifacts,
           (SELECT COUNT(*) FROM tokenless_public_question_media
            WHERE workspace_id = $1 AND technical_status = 'ready' AND deletion_requested_at IS NOT NULL) AS media,
           (SELECT COUNT(*) FROM tokenless_legal_holds
            WHERE workspace_id = $1 AND status = 'active') AS legal_holds`,
        [workspaceId],
      );
      const countRow = counts.rows[0] as Row | undefined;
      const remaining = rowNumber(countRow, "artifacts") + rowNumber(countRow, "media");
      const held = rowNumber(countRow, "legal_holds") > 0;
      const previousStatus = rowString(locked.rows[0] as Row | undefined, "status")!;
      if (remaining > 0) {
        if (held) {
          await client.query(
            `UPDATE tokenless_deletion_jobs SET status = 'blocked', last_error_code = 'legal_hold_active'
             WHERE job_id = $1`,
            [jobId],
          );
          await client.query(
            `UPDATE tokenless_deletion_job_categories
             SET status = 'blocked', basis_code = 'active_legal_hold'
             WHERE job_id = $1 AND category = 'private_objects' AND status IN ('in_progress','blocked')`,
            [jobId],
          );
          await client.query(
            `UPDATE tokenless_subject_requests SET status = 'blocked_by_hold'
             WHERE request_id = $1 AND status IN ('in_progress','blocked_by_hold')`,
            [requestId],
          );
          if (previousStatus !== "blocked") {
            await client.query(
              `INSERT INTO tokenless_subject_request_events
               (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
               VALUES ($1, $2, 'in_progress', 'blocked_by_hold', 'system:deletion_reconciliation',
                       'active_legal_hold', $3)`,
              [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, now],
            );
          }
          summary.blocked += 1;
        } else {
          await client.query(
            `UPDATE tokenless_deletion_jobs SET status = 'running', last_error_code = NULL WHERE job_id = $1`,
            [jobId],
          );
          await client.query(
            `UPDATE tokenless_deletion_job_categories
             SET status = 'in_progress', basis_code = NULL
             WHERE job_id = $1 AND category = 'private_objects' AND status IN ('in_progress','blocked')`,
            [jobId],
          );
          await client.query(
            `UPDATE tokenless_subject_requests SET status = 'in_progress'
             WHERE request_id = $1 AND status = 'blocked_by_hold'`,
            [requestId],
          );
          if (previousStatus === "blocked") {
            await client.query(
              `INSERT INTO tokenless_subject_request_events
               (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
               VALUES ($1, $2, 'blocked_by_hold', 'in_progress', 'system:deletion_reconciliation',
                       'legal_hold_released', $3)`,
              [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, now],
            );
          }
          summary.pending += 1;
        }
        await client.query("COMMIT");
        continue;
      }

      const receiptDigest = digest(`workspace:${jobId}:${requestId}:completed`);
      await client.query(
        `UPDATE tokenless_deletion_job_categories
         SET status = 'completed', basis_code = NULL, evidence_digest = $1, completed_at = $2
         WHERE job_id = $3 AND category = 'private_objects' AND status IN ('in_progress','blocked')`,
        [digest(`${jobId}:private_objects:deleted`), now, jobId],
      );
      await client.query(
        `UPDATE tokenless_deletion_jobs
         SET status = 'completed', completed_at = $1, last_error_code = NULL, receipt_digest = $2
         WHERE job_id = $3`,
        [now, receiptDigest, jobId],
      );
      const request = await client.query(
        `UPDATE tokenless_subject_requests SET status = 'completed', completed_at = $1
         WHERE request_id = $2 AND status IN ('in_progress','blocked_by_hold') RETURNING status`,
        [now, requestId],
      );
      if (request.rowCount === 1) {
        await client.query(
          `INSERT INTO tokenless_subject_request_events
           (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
           VALUES ($1, $2, $3, 'completed', 'system:deletion_reconciliation',
                   'eligible_categories_completed', $4)`,
          [
            `dsre_${randomUUID().replaceAll("-", "")}`,
            requestId,
            previousStatus === "blocked" ? "blocked_by_hold" : "in_progress",
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO tokenless_subject_request_completions
         (completion_id, request_id, deleted_categories_json, anonymized_categories_json,
          retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
          evidence_json, completed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, '[]', $6, $7, 'system:deletion_reconciliation', $8)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          `dsrc_${randomUUID().replaceAll("-", "")}`,
          requestId,
          JSON.stringify(["workspace_access", "private_objects", "private_quote_plaintext_payloads"]),
          JSON.stringify(["workspace_identity"]),
          JSON.stringify([
            { basis: "statutory_record", category: "billing_records" },
            { basis: "settlement_and_audit", category: "settlement_audit" },
            { basis: "settlement_and_audit", category: "referenced_private_quote_commitments" },
          ]),
          JSON.stringify(["public_chain_records"]),
          JSON.stringify({ jobId, privateQuotes, receiptDigest }),
          now,
        ],
      );
      await client.query("COMMIT");
      summary.completed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return summary;
}

export async function reconcileDeletedAccountPaidAssignmentSeats(now = new Date(), requestedLimit = 100) {
  const limit = boundedLimit(requestedLimit);
  const due = await dbClient.execute({
    sql: `SELECT DISTINCT jobs.job_id,jobs.scope_id,jobs.receipt_digest
          FROM tokenless_deletion_jobs jobs
          JOIN tokenless_paid_assignment_seats seats ON seats.reviewer_principal_id=jobs.scope_id
          WHERE jobs.scope_kind='account' AND jobs.status='completed' AND jobs.receipt_digest IS NOT NULL
          ORDER BY jobs.job_id ASC LIMIT ?`,
    args: [limit],
  });
  let accounts = 0;
  let erasedSeats = 0;
  for (const value of due.rows) {
    const row = value as Row;
    const jobId = rowString(row, "job_id")!;
    const principalId = rowString(row, "scope_id")!;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT receipt_digest FROM tokenless_deletion_jobs
         WHERE job_id=$1 AND scope_kind='account' AND scope_id=$2 AND status='completed'
         FOR UPDATE`,
        [jobId, principalId],
      );
      const receiptDigest = rowString(locked.rows[0] as Row | undefined, "receipt_digest");
      if (!receiptDigest) {
        await client.query("ROLLBACK");
        continue;
      }
      const evidence = await erasePaidAssignmentSeatIdentities(client, { now, principalId, receiptDigest });
      await client.query("COMMIT");
      if (evidence.erasedSeats > 0) {
        accounts += 1;
        erasedSeats += evidence.erasedSeats;
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { accounts, erasedSeats };
}

export async function expireDeletedAuthSubjectGuards(now = new Date(), requestedLimit = 100) {
  const limit = boundedLimit(requestedLimit);
  const due = await dbClient.execute({
    sql: `SELECT categories.job_id, jobs.scope_id
          FROM tokenless_deletion_job_categories categories
          JOIN tokenless_deletion_jobs jobs ON jobs.job_id = categories.job_id
          WHERE jobs.scope_kind = 'account' AND jobs.status = 'completed'
            AND categories.category = 'deleted_auth_subject_guard'
            AND categories.status = 'retained' AND categories.retention_deadline <= ?
          ORDER BY categories.retention_deadline ASC LIMIT ?`,
    args: [now, limit],
  });
  let expired = 0;
  for (const value of due.rows) {
    const row = value as Row;
    const jobId = rowString(row, "job_id")!;
    const principalId = rowString(row, "scope_id")!;
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM tokenless_identity_bindings
         WHERE principal_id = $1 AND provider = 'better_auth' AND status = 'revoked'`,
        [principalId],
      );
      const updated = await client.query(
        `UPDATE tokenless_deletion_job_categories
         SET disposition = 'erase', status = 'completed', basis_code = NULL, retention_deadline = NULL,
             evidence_digest = $1, completed_at = $2
         WHERE job_id = $3 AND category = 'deleted_auth_subject_guard'
           AND status = 'retained' AND retention_deadline <= $2`,
        [digest(`${jobId}:deleted_auth_subject_guard:expired`), now, jobId],
      );
      await client.query("COMMIT");
      if (updated.rowCount === 1) expired += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return { expired };
}
