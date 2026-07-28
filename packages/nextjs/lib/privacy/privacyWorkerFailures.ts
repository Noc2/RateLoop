import { createHash } from "node:crypto";
import "server-only";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const MAX_ATTEMPTS = 5;
const BASE_RETRY_MS = 15 * 60_000;
const MAX_RETRY_MS = 24 * 60 * 60_000;
// An item that exhausted its retries gave up on an outage, not on the work itself: the subject
// request stays 'received' and the retention category stays unfinished, so the work is still owed.
// Both queues admit only 'retrying' rows, and nothing ever moved a row back, so a dead item meant a
// data-subject request that silently never completed and never errored. Reviving after a delay
// bounds the retry rate — a re-failure rewrites last_failed_at — instead of letting it cycle.
const DEAD_REVIVAL_DELAY_MS = 6 * 60 * 60_000;

export type PrivacyWorkerKind = "subject_request" | "workspace_retention";

type Row = Record<string, unknown>;

function failureId(workerKind: PrivacyWorkerKind, workItemKey: string) {
  return `privacyfail_${createHash("sha256").update(`${workerKind}:${workItemKey}`).digest("hex").slice(0, 48)}`;
}

function safeErrorEvidence(error: unknown, workerKind: PrivacyWorkerKind, workItemKey: string) {
  const code = error instanceof TokenlessServiceError ? error.code : "internal_error";
  const errorClass = error instanceof Error ? error.name : typeof error;
  return {
    code,
    digest: `sha256:${createHash("sha256").update(`${workerKind}:${workItemKey}:${code}:${errorClass}`).digest("hex")}`,
  };
}

export async function recordPrivacyWorkerFailure(input: {
  error: unknown;
  now: Date;
  workerKind: PrivacyWorkerKind;
  workItemKey: string;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT attempt_count,status FROM tokenless_privacy_worker_failures
       WHERE worker_kind=$1 AND work_item_key=$2 FOR UPDATE`,
      [input.workerKind, input.workItemKey],
    );
    const currentRow = current.rows[0] as Row | undefined;
    // A resolved item ran to completion, so the count that preceded it is history. Carrying it
    // forward would make the next transient failure terminal on its first attempt.
    const previousAttempts =
      String(currentRow?.status ?? "") === "resolved" ? 0 : Number(currentRow?.attempt_count ?? 0);
    const attemptCount = Math.min(previousAttempts + 1, MAX_ATTEMPTS);
    const terminal = attemptCount >= MAX_ATTEMPTS;
    const retryDelay = Math.min(BASE_RETRY_MS * 2 ** Math.max(attemptCount - 1, 0), MAX_RETRY_MS);
    const evidence = safeErrorEvidence(input.error, input.workerKind, input.workItemKey);
    await client.query(
      `INSERT INTO tokenless_privacy_worker_failures
       (failure_id,worker_kind,work_item_key,status,attempt_count,first_failed_at,last_failed_at,
        next_retry_at,last_error_code,last_error_digest,operator_alert_state,resolved_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'pending',NULL,$6)
       ON CONFLICT (worker_kind,work_item_key) DO UPDATE SET
         status=EXCLUDED.status,attempt_count=EXCLUDED.attempt_count,
         last_failed_at=EXCLUDED.last_failed_at,next_retry_at=EXCLUDED.next_retry_at,
         last_error_code=EXCLUDED.last_error_code,last_error_digest=EXCLUDED.last_error_digest,
         operator_alert_state='pending',resolved_at=NULL,updated_at=EXCLUDED.updated_at`,
      [
        failureId(input.workerKind, input.workItemKey),
        input.workerKind,
        input.workItemKey,
        terminal ? "dead" : "retrying",
        attemptCount,
        input.now,
        terminal ? null : new Date(input.now.getTime() + retryDelay),
        evidence.code,
        evidence.digest,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Return work that died during an outage to its queue once the revival delay has passed. The
 * operator alert is deliberately left pending: a retry is not evidence that the cause is gone.
 */
export async function revivePrivacyWorkerFailures(now = new Date()) {
  const revived = await dbPool.query(
    `UPDATE tokenless_privacy_worker_failures
     SET status='retrying',attempt_count=1,next_retry_at=$1,updated_at=$1
     WHERE status='dead' AND last_failed_at<=$2`,
    [now, new Date(now.getTime() - DEAD_REVIVAL_DELAY_MS)],
  );
  return { revived: revived.rowCount ?? 0 };
}

export async function resolvePrivacyWorkerFailure(input: {
  now: Date;
  workerKind: PrivacyWorkerKind;
  workItemKey: string;
}) {
  await dbPool.query(
    `UPDATE tokenless_privacy_worker_failures
     SET status='resolved',next_retry_at=NULL,operator_alert_state='resolved',
         resolved_at=$1,updated_at=$1
     WHERE worker_kind=$2 AND work_item_key=$3 AND status <> 'resolved'`,
    [input.now, input.workerKind, input.workItemKey],
  );
}
