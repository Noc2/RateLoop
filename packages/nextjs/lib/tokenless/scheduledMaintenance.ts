import { createHash } from "node:crypto";
import "server-only";
import {
  drainEnterpriseIdentityAuditOutbox,
  reconcileEnterpriseIdentityAuditReservations,
} from "~~/lib/auth/enterpriseIdentityAudit";
import { drainPrepaidTopupAuditOutbox, reconcilePrepaidTopups } from "~~/lib/billing/prepaidTopups";
import { dbClient } from "~~/lib/db";
import { runTokenlessNotificationCycle } from "~~/lib/notifications/delivery";
import {
  expireDeletedAuthSubjectGuards,
  reconcileDeletedAccountPaidAssignmentSeats,
  reconcileWorkspaceDeletionJobs,
} from "~~/lib/privacy/deletionReconciliation";
import { processSubjectRequestQueue } from "~~/lib/privacy/lifecycle";
import { purgeExpiredPrivacyOperations } from "~~/lib/privacy/privacyRetention";
import { expireWorkspaceDeletionRetentionCategories } from "~~/lib/privacy/workspaceDeletionRetention";
import { processArtifactDeletionByObjectId } from "~~/lib/tokenless/artifactPrivacy";
import { processDueAssuranceAttestations } from "~~/lib/tokenless/assuranceAttestationRuntime";
import {
  deliverPendingAssuranceEvents,
  projectAssuranceLifecycleEvents,
} from "~~/lib/tokenless/assuranceEventStreaming";
import { processDueGrcReconciliations } from "~~/lib/tokenless/assuranceGrcConnectors";
import { processDueAssuranceWormExports } from "~~/lib/tokenless/assuranceWormExports";
import { expireAudienceAssignments } from "~~/lib/tokenless/audienceAssignments";
import { reconcileChainPayment } from "~~/lib/tokenless/chain/payments";
import { projectDueDirectPrivateReviewDecisionEvidence } from "~~/lib/tokenless/directPrivateReviewEvidence";
import { processDueEvidenceRetentionEnforcement } from "~~/lib/tokenless/evidenceRetentionEnforcement";
import {
  produceScheduledIntegrityEpoch,
  purgeExpiredIntegrityEpochPrivateFeatures,
} from "~~/lib/tokenless/integrityEpochProducer";
import { refreshCompletedAssuranceMechanismHealth } from "~~/lib/tokenless/mechanismHealth";
import { reconcileNetworkAssignmentSettlements } from "~~/lib/tokenless/networkAssignmentSettlement";
import { sweepManagedEvmNonceDrift, unresolvedManagedEvmNonceFindings } from "~~/lib/tokenless/nonceRecovery";
import { reconcilePaidAssignmentSettlements } from "~~/lib/tokenless/paidAssignmentSettlementReconciler";
import { reconcileDueDirectPrivateReviewDeadlines } from "~~/lib/tokenless/privateReviewResponses";
import { expirePrivateUnpaidReviewReservations } from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import {
  PUBLIC_NETWORK_FOUNDATION_ORPHAN_TTL_MS,
  abandonStalePublicNetworkFoundation,
  preparePublicNetworkAudienceForBinding,
} from "~~/lib/tokenless/publicNetworkReviewReachability";
import { processPublicQuestionMediaDeletionByAssetId } from "~~/lib/tokenless/publicQuestionMedia";
import { reconcilePaidRaterCommit } from "~~/lib/tokenless/raterService";
import { TokenlessServiceError, sweepExpiredTokenlessQuotes } from "~~/lib/tokenless/server";
import { processSurpriseBountyPayments } from "~~/lib/tokenless/surpriseBountyService";
import {
  appendFinalizedRoundEvidence,
  deliverPendingWebhooks,
  reviewAndPublishResult,
} from "~~/lib/tokenless/transparency";

type Row = Record<string, unknown>;
type WorkKind =
  | "publish_finalized_round"
  | "recover_chain_execution"
  | "recover_rater_commit"
  | "delete_artifact"
  | "delete_public_media"
  | "prepare_public_network_audience"
  | "cleanup_public_network_foundation";

const RUN_BUCKET_MS = 5 * 60_000;
const STALE_CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 20;
const DEFAULT_WORK_LIMIT = 20;
const DEFAULT_WEBHOOK_LIMIT = 50;
const DEFAULT_NOTIFICATION_LIMIT = 20;
const EVIDENCE_PENDING_ALERT_SECONDS = 15 * 60;
const NON_COUNTING_DEFER_CODES = new Set([
  "indexed_evidence_pending",
  "evidence_pending",
  "execution_in_progress",
  "rater_commit_recovery_pending",
  "deletion_blocked_by_hold",
  "deletion_not_due",
]);
const NON_COUNTING_NONCE_RECOVERY_CODES = new Set([
  "chain_broadcast_unconfirmed",
  "managed_signer_outage",
  "managed_signer_throttled",
  "managed_signer_timeout",
  "rater_broadcast_unconfirmed",
]);
const NONCE_INTEGRITY_CODES = new Set([
  "chain_transaction_reconciliation_required",
  "rater_signed_transaction_mismatch",
  "rater_transaction_reconciliation_required",
  "signed_transaction_mismatch",
]);
const NONCE_ALREADY_CONSUMED_CODES = new Set(["prepaid_approval_failed", "round_submission_failed"]);
const OPERATOR_ACTION_CODES = new Set(["evm_transaction_fee_policy_exhausted"]);
const IMMEDIATE_DEAD_LETTER_CODES = new Set(["x402_authorization_used_reconciliation_required"]);

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const raw = row?.[key];
  if (raw === null || raw === undefined) return null;
  const value = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(value.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return value;
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

// An item that exhausted MAX_ATTEMPTS gave up on an outage, not on the work itself: the seeding
// query still selects its subject, so the work is still owed. Without this it stayed dead forever,
// because nothing resets a dead row and nothing deletes one, and each dead row went on consuming a
// seeding slot until new work stopped being seeded at all.
//
// The wait keeps a genuinely unservable subject from cycling: it can retry at most once per window
// rather than continuously. Items dead-lettered for a terminal reason keep their low attempt count
// and are deliberately not revived, since those need an operator rather than another attempt.
const DEAD_WORK_REVIVAL_DELAY_MS = 6 * 60 * 60 * 1000;

async function insertWorkItem(kind: WorkKind, subjectKey: string, now: Date) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_work_items
          (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
          ON CONFLICT (kind, subject_key) DO UPDATE
          SET state = 'pending', attempt_count = 0, next_attempt_at = ?, last_error = NULL,
              dead_at = NULL, updated_at = ?
          WHERE tokenless_scheduled_work_items.state = 'dead'
            AND tokenless_scheduled_work_items.attempt_count >= ?
            AND tokenless_scheduled_work_items.dead_at <= ?`,
    args: [
      workItemId(kind, subjectKey),
      kind,
      subjectKey,
      now,
      now,
      now,
      now,
      now,
      MAX_ATTEMPTS,
      new Date(now.getTime() - DEAD_WORK_REVIVAL_DELAY_MS),
    ],
  });
}

async function hasFreshReservedNonce(kind: WorkKind, subjectKey: string) {
  if (kind === "recover_chain_execution") {
    const result = await dbClient.execute({
      sql: `SELECT execution_id FROM tokenless_chain_executions
            WHERE operation_key = ? AND transaction_recovery_version = 1
              AND (approval_nonce IS NOT NULL OR submission_nonce IS NOT NULL) LIMIT 1`,
      args: [subjectKey],
    });
    return result.rows.length === 1;
  }
  if (kind === "recover_rater_commit") {
    const result = await dbClient.execute({
      sql: `SELECT commit_id FROM tokenless_rater_commits
            WHERE commit_id = ? AND transaction_recovery_version = 1 AND relay_nonce IS NOT NULL LIMIT 1`,
      args: [subjectKey],
    });
    return result.rows.length === 1;
  }
  return false;
}

export async function seedTokenlessScheduledWork(now = new Date(), scanLimit = 100) {
  const limit = bounded(scanLimit, 100, 200);
  const [
    settlements,
    chainRecoveries,
    raterCommitRecoveries,
    deletions,
    publicMediaDeletions,
    publicNetworkAudiences,
    publicNetworkFoundations,
  ] = await Promise.all([
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
      sql: `SELECT operation_key
            FROM tokenless_chain_executions
            WHERE payment_mode IN ('prepaid', 'x402')
              AND (
                (state IN ('signed', 'broadcast')
                  AND (claim_owner IS NULL OR claim_expires_at IS NULL OR claim_expires_at <= ?))
                OR (state = 'prepared' AND claim_owner IS NOT NULL AND claim_expires_at <= ?)
              )
            ORDER BY updated_at ASC, operation_key ASC LIMIT ?`,
      args: [now, now, limit],
    }),
    dbClient.execute({
      sql: `SELECT commit_id
            FROM tokenless_rater_commits
            WHERE (
                state IN ('signed', 'retry')
                AND relay_signed_transaction IS NOT NULL AND transaction_hash IS NOT NULL
              ) OR (
                state = 'prepared' AND relay_nonce IS NOT NULL
                AND transaction_recovery_version = 1
              ) OR (state = 'submitted' AND transaction_hash IS NOT NULL)
            ORDER BY updated_at ASC, commit_id ASC LIMIT ?`,
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
    dbClient.execute({
      sql: `SELECT binding.binding_id
            FROM tokenless_public_network_review_bindings binding
            JOIN tokenless_chain_executions execution
              ON execution.operation_key = binding.operation_key
            WHERE binding.state IN ('ask_bound','round_bound')
              AND binding.worker_next_attempt_at <= ?
              AND (
                binding.state = 'round_bound'
                OR (execution.state = 'confirmed' AND execution.round_id IS NOT NULL)
              )
            ORDER BY binding.worker_next_attempt_at ASC,binding.created_at ASC,binding.binding_id ASC
            LIMIT ?`,
      args: [now, limit],
    }),
    dbClient.execute({
      sql: `SELECT binding_id
            FROM tokenless_public_network_review_bindings
            WHERE state IN ('foundation_preparing','foundation_ready')
              AND operation_key IS NULL AND created_at <= ?
            ORDER BY created_at ASC,binding_id ASC LIMIT ?`,
      args: [new Date(now.getTime() - PUBLIC_NETWORK_FOUNDATION_ORPHAN_TTL_MS), limit],
    }),
  ]);
  for (const row of settlements.rows) {
    await insertWorkItem("publish_finalized_round", rowString(row as Row, "operation_key")!, now);
  }
  for (const row of chainRecoveries.rows) {
    await insertWorkItem("recover_chain_execution", rowString(row as Row, "operation_key")!, now);
  }
  for (const row of raterCommitRecoveries.rows) {
    const commitId = rowString(row as Row, "commit_id")!;
    await insertWorkItem("recover_rater_commit", commitId, now);
    await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items
            SET state = 'pending', next_attempt_at = ?, completed_at = NULL, updated_at = ?
            WHERE kind = 'recover_rater_commit' AND subject_key = ? AND state = 'completed'`,
      args: [now, now, commitId],
    });
  }
  for (const row of deletions.rows) {
    await insertWorkItem("delete_artifact", rowString(row as Row, "object_id")!, now);
  }
  for (const row of publicMediaDeletions.rows) {
    await insertWorkItem("delete_public_media", rowString(row as Row, "asset_id")!, now);
  }
  for (const row of publicNetworkAudiences.rows) {
    const bindingId = rowString(row as Row, "binding_id")!;
    await insertWorkItem("prepare_public_network_audience", bindingId, now);
    await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items
            SET state='pending',next_attempt_at=?,completed_at=NULL,updated_at=?
            WHERE kind='prepare_public_network_audience' AND subject_key=? AND state='completed'`,
      args: [now, now, bindingId],
    });
  }
  for (const row of publicNetworkFoundations.rows) {
    await insertWorkItem("cleanup_public_network_foundation", rowString(row as Row, "binding_id")!, now);
  }
  return {
    chainRecoveries: chainRecoveries.rows.length,
    deletions: deletions.rows.length,
    publicNetworkAudiences: publicNetworkAudiences.rows.length,
    publicNetworkFoundations: publicNetworkFoundations.rows.length,
    publicMediaDeletions: publicMediaDeletions.rows.length,
    raterCommitRecoveries: raterCommitRecoveries.rows.length,
    settlements: settlements.rows.length,
  };
}

type MaintenanceProcessors = {
  deleteArtifact: typeof processArtifactDeletionByObjectId;
  deletePublicMedia: typeof processPublicQuestionMediaDeletionByAssetId;
  preparePublicNetworkAudience: typeof preparePublicNetworkAudienceForBinding;
  cleanupPublicNetworkFoundation: typeof abandonStalePublicNetworkFoundation;
  publishFinalizedRound: (input: { operationKey: string; appOrigin: string; now: Date }) => Promise<void>;
  recoverChainExecution: (input: { operationKey: string }) => Promise<{ paymentState: string } | null>;
  recoverRaterCommit: (commitId: string) => Promise<{ state: string | null } | null>;
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
  reconcileDeletedAccountPaidAssignmentSeats: typeof reconcileDeletedAccountPaidAssignmentSeats;
  expireDeletedAuthGuards: typeof expireDeletedAuthSubjectGuards;
  processSubjectRequests: typeof processSubjectRequestQueue;
  purgePrivacyOperations: typeof purgeExpiredPrivacyOperations;
  expireWorkspaceDeletionRetention: typeof expireWorkspaceDeletionRetentionCategories;
  reconcilePrepaidTopups: typeof reconcilePrepaidTopups;
  drainPrepaidTopupAudit: typeof drainPrepaidTopupAuditOutbox;
  drainEnterpriseIdentityAudit: typeof drainEnterpriseIdentityAuditOutbox;
  reconcileEnterpriseIdentityAudit: typeof reconcileEnterpriseIdentityAuditReservations;
  refreshMechanismHealth: typeof refreshCompletedAssuranceMechanismHealth;
  sweepNonceDrift: typeof sweepManagedEvmNonceDrift;
  sweepExpiredQuotes: typeof sweepExpiredTokenlessQuotes;
  reconcileDirectPrivateReviewDeadlines: typeof reconcileDueDirectPrivateReviewDeadlines;
  reconcilePaidAssignmentSettlements: typeof reconcilePaidAssignmentSettlements;
  reconcileNetworkAssignmentSettlements: typeof reconcileNetworkAssignmentSettlements;
  projectDirectPrivateReviewEvidence: typeof projectDueDirectPrivateReviewDecisionEvidence;
  expireAudienceAssignments: typeof expireAudienceAssignments;
  expirePrivateReviewReservations: typeof expirePrivateUnpaidReviewReservations;
  produceIntegrityEpoch: typeof produceScheduledIntegrityEpoch;
  purgeIntegrityPrivateFeatures: typeof purgeExpiredIntegrityEpochPrivateFeatures;
};

type MaintenanceProcessorFailure = {
  processor: keyof MaintenanceProcessors;
  errorCode: string;
};

function maintenanceProcessorErrorCode(error: unknown) {
  if (error instanceof TokenlessServiceError) return error.code;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name)) {
    return error.name;
  }
  return "processor_error";
}

async function runIsolatedMaintenanceProcessor<T>(input: {
  failures: MaintenanceProcessorFailure[];
  processor: keyof MaintenanceProcessors;
  run: () => Promise<T>;
  fallback: T;
}) {
  try {
    return await input.run();
  } catch (error) {
    input.failures.push({
      processor: input.processor,
      errorCode: maintenanceProcessorErrorCode(error),
    });
    return input.fallback;
  }
}

const defaultProcessors: MaintenanceProcessors = {
  deleteArtifact: processArtifactDeletionByObjectId,
  deletePublicMedia: processPublicQuestionMediaDeletionByAssetId,
  preparePublicNetworkAudience: preparePublicNetworkAudienceForBinding,
  cleanupPublicNetworkFoundation: abandonStalePublicNetworkFoundation,
  async publishFinalizedRound({ operationKey, appOrigin, now }) {
    await appendFinalizedRoundEvidence({ operationKey });
    await reviewAndPublishResult({ operationKey, appOrigin, now });
  },
  async recoverChainExecution({ operationKey }) {
    return reconcileChainPayment(operationKey);
  },
  recoverRaterCommit: reconcilePaidRaterCommit,
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
  reconcileDeletedAccountPaidAssignmentSeats,
  expireDeletedAuthGuards: expireDeletedAuthSubjectGuards,
  processSubjectRequests: processSubjectRequestQueue,
  purgePrivacyOperations: purgeExpiredPrivacyOperations,
  expireWorkspaceDeletionRetention: expireWorkspaceDeletionRetentionCategories,
  reconcilePrepaidTopups,
  drainPrepaidTopupAudit: drainPrepaidTopupAuditOutbox,
  drainEnterpriseIdentityAudit: drainEnterpriseIdentityAuditOutbox,
  reconcileEnterpriseIdentityAudit: reconcileEnterpriseIdentityAuditReservations,
  refreshMechanismHealth: refreshCompletedAssuranceMechanismHealth,
  sweepNonceDrift: sweepManagedEvmNonceDrift,
  sweepExpiredQuotes: sweepExpiredTokenlessQuotes,
  reconcileDirectPrivateReviewDeadlines: reconcileDueDirectPrivateReviewDeadlines,
  reconcilePaidAssignmentSettlements,
  reconcileNetworkAssignmentSettlements,
  projectDirectPrivateReviewEvidence: projectDueDirectPrivateReviewDecisionEvidence,
  expireAudienceAssignments,
  expirePrivateReviewReservations: expirePrivateUnpaidReviewReservations,
  produceIntegrityEpoch: produceScheduledIntegrityEpoch,
  purgeIntegrityPrivateFeatures: purgeExpiredIntegrityEpochPrivateFeatures,
};

async function claimDueWork(now: Date, limit: number) {
  await dbClient.execute({
    sql: `UPDATE tokenless_scheduled_work_items
          SET state = 'retry', next_attempt_at = ?, last_error = 'stale worker claim recovered', updated_at = ?
          WHERE state = 'processing' AND updated_at <= ?`,
    args: [now, now, new Date(now.getTime() - STALE_CLAIM_MS)],
  });
  const due = await dbClient.execute({
    sql: `SELECT item_id, claim_generation
          FROM tokenless_scheduled_work_items
          WHERE state IN ('pending', 'retry') AND next_attempt_at <= ? AND claim_generation < 2147483647
          ORDER BY next_attempt_at ASC, created_at ASC LIMIT ?`,
    args: [now, limit],
  });
  const claimed: Row[] = [];
  for (const value of due.rows) {
    const row = value as Row;
    const result = await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items
            SET state = 'processing', claim_generation = claim_generation + 1, updated_at = ?
            WHERE item_id = ? AND state IN ('pending', 'retry') AND next_attempt_at <= ?
              AND claim_generation = ? AND claim_generation < 2147483647
            RETURNING item_id, kind, subject_key, attempt_count, claim_generation`,
      args: [now, rowString(row, "item_id"), now, Number(row.claim_generation)],
    });
    if (result.rows[0]) claimed.push(result.rows[0] as Row);
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
    const claimGeneration = Number(row.claim_generation);
    try {
      if (kind === "publish_finalized_round") {
        await input.processors.publishFinalizedRound({
          operationKey: subjectKey,
          appOrigin: input.appOrigin,
          now: input.now,
        });
      } else if (kind === "recover_chain_execution") {
        const recovered = await input.processors.recoverChainExecution({ operationKey: subjectKey });
        if (recovered?.paymentState !== "confirmed") {
          throw new TokenlessServiceError(
            "Chain execution recovery is still pending.",
            409,
            "chain_recovery_pending",
            true,
          );
        }
      } else if (kind === "recover_rater_commit") {
        const recovered = await input.processors.recoverRaterCommit(subjectKey);
        if (!new Set(["confirmed", "failed"]).has(recovered?.state ?? "")) {
          throw new TokenlessServiceError(
            "Rater commit recovery is still pending.",
            409,
            "rater_commit_recovery_pending",
            true,
          );
        }
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
      } else if (kind === "prepare_public_network_audience") {
        await input.processors.preparePublicNetworkAudience(subjectKey, input.now);
      } else if (kind === "cleanup_public_network_foundation") {
        await input.processors.cleanupPublicNetworkFoundation(subjectKey, input.now);
      } else {
        throw new Error(`Unsupported scheduled work kind: ${String(kind)}`);
      }
      const completed = await dbClient.execute({
        sql: `UPDATE tokenless_scheduled_work_items
              SET state = 'completed', attempt_count = ?, last_error = NULL, completed_at = ?, updated_at = ?
              WHERE item_id = ? AND state = 'processing' AND claim_generation = ?
              RETURNING item_id`,
        args: [attempt, input.now, input.now, itemId, claimGeneration],
      });
      if (completed.rows.length === 1) summary.completed += 1;
    } catch (error) {
      const nonceIntegrityFailure = error instanceof TokenlessServiceError && NONCE_INTEGRITY_CODES.has(error.code);
      const operatorActionFailure = error instanceof TokenlessServiceError && OPERATOR_ACTION_CODES.has(error.code);
      const nonceAlreadyConsumed =
        error instanceof TokenlessServiceError && NONCE_ALREADY_CONSUMED_CODES.has(error.code);
      const reservedNonceMustProgress =
        !nonceAlreadyConsumed &&
        !operatorActionFailure &&
        new Set<WorkKind>(["recover_chain_execution", "recover_rater_commit"]).has(kind) &&
        (await hasFreshReservedNonce(kind, subjectKey));
      const deferred =
        (!nonceIntegrityFailure && !operatorActionFailure && reservedNonceMustProgress) ||
        (error instanceof TokenlessServiceError &&
          (NON_COUNTING_DEFER_CODES.has(error.code) ||
            (new Set(["recover_chain_execution", "recover_rater_commit"]).has(kind) &&
              NON_COUNTING_NONCE_RECOVERY_CODES.has(error.code))));
      const recordedAttempt = deferred ? Number(row.attempt_count) : attempt;
      const immediatelyDead =
        nonceIntegrityFailure ||
        operatorActionFailure ||
        (error instanceof TokenlessServiceError && IMMEDIATE_DEAD_LETTER_CODES.has(error.code));
      const dead = !deferred && (immediatelyDead || recordedAttempt >= MAX_ATTEMPTS);
      const rawMessage = error instanceof Error ? error.message : "Scheduled work failed";
      const diagnosticPrefix = nonceIntegrityFailure
        ? `nonce_integrity:${error.code}: `
        : operatorActionFailure
          ? `operator_action:${error.code}: `
          : "";
      const message = `${diagnosticPrefix}${rawMessage}`.slice(0, 500);
      const failed = await dbClient.execute({
        sql: `UPDATE tokenless_scheduled_work_items
              SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, dead_at = ?, updated_at = ?
              WHERE item_id = ? AND state = 'processing' AND claim_generation = ?
              RETURNING item_id`,
        args: [
          dead ? "dead" : "retry",
          recordedAttempt,
          retryAt(input.now, deferred ? 1 : recordedAttempt),
          message,
          dead ? input.now : null,
          input.now,
          itemId,
          claimGeneration,
        ],
      });
      if (failed.rows.length === 1) summary[dead ? "dead" : deferred ? "deferred" : "retry"] += 1;
    }
  }
  return summary;
}

async function evidencePendingOperationalHealth(now: Date) {
  const result = await dbClient.execute(
    `SELECT COUNT(*) AS pending_count, MIN(created_at) AS oldest_created_at
     FROM tokenless_scheduled_work_items
     WHERE kind = 'publish_finalized_round' AND state IN ('pending','retry','processing','dead')`,
  );
  const row = result.rows[0] as Row | undefined;
  const pendingCount = Number(row?.pending_count ?? 0);
  if (!Number.isSafeInteger(pendingCount) || pendingCount < 0) {
    throw new Error("Database returned an invalid evidence-pending count.");
  }
  const oldestCreatedAt = rowDate(row, "oldest_created_at");
  const oldestAgeSeconds = oldestCreatedAt
    ? Math.max(0, Math.floor((now.getTime() - oldestCreatedAt.getTime()) / 1_000))
    : null;
  return {
    pendingCount,
    oldestCreatedAt: oldestCreatedAt?.toISOString() ?? null,
    oldestAgeSeconds,
    alertAfterSeconds: EVIDENCE_PENDING_ALERT_SECONDS,
    alert: pendingCount > 0 && oldestAgeSeconds !== null && oldestAgeSeconds > EVIDENCE_PENDING_ALERT_SECONDS,
  };
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
    sql: "SELECT run_id, status FROM tokenless_scheduled_worker_runs WHERE idempotency_key = ? LIMIT 1",
    args: [idempotencyKey],
  });
  if (existingRun.rows.length > 0) {
    const reclaimed = await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_worker_runs
            SET status = 'running', started_at = ?, completed_at = NULL,
                summary_json = NULL, last_error = NULL
            WHERE idempotency_key = ? AND status = 'failed'
            RETURNING run_id`,
      args: [now, idempotencyKey],
    });
    if (reclaimed.rows.length !== 1) return { runId, status: "duplicate" as const };
  } else {
    const started = await dbClient.execute({
      sql: `INSERT INTO tokenless_scheduled_worker_runs
            (run_id, idempotency_key, trigger, status, started_at)
            VALUES (?, ?, 'vercel_cron', 'running', ?)
            ON CONFLICT (idempotency_key) DO NOTHING RETURNING run_id`,
      args: [runId, idempotencyKey, now],
    });
    if (started.rowCount !== 1) return { runId, status: "duplicate" as const };
  }

  try {
    const processors: MaintenanceProcessors = { ...defaultProcessors, ...input.processors };
    const processorFailures: MaintenanceProcessorFailure[] = [];
    const expiredQuotes = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "sweepExpiredQuotes",
      run: () => processors.sweepExpiredQuotes({ now, limit: workLimit }),
      fallback: { deleted: 0, scanned: 0 } as Awaited<ReturnType<MaintenanceProcessors["sweepExpiredQuotes"]>>,
    });
    const subjectRequests = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processSubjectRequests",
      run: () => processors.processSubjectRequests(now, workLimit),
      fallback: { completed: 0, queued: 0 } as Awaited<ReturnType<MaintenanceProcessors["processSubjectRequests"]>>,
    });
    const privacyRetention = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "purgePrivacyOperations",
      run: () => processors.purgePrivacyOperations(now),
      fallback: {
        betterAuthSessions: 0,
        eligibilityHandoffs: 0,
        notificationDeliveries: 0,
        orphanedScreenings: 0,
        productSessions: 0,
        staleEligibilityScopes: 0,
        subjectExports: 0,
        verifications: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["purgePrivacyOperations"]>>,
    });
    const workspaceDeletionRetention = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "expireWorkspaceDeletionRetention",
      run: () => processors.expireWorkspaceDeletionRetention(now, workLimit),
      fallback: { completed: 0, deferredByHold: 0, releasedHoldSchedules: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["expireWorkspaceDeletionRetention"]>
      >,
    });
    const directPrivateReviewDeadlines = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcileDirectPrivateReviewDeadlines",
      run: () => processors.reconcileDirectPrivateReviewDeadlines({ now, limit: workLimit }),
      fallback: { scanned: 0, finalized: 0, pending: 0, retry: 0, retryOpportunityIds: [] } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDirectPrivateReviewDeadlines"]>
      >,
    });
    const paidAssignmentSettlements = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcilePaidAssignmentSettlements",
      run: () => processors.reconcilePaidAssignmentSettlements({ now, limit: workLimit }),
      fallback: {
        scanned: 0,
        transitionedSeats: 0,
        terminalOperations: 0,
        retry: 0,
        retryOperationIds: [],
      } as Awaited<ReturnType<MaintenanceProcessors["reconcilePaidAssignmentSettlements"]>>,
    });
    const networkAssignmentSettlements = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcileNetworkAssignmentSettlements",
      run: () => processors.reconcileNetworkAssignmentSettlements({ now, limit: workLimit }),
      fallback: { scanned: 0, terminal: 0, retry: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileNetworkAssignmentSettlements"]>
      >,
    });
    const directPrivateReviewEvidence = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "projectDirectPrivateReviewEvidence",
      run: () => processors.projectDirectPrivateReviewEvidence({ now, limit: workLimit }),
      fallback: {
        scanned: 0,
        projected: 0,
        packetsReady: 0,
        retry: 0,
        retryDeliveryIds: [],
        dead: 0,
        deadDeliveryIds: [],
      } as Awaited<ReturnType<MaintenanceProcessors["projectDirectPrivateReviewEvidence"]>>,
    });
    const expiredAudienceAssignments = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "expireAudienceAssignments",
      run: () => processors.expireAudienceAssignments(now),
      fallback: { expired: 0 } as Awaited<ReturnType<MaintenanceProcessors["expireAudienceAssignments"]>>,
    });
    const expiredPrivateReviewReservations = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "expirePrivateReviewReservations",
      run: () => processors.expirePrivateReviewReservations(now),
      fallback: 0 as Awaited<ReturnType<MaintenanceProcessors["expirePrivateReviewReservations"]>>,
    });
    const integrityEpoch = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "produceIntegrityEpoch",
      run: () => processors.produceIntegrityEpoch({ now }),
      fallback: {
        status: "failed" as const,
        epochId: `integrity:${now.toISOString().slice(0, 10)}`,
        manifestHash: null,
        observations: 0,
      },
    });
    const integrityPrivateFeatureRetention = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "purgeIntegrityPrivateFeatures",
      run: () => processors.purgeIntegrityPrivateFeatures({ now, limit: workLimit * 100 }),
      fallback: { purged: 0 },
    });
    const evidenceRetention = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processEvidenceRetention",
      run: () =>
        processors.processEvidenceRetention({
          now,
          limit: workLimit,
          itemLimit: workLimit,
        }),
      fallback: {
        seeded: 0,
        due: 0,
        completed: 0,
        superseded: 0,
        retry: 0,
        dead: 0,
        objectsQueued: 0,
        accessLogsPruned: 0,
        objectsHeld: 0,
        accessLogsHeld: 0,
        backlog: 0,
        integrityRecordsPreserved: { auditEvents: 0, evidencePackets: 0, attestations: 0, wormReceipts: 0 },
        retryRunIds: [],
      } as Awaited<ReturnType<MaintenanceProcessors["processEvidenceRetention"]>>,
    });
    const nonceDriftSweep = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "sweepNonceDrift",
      run: () => processors.sweepNonceDrift({ now, limit: workLimit }),
      fallback: {
        checked: 0,
        pending: 0,
        reconciliationRequired: 0,
        reopened: 0,
        unavailable: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["sweepNonceDrift"]>>,
    });
    const seeded = await seedTokenlessScheduledWork(now);
    const items = await claimDueWork(now, workLimit);
    const work = await processClaimedWork({
      appOrigin: input.appOrigin,
      items,
      now,
      processors,
    });
    const evidencePending = await evidencePendingOperationalHealth(now);
    const deadWorkResult = await dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_scheduled_work_items WHERE state = 'dead'",
    });
    const deadWorkItems = Number((deadWorkResult.rows[0] as Row | undefined)?.count ?? 0);
    if (!Number.isSafeInteger(deadWorkItems) || deadWorkItems < 0) {
      throw new Error("Database returned an invalid scheduled dead-letter count.");
    }
    const nonceDriftFindings = await unresolvedManagedEvmNonceFindings();
    const deletionJobs = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcileDeletionJobs",
      run: () => processors.reconcileDeletionJobs(now, workLimit),
      fallback: { blocked: 0, completed: 0, pending: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDeletionJobs"]>
      >,
    });
    const deletedAccountPaidAssignmentSeats = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcileDeletedAccountPaidAssignmentSeats",
      run: () => processors.reconcileDeletedAccountPaidAssignmentSeats(now, workLimit),
      fallback: { accounts: 0, erasedSeats: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDeletedAccountPaidAssignmentSeats"]>
      >,
    });
    const deletedAuthGuards = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "expireDeletedAuthGuards",
      run: () => processors.expireDeletedAuthGuards(now, workLimit),
      fallback: { expired: 0 } as Awaited<ReturnType<MaintenanceProcessors["expireDeletedAuthGuards"]>>,
    });
    const surpriseBounties = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processSurpriseBounties",
      run: () => processors.processSurpriseBounties({ now, limit: workLimit }),
      fallback: {
        paid: 0,
        pendingClaim: 0,
        retry: 0,
        reconciliationRequired: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["processSurpriseBounties"]>>,
    });
    const grcReconciliations = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processGrcReconciliations",
      run: () => processors.processGrcReconciliations({ now, limit: 1 }),
      fallback: { enqueued: 0, claimed: 0, succeeded: 0, retry: 0, failed: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processGrcReconciliations"]>
      >,
    });
    const wormExports = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processWormExports",
      run: () => processors.processWormExports({ now, limit: workLimit }),
      fallback: { due: 0, delivered: 0, retry: 0, dead: 0, skipped: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processWormExports"]>
      >,
    });
    const attestations = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processAttestations",
      run: () => processors.processAttestations({ now, limit: workLimit }),
      fallback: { configured: false, due: 0, completed: 0, retry: 0, dead: 0, unavailable: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processAttestations"]>
      >,
    });
    const prepaidTopups = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcilePrepaidTopups",
      run: () => processors.reconcilePrepaidTopups({ now, limit: workLimit }),
      fallback: { attempted: 0, credited: 0, failed: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcilePrepaidTopups"]>
      >,
    });
    const prepaidTopupAudit = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "drainPrepaidTopupAudit",
      run: () => processors.drainPrepaidTopupAudit({ limit: webhookLimit }),
      fallback: { attempted: 0, delivered: 0 } as Awaited<ReturnType<MaintenanceProcessors["drainPrepaidTopupAudit"]>>,
    });
    const enterpriseIdentityAuditReservations = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "reconcileEnterpriseIdentityAudit",
      run: () => processors.reconcileEnterpriseIdentityAudit(webhookLimit),
      fallback: { activated: 0, inspected: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileEnterpriseIdentityAudit"]>
      >,
    });
    const enterpriseIdentityAudit = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "drainEnterpriseIdentityAudit",
      run: () => processors.drainEnterpriseIdentityAudit(now, webhookLimit),
      fallback: { delivered: 0, retry: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["drainEnterpriseIdentityAudit"]>
      >,
    });
    const mechanismHealth = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "refreshMechanismHealth",
      run: () => processors.refreshMechanismHealth({ now, limit: workLimit }),
      fallback: { refreshed: 0 } as Awaited<ReturnType<MaintenanceProcessors["refreshMechanismHealth"]>>,
    });
    const assuranceEventProjection = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "projectAssuranceEvents",
      run: () => processors.projectAssuranceEvents({ now, limit: webhookLimit }),
      fallback: {
        scanned: 0,
        projected: 0,
        replayed: 0,
        retry: 0,
        deferredWithoutPacket: { gateBlocked: 0, reviewCompleted: 0 },
        retrySources: [],
      } as Awaited<ReturnType<MaintenanceProcessors["projectAssuranceEvents"]>>,
    });
    const assuranceEventOutcomes = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "deliverAssuranceEvents",
      run: () => processors.deliverAssuranceEvents({ now, limit: webhookLimit }),
      fallback: [] as Awaited<ReturnType<MaintenanceProcessors["deliverAssuranceEvents"]>>,
    });
    const assuranceEvents = {
      projection: assuranceEventProjection,
      delivery: {
        dead: assuranceEventOutcomes.filter(value => value.state === "dead").length,
        delivered: assuranceEventOutcomes.filter(value => value.state === "delivered").length,
        retry: assuranceEventOutcomes.filter(value => value.state === "retry").length,
      },
    };
    const webhookOutcomes = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "deliverWebhooks",
      run: () => processors.deliverWebhooks({ now, limit: webhookLimit }),
      fallback: [] as Awaited<ReturnType<MaintenanceProcessors["deliverWebhooks"]>>,
    });
    const webhooks = {
      dead: webhookOutcomes.filter(value => value.state === "dead").length,
      delivered: webhookOutcomes.filter(value => value.state === "delivered").length,
      retry: webhookOutcomes.filter(value => value.state === "retry").length,
    };
    const notifications = await runIsolatedMaintenanceProcessor({
      failures: processorFailures,
      processor: "processNotifications",
      run: () =>
        processors.processNotifications({
          appOrigin: input.appOrigin,
          now,
          limit: notificationLimit,
        }),
      fallback: {
        dead: 0,
        delivered: 0,
        enqueued: 0,
        materialized: 0,
        parked: 0,
        retry: 0,
        suppressed: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["processNotifications"]>>,
    });
    const status =
      processorFailures.length > 0 ||
      deadWorkItems > 0 ||
      nonceDriftSweep.unavailable > 0 ||
      nonceDriftFindings.unresolved > 0 ||
      work.dead > 0 ||
      work.retry > 0 ||
      webhooks.dead > 0 ||
      webhooks.retry > 0 ||
      notifications.dead > 0 ||
      notifications.parked > 0 ||
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
      evidencePending.alert ||
      assuranceEvents.projection.retry > 0 ||
      assuranceEvents.delivery.retry > 0 ||
      assuranceEvents.delivery.dead > 0 ||
      prepaidTopups.failed > 0 ||
      prepaidTopupAudit.attempted > prepaidTopupAudit.delivered ||
      enterpriseIdentityAudit.retry > 0 ||
      directPrivateReviewDeadlines.retry > 0 ||
      paidAssignmentSettlements.retry > 0 ||
      networkAssignmentSettlements.retry > 0 ||
      directPrivateReviewEvidence.dead > 0 ||
      directPrivateReviewEvidence.retry > 0
        ? "degraded"
        : "healthy";
    const summary = {
      seeded,
      work,
      deadWorkItems,
      nonceDrift: { sweep: nonceDriftSweep, findings: nonceDriftFindings },
      webhooks,
      notifications,
      deletionJobs,
      deletedAccountPaidAssignmentSeats,
      deletedAuthGuards,
      surpriseBounties,
      grcReconciliations,
      wormExports,
      attestations,
      evidenceRetention,
      evidencePending,
      assuranceEvents,
      prepaidTopups: { reconciliation: prepaidTopups, audit: prepaidTopupAudit },
      enterpriseIdentityAudit: { reservations: enterpriseIdentityAuditReservations, delivery: enterpriseIdentityAudit },
      mechanismHealth,
      expiredQuotes,
      processorFailures,
      directPrivateReviewDeadlines,
      paidAssignmentSettlements,
      networkAssignmentSettlements,
      directPrivateReviewEvidence,
      expiredAudienceAssignments,
      expiredPrivateReviewReservations,
      integrityEpoch,
      integrityPrivateFeatureRetention,
      subjectRequests,
      privacyRetention,
      workspaceDeletionRetention,
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

export const __scheduledMaintenanceTestUtils = {
  evidencePendingOperationalHealth,
  retryAt,
  workItemId,
};
