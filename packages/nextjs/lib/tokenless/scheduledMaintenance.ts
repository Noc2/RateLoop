import { createHash } from "node:crypto";
import "server-only";
import {
  drainEnterpriseIdentityAuditOutbox,
  reconcileEnterpriseIdentityAuditReservations,
} from "~~/lib/auth/enterpriseIdentityAudit";
import { drainPrepaidTopupAuditOutbox, reconcilePrepaidTopups } from "~~/lib/billing/prepaidTopups";
import { dbClient } from "~~/lib/db";
import { runTokenlessNotificationCycle } from "~~/lib/notifications/delivery";
import { expireDeletedAuthSubjectGuards, reconcileWorkspaceDeletionJobs } from "~~/lib/privacy/deletionReconciliation";
import { processArtifactDeletionByObjectId } from "~~/lib/tokenless/artifactPrivacy";
import { processDueAssuranceAttestations } from "~~/lib/tokenless/assuranceAttestationRuntime";
import {
  deliverPendingAssuranceEvents,
  projectAssuranceLifecycleEvents,
} from "~~/lib/tokenless/assuranceEventStreaming";
import { processDueGrcReconciliations } from "~~/lib/tokenless/assuranceGrcConnectors";
import { processDueAssuranceWormExports } from "~~/lib/tokenless/assuranceWormExports";
import { processDueEvidenceRetentionEnforcement } from "~~/lib/tokenless/evidenceRetentionEnforcement";
import { refreshCompletedAssuranceMechanismHealth } from "~~/lib/tokenless/mechanismHealth";
import { processPublicQuestionMediaDeletionByAssetId } from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError, sweepExpiredTokenlessQuotes } from "~~/lib/tokenless/server";
import { processSurpriseBountyPayments } from "~~/lib/tokenless/surpriseBountyService";
import {
  appendFinalizedRoundEvidence,
  deliverPendingWebhooks,
  reviewAndPublishResult,
} from "~~/lib/tokenless/transparency";

type Row = Record<string, unknown>;
type WorkKind = "publish_finalized_round" | "delete_artifact" | "delete_public_media";

const RUN_BUCKET_MS = 5 * 60_000;
const STALE_CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 20;
const DEFAULT_WORK_LIMIT = 20;
const DEFAULT_WEBHOOK_LIMIT = 50;
const DEFAULT_NOTIFICATION_LIMIT = 20;
const NON_COUNTING_DEFER_CODES = new Set([
  "indexed_evidence_pending",
  "evidence_pending",
  "deletion_blocked_by_hold",
  "deletion_not_due",
]);

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bounded(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Scheduled worker limit is invalid.");
  return Math.min(value, maximum);
}

function retryAt(now: Date, attempt: number) {
  const delayMs = Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000);
  return new Date(now.getTime() + delayMs);
}

function workItemId(kind: WorkKind, subjectKey: string) {
  return `swi_${digest(`${kind}:${subjectKey}`).slice(0, 40)}`;
}

async function insertWorkItem(kind: WorkKind, subjectKey: string, now: Date) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_work_items
          (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
          ON CONFLICT (kind, subject_key) DO NOTHING`,
    args: [workItemId(kind, subjectKey), kind, subjectKey, now, now, now],
  });
}

export async function seedTokenlessScheduledWork(now = new Date(), scanLimit = 100) {
  const limit = bounded(scanLimit, 100, 200);
  const [settlements, deletions, publicMediaDeletions] = await Promise.all([
    dbClient.execute({
      sql: `SELECT e.operation_key
            FROM tokenless_chain_executions e
            LEFT JOIN tokenless_transparency_events t
              ON t.operation_key = e.operation_key AND t.event_type = 'round.finalized'
            WHERE e.state = 'confirmed' AND e.round_id IS NOT NULL AND t.event_id IS NULL
            ORDER BY e.updated_at ASC LIMIT ?`,
      args: [limit],
    }),
    dbClient.execute({
      sql: `SELECT object_id FROM tokenless_assurance_artifact_objects
            WHERE status = 'active' AND delete_after <= ? ORDER BY created_at ASC LIMIT ?`,
      args: [now, limit],
    }),
    dbClient.execute({
      sql: `SELECT asset_id FROM tokenless_public_question_media
            WHERE technical_status = 'ready' AND deletion_requested_at <= ?
            ORDER BY deletion_requested_at ASC LIMIT ?`,
      args: [now, limit],
    }),
  ]);
  for (const row of settlements.rows) {
    await insertWorkItem("publish_finalized_round", rowString(row as Row, "operation_key")!, now);
  }
  for (const row of deletions.rows) {
    await insertWorkItem("delete_artifact", rowString(row as Row, "object_id")!, now);
  }
  for (const row of publicMediaDeletions.rows) {
    await insertWorkItem("delete_public_media", rowString(row as Row, "asset_id")!, now);
  }
  return {
    deletions: deletions.rows.length,
    publicMediaDeletions: publicMediaDeletions.rows.length,
    settlements: settlements.rows.length,
  };
}

type MaintenanceProcessors = {
  deleteArtifact: typeof processArtifactDeletionByObjectId;
  deletePublicMedia: typeof processPublicQuestionMediaDeletionByAssetId;
  publishFinalizedRound: (input: { operationKey: string; appOrigin: string; now: Date }) => Promise<void>;
  deliverWebhooks: typeof deliverPendingWebhooks;
  processNotifications: typeof runTokenlessNotificationCycle;
  processSurpriseBounties: typeof processSurpriseBountyPayments;
  projectAssuranceEvents: typeof projectAssuranceLifecycleEvents;
  deliverAssuranceEvents: typeof deliverPendingAssuranceEvents;
  processGrcReconciliations: typeof processDueGrcReconciliations;
  processWormExports: typeof processDueAssuranceWormExports;
  processAttestations: typeof processDueAssuranceAttestations;
  processEvidenceRetention: typeof processDueEvidenceRetentionEnforcement;
  reconcileDeletionJobs: typeof reconcileWorkspaceDeletionJobs;
  expireDeletedAuthGuards: typeof expireDeletedAuthSubjectGuards;
  reconcilePrepaidTopups: typeof reconcilePrepaidTopups;
  drainPrepaidTopupAudit: typeof drainPrepaidTopupAuditOutbox;
  drainEnterpriseIdentityAudit: typeof drainEnterpriseIdentityAuditOutbox;
  reconcileEnterpriseIdentityAudit: typeof reconcileEnterpriseIdentityAuditReservations;
  refreshMechanismHealth: typeof refreshCompletedAssuranceMechanismHealth;
  sweepExpiredQuotes: typeof sweepExpiredTokenlessQuotes;
};

const defaultProcessors: MaintenanceProcessors = {
  deleteArtifact: processArtifactDeletionByObjectId,
  deletePublicMedia: processPublicQuestionMediaDeletionByAssetId,
  async publishFinalizedRound({ operationKey, appOrigin, now }) {
    await appendFinalizedRoundEvidence({ operationKey });
    await reviewAndPublishResult({ operationKey, appOrigin, now });
  },
  deliverWebhooks: deliverPendingWebhooks,
  processNotifications: runTokenlessNotificationCycle,
  processSurpriseBounties: processSurpriseBountyPayments,
  projectAssuranceEvents: projectAssuranceLifecycleEvents,
  deliverAssuranceEvents: deliverPendingAssuranceEvents,
  processGrcReconciliations: processDueGrcReconciliations,
  processWormExports: processDueAssuranceWormExports,
  processAttestations: processDueAssuranceAttestations,
  processEvidenceRetention: processDueEvidenceRetentionEnforcement,
  reconcileDeletionJobs: reconcileWorkspaceDeletionJobs,
  expireDeletedAuthGuards: expireDeletedAuthSubjectGuards,
  reconcilePrepaidTopups,
  drainPrepaidTopupAudit: drainPrepaidTopupAuditOutbox,
  drainEnterpriseIdentityAudit: drainEnterpriseIdentityAuditOutbox,
  reconcileEnterpriseIdentityAudit: reconcileEnterpriseIdentityAuditReservations,
  refreshMechanismHealth: refreshCompletedAssuranceMechanismHealth,
  sweepExpiredQuotes: sweepExpiredTokenlessQuotes,
};

async function claimDueWork(now: Date, limit: number) {
  await dbClient.execute({
    sql: `UPDATE tokenless_scheduled_work_items
          SET state = 'retry', next_attempt_at = ?, last_error = 'stale worker claim recovered', updated_at = ?
          WHERE state = 'processing' AND updated_at <= ?`,
    args: [now, now, new Date(now.getTime() - STALE_CLAIM_MS)],
  });
  const due = await dbClient.execute({
    sql: `SELECT item_id, kind, subject_key, attempt_count
          FROM tokenless_scheduled_work_items
          WHERE state IN ('pending', 'retry') AND next_attempt_at <= ?
          ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?`,
    args: [now, limit],
  });
  const claimed: Row[] = [];
  for (const value of due.rows) {
    const row = value as Row;
    const result = await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items SET state = 'processing', updated_at = ?
            WHERE item_id = ? AND state IN ('pending', 'retry')`,
      args: [now, rowString(row, "item_id")],
    });
    if (result.rowCount === 1) claimed.push(row);
  }
  return claimed;
}

async function processClaimedWork(input: {
  appOrigin: string;
  items: Row[];
  now: Date;
  processors: MaintenanceProcessors;
}) {
  const summary = { completed: 0, dead: 0, deferred: 0, retry: 0 };
  for (const row of input.items) {
    const itemId = rowString(row, "item_id")!;
    const kind = rowString(row, "kind") as WorkKind;
    const subjectKey = rowString(row, "subject_key")!;
    const attempt = Number(row.attempt_count) + 1;
    try {
      if (kind === "publish_finalized_round") {
        await input.processors.publishFinalizedRound({
          operationKey: subjectKey,
          appOrigin: input.appOrigin,
          now: input.now,
        });
      } else if (kind === "delete_artifact") {
        const deleted = await input.processors.deleteArtifact(subjectKey, input.now);
        if (!deleted) {
          throw new TokenlessServiceError("Artifact deletion is still pending.", 409, "deletion_not_due", true);
        }
      } else if (kind === "delete_public_media") {
        const deleted = await input.processors.deletePublicMedia(subjectKey, input.now);
        if (!deleted) {
          throw new TokenlessServiceError("Public media deletion is still pending.", 409, "deletion_not_due", true);
        }
      } else {
        throw new Error(`Unsupported scheduled work kind: ${String(kind)}`);
      }
      await dbClient.execute({
        sql: `UPDATE tokenless_scheduled_work_items
              SET state = 'completed', attempt_count = ?, last_error = NULL, completed_at = ?, updated_at = ?
              WHERE item_id = ? AND state = 'processing'`,
        args: [attempt, input.now, input.now, itemId],
      });
      summary.completed += 1;
    } catch (error) {
      const deferred = error instanceof TokenlessServiceError && NON_COUNTING_DEFER_CODES.has(error.code);
      const recordedAttempt = deferred ? Number(row.attempt_count) : attempt;
      const dead = !deferred && recordedAttempt >= MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Scheduled work failed";
      await dbClient.execute({
        sql: `UPDATE tokenless_scheduled_work_items
              SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, dead_at = ?, updated_at = ?
              WHERE item_id = ? AND state = 'processing'`,
        args: [
          dead ? "dead" : "retry",
          recordedAttempt,
          retryAt(input.now, deferred ? 1 : recordedAttempt),
          message,
          dead ? input.now : null,
          input.now,
          itemId,
        ],
      });
      summary[dead ? "dead" : deferred ? "deferred" : "retry"] += 1;
    }
  }
  return summary;
}

export async function runTokenlessScheduledMaintenance(input: {
  appOrigin: string;
  now?: Date;
  workLimit?: number;
  webhookLimit?: number;
  notificationLimit?: number;
  processors?: Partial<MaintenanceProcessors>;
}) {
  const now = input.now ?? new Date();
  const workLimit = bounded(input.workLimit, DEFAULT_WORK_LIMIT, 100);
  const webhookLimit = bounded(input.webhookLimit, DEFAULT_WEBHOOK_LIMIT, 100);
  const notificationLimit = bounded(input.notificationLimit, DEFAULT_NOTIFICATION_LIMIT, 50);
  const bucket = Math.floor(now.getTime() / RUN_BUCKET_MS);
  const idempotencyKey = `tokenless-maintenance:${bucket}`;
  const runId = `swr_${digest(idempotencyKey).slice(0, 40)}`;
  const existingRun = await dbClient.execute({
    sql: "SELECT run_id FROM tokenless_scheduled_worker_runs WHERE idempotency_key = ? LIMIT 1",
    args: [idempotencyKey],
  });
  if (existingRun.rows.length > 0) return { runId, status: "duplicate" as const };
  const started = await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_worker_runs
          (run_id, idempotency_key, trigger, status, started_at)
          VALUES (?, ?, 'vercel_cron', 'running', ?)
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING run_id`,
    args: [runId, idempotencyKey, now],
  });
  if (started.rowCount !== 1) return { runId, status: "duplicate" as const };

  try {
    const processors: MaintenanceProcessors = { ...defaultProcessors, ...input.processors };
    const expiredQuotes = await processors.sweepExpiredQuotes({ now, limit: workLimit });
    const evidenceRetention = await processors.processEvidenceRetention({
      now,
      limit: workLimit,
      itemLimit: workLimit,
    });
    const seeded = await seedTokenlessScheduledWork(now);
    const items = await claimDueWork(now, workLimit);
    const work = await processClaimedWork({
      appOrigin: input.appOrigin,
      items,
      now,
      processors,
    });
    const deletionJobs = await processors.reconcileDeletionJobs(now, workLimit);
    const deletedAuthGuards = await processors.expireDeletedAuthGuards(now, workLimit);
    const surpriseBounties = await processors.processSurpriseBounties({
      now,
      limit: workLimit,
    });
    const grcReconciliations = await processors.processGrcReconciliations({
      now,
      limit: 1,
    });
    const wormExports = await processors.processWormExports({
      now,
      limit: workLimit,
    });
    const attestations = await processors.processAttestations({
      now,
      limit: workLimit,
    });
    const prepaidTopups = await processors.reconcilePrepaidTopups({ now, limit: workLimit });
    const prepaidTopupAudit = await processors.drainPrepaidTopupAudit({ limit: webhookLimit });
    const enterpriseIdentityAuditReservations = await processors.reconcileEnterpriseIdentityAudit(webhookLimit);
    const enterpriseIdentityAudit = await processors.drainEnterpriseIdentityAudit(now, webhookLimit);
    const mechanismHealth = await processors.refreshMechanismHealth({ now, limit: workLimit });
    const assuranceEventProjection = await processors.projectAssuranceEvents({
      now,
      limit: webhookLimit,
    });
    const assuranceEventOutcomes = await processors.deliverAssuranceEvents({
      now,
      limit: webhookLimit,
    });
    const assuranceEvents = {
      projection: assuranceEventProjection,
      delivery: {
        dead: assuranceEventOutcomes.filter(value => value.state === "dead").length,
        delivered: assuranceEventOutcomes.filter(value => value.state === "delivered").length,
        retry: assuranceEventOutcomes.filter(value => value.state === "retry").length,
      },
    };
    const webhookOutcomes = await processors.deliverWebhooks({
      now,
      limit: webhookLimit,
    });
    const webhooks = {
      dead: webhookOutcomes.filter(value => value.state === "dead").length,
      delivered: webhookOutcomes.filter(value => value.state === "delivered").length,
      retry: webhookOutcomes.filter(value => value.state === "retry").length,
    };
    const notifications = await processors.processNotifications({
      appOrigin: input.appOrigin,
      now,
      limit: notificationLimit,
    });
    const status =
      work.dead > 0 ||
      work.retry > 0 ||
      webhooks.dead > 0 ||
      webhooks.retry > 0 ||
      notifications.dead > 0 ||
      notifications.retry > 0 ||
      surpriseBounties.retry > 0 ||
      surpriseBounties.reconciliationRequired > 0 ||
      grcReconciliations.retry > 0 ||
      grcReconciliations.failed > 0 ||
      wormExports.retry > 0 ||
      wormExports.dead > 0 ||
      attestations.retry > 0 ||
      attestations.dead > 0 ||
      attestations.unavailable > 0 ||
      evidenceRetention.retry > 0 ||
      evidenceRetention.dead > 0 ||
      evidenceRetention.backlog > 0 ||
      assuranceEvents.projection.retry > 0 ||
      assuranceEvents.delivery.retry > 0 ||
      assuranceEvents.delivery.dead > 0 ||
      prepaidTopups.failed > 0 ||
      prepaidTopupAudit.attempted > prepaidTopupAudit.delivered ||
      enterpriseIdentityAudit.retry > 0
        ? "degraded"
        : "healthy";
    const summary = {
      seeded,
      work,
      webhooks,
      notifications,
      deletionJobs,
      deletedAuthGuards,
      surpriseBounties,
      grcReconciliations,
      wormExports,
      attestations,
      evidenceRetention,
      assuranceEvents,
      prepaidTopups: { reconciliation: prepaidTopups, audit: prepaidTopupAudit },
      enterpriseIdentityAudit: { reservations: enterpriseIdentityAuditReservations, delivery: enterpriseIdentityAudit },
      mechanismHealth,
      expiredQuotes,
      adaptiveRollups: "not_scheduled_until_a_persisted_rollup_processor_exists",
    };
    await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_worker_runs
            SET status = ?, summary_json = ?, completed_at = ? WHERE run_id = ?`,
      args: [status, JSON.stringify(summary), now, runId],
    });
    return { runId, status, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Scheduled maintenance failed";
    await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_worker_runs
            SET status = 'failed', last_error = ?, completed_at = ? WHERE run_id = ?`,
      args: [message, now, runId],
    });
    throw error;
  }
}

export function authorizeTokenlessCron(authorization: string | null, cronSecret = process.env.CRON_SECRET) {
  const secret = cronSecret?.trim();
  if (!secret) throw new TokenlessServiceError("Scheduled workers are not configured.", 503, "cron_unavailable");
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  const supplied = createHash("sha256")
    .update(authorization ?? "")
    .digest();
  if (!expected.equals(supplied)) {
    throw new TokenlessServiceError("Invalid scheduled worker credential.", 401, "invalid_cron_credential");
  }
}

export const __scheduledMaintenanceTestUtils = { retryAt, workItemId };
