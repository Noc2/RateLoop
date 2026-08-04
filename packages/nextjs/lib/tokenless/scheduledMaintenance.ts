import { createHash } from "node:crypto";
import "server-only";
import {
  drainEnterpriseIdentityAuditOutbox,
  reconcileEnterpriseIdentityAuditReservations,
} from "~~/lib/auth/enterpriseIdentityAudit";
import { drainPrepaidTopupAuditOutbox, reconcilePrepaidTopups } from "~~/lib/billing/prepaidTopups";
import { prepaidTopupsEnabled } from "~~/lib/billing/stripe";
import { dbClient } from "~~/lib/db";
import { runTokenlessNotificationCycle } from "~~/lib/notifications/delivery";
import {
  expireDeletedAuthSubjectGuards,
  reconcileDeletedAccountPaidAssignmentSeats,
  reconcileWorkspaceDeletionJobs,
} from "~~/lib/privacy/deletionReconciliation";
import { processSubjectRequestQueue } from "~~/lib/privacy/lifecycle";
import { purgeExpiredPrivacyOperations } from "~~/lib/privacy/privacyRetention";
import { revivePrivacyWorkerFailures } from "~~/lib/privacy/privacyWorkerFailures";
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
import { projectDirectPrivateReviewDecisionEvidence } from "~~/lib/tokenless/directPrivateReviewEvidence";
import { processDueEvidenceRetentionEnforcement } from "~~/lib/tokenless/evidenceRetentionEnforcement";
import {
  produceScheduledIntegrityEpoch,
  purgeExpiredIntegrityEpochPrivateFeatures,
} from "~~/lib/tokenless/integrityEpochProducer";
import { MaintenanceCancellationError, throwIfMaintenanceCancelled } from "~~/lib/tokenless/maintenanceCancellation";
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
import {
  processPublicQuestionMediaDeletionByAssetId,
  sweepExpiredPublicQuestionMedia,
} from "~~/lib/tokenless/publicQuestionMedia";
import { reconcilePaidRaterCommit } from "~~/lib/tokenless/raterService";
import {
  type ScheduledProcessorHealthObservation,
  persistScheduledProcessorHealth,
} from "~~/lib/tokenless/scheduledProcessorHealth";
import { type TokenlessScheduledWorkKind, tokenlessScheduledWorkItemId } from "~~/lib/tokenless/scheduledWorkItems";
import { TokenlessServiceError, sweepExpiredTokenlessQuotes } from "~~/lib/tokenless/server";
import { processSurpriseBountyPayments } from "~~/lib/tokenless/surpriseBountyService";
import { appendAndPublishSettledRound, deliverPendingWebhooks } from "~~/lib/tokenless/transparency";

type Row = Record<string, unknown>;
type WorkKind = TokenlessScheduledWorkKind;

const RUN_BUCKET_MS = 5 * 60_000;
const STALE_CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 20;
const PRIVATE_REVIEW_EVIDENCE_MAX_ATTEMPTS = 8;
const DEFAULT_WORK_LIMIT = 20;
const DEFAULT_WEBHOOK_LIMIT = 50;
const DEFAULT_NOTIFICATION_LIMIT = 20;
const EVIDENCE_PENDING_ALERT_SECONDS = 15 * 60;
// Vercel terminates the route after 60 seconds. Stop starting business work ten seconds
// earlier so health/summary persistence and any claimed-work recovery can finish cleanly.
export const SCHEDULED_MAINTENANCE_PROCESSING_BUDGET_MS = 50_000;
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
export const SCHEDULED_WORK_NONCE_INTEGRITY_CODES = new Set([
  "chain_transaction_reconciliation_required",
  "rater_signed_transaction_mismatch",
  "rater_transaction_reconciliation_required",
  "signed_transaction_mismatch",
]);
const NONCE_ALREADY_CONSUMED_CODES = new Set(["prepaid_approval_failed", "round_submission_failed"]);
export const SCHEDULED_WORK_OPERATOR_ACTION_CODES = new Set(["evm_transaction_fee_policy_exhausted"]);
export const SCHEDULED_WORK_IMMEDIATE_DEAD_LETTER_CODES = new Set(["x402_authorization_used_reconciliation_required"]);
const SCHEDULED_WORK_TERMINAL_CODES = new Set([
  ...SCHEDULED_WORK_NONCE_INTEGRITY_CODES,
  ...SCHEDULED_WORK_OPERATOR_ACTION_CODES,
  ...SCHEDULED_WORK_IMMEDIATE_DEAD_LETTER_CODES,
]);

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

// An item that exhausted MAX_ATTEMPTS gave up on an outage, not on the work itself: the seeding
// query still selects its subject, so the work is still owed. Without this it stayed dead forever,
// because nothing resets a dead row and nothing deletes one, and each dead row went on consuming a
// seeding slot until new work stopped being seeded at all.
//
// The wait keeps a genuinely unservable subject from cycling: it can retry at most once per window
// rather than continuously. A terminal reason is excluded by its structured code rather than by a
// low attempt count or a human-readable error prefix, because any terminal failure can land on the
// final attempt and would otherwise look identical to plain exhaustion. The diagnostic error is
// preserved separately so the operator signal it feeds remains useful.
const DEAD_WORK_REVIVAL_DELAY_MS = 6 * 60 * 60 * 1000;

async function insertWorkItem(kind: WorkKind, subjectKey: string, now: Date) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_scheduled_work_items
          (item_id, kind, subject_key, state, attempt_count, next_attempt_at, created_at, updated_at)
          VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
          ON CONFLICT (kind, subject_key) DO UPDATE
          SET state = 'pending', attempt_count = 0, next_attempt_at = ?,
              terminal_reason_code = NULL, dead_at = NULL, updated_at = ?
          WHERE tokenless_scheduled_work_items.state = 'dead'
            AND tokenless_scheduled_work_items.attempt_count >= ?
            AND tokenless_scheduled_work_items.dead_at <= ?
            AND tokenless_scheduled_work_items.terminal_reason_code IS NULL`,
    args: [
      tokenlessScheduledWorkItemId(kind, subjectKey),
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
    privateReviewEvidence,
  ] = await Promise.all([
    dbClient.execute({
      sql: `SELECT e.operation_key
            FROM tokenless_chain_executions e
            JOIN tokenless_agent_asks a ON a.operation_key = e.operation_key
            LEFT JOIN tokenless_result_publications p
              ON p.operation_key = e.operation_key AND p.publication_version = 1
            LEFT JOIN tokenless_ask_webhook_subscriptions s
              ON s.operation_key = e.operation_key
             AND s.event_types_json LIKE '%"result.ready"%'
            LEFT JOIN tokenless_webhook_endpoints endpoint
              ON endpoint.endpoint_id = s.endpoint_id AND endpoint.active = true
            LEFT JOIN tokenless_webhook_deliveries delivery
              ON delivery.publication_id = p.publication_id
             AND delivery.endpoint_id = s.endpoint_id
             AND delivery.event_type = 'result.ready'
            WHERE e.state = 'confirmed' AND e.round_id IS NOT NULL
              AND (
                p.publication_id IS NULL
                OR a.result_json IS NULL
                OR (endpoint.endpoint_id IS NOT NULL AND delivery.delivery_id IS NULL)
              )
            GROUP BY e.operation_key, e.updated_at
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
    // A deletion job that already tombstoned its object row no longer matches
    // `status = 'active'`, so the object table alone stops seeding it the moment the work becomes
    // resumable. The union keeps every unfinished job on the schedule until it reaches 'completed'.
    dbClient.execute({
      sql: `SELECT candidate.object_id FROM (
              SELECT object_id, created_at AS sort_at FROM tokenless_assurance_artifact_objects
              WHERE status = 'active' AND delete_after <= ?
              UNION
              SELECT object_id, created_at AS sort_at FROM tokenless_artifact_deletion_jobs
              WHERE state <> 'completed' AND next_attempt_at <= ?
            ) candidate
            GROUP BY candidate.object_id
            ORDER BY MIN(candidate.sort_at) ASC LIMIT ?`,
      args: [now, now, limit],
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
    dbClient.execute({
      sql: `SELECT d.delivery_id
            FROM tokenless_private_unpaid_review_deliveries d
            JOIN tokenless_agent_review_opportunities opportunity
              ON opportunity.workspace_id=d.workspace_id
             AND opportunity.opportunity_id=d.opportunity_id
            LEFT JOIN tokenless_assurance_evidence_packets packet ON packet.run_id=opportunity.run_id
            LEFT JOIN tokenless_scheduled_work_items work
              ON work.kind='project_private_review_evidence'
             AND work.subject_key=d.delivery_id
            WHERE d.result_envelope_json IS NOT NULL
              AND d.status IN ('completed','inconclusive')
              AND (opportunity.run_id IS NULL OR packet.packet_id IS NULL)
              AND work.item_id IS NULL
            ORDER BY d.completed_at ASC,d.delivery_id ASC LIMIT ?`,
      args: [limit],
    }),
  ]);
  for (const row of settlements.rows) {
    const operationKey = rowString(row as Row, "operation_key")!;
    await insertWorkItem("publish_finalized_round", operationKey, now);
    await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items
            SET state = 'pending', next_attempt_at = ?, completed_at = NULL, updated_at = ?
            WHERE kind = 'publish_finalized_round' AND subject_key = ? AND state = 'completed'`,
      args: [now, now, operationKey],
    });
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
  for (const row of privateReviewEvidence.rows) {
    await insertWorkItem("project_private_review_evidence", rowString(row as Row, "delivery_id")!, now);
  }
  return {
    chainRecoveries: chainRecoveries.rows.length,
    deletions: deletions.rows.length,
    publicNetworkAudiences: publicNetworkAudiences.rows.length,
    publicNetworkFoundations: publicNetworkFoundations.rows.length,
    publicMediaDeletions: publicMediaDeletions.rows.length,
    privateReviewEvidence: privateReviewEvidence.rows.length,
    raterCommitRecoveries: raterCommitRecoveries.rows.length,
    settlements: settlements.rows.length,
  };
}

type MaintenanceProcessors = {
  deleteArtifact: typeof processArtifactDeletionByObjectId;
  deletePublicMedia: typeof processPublicQuestionMediaDeletionByAssetId;
  preparePublicNetworkAudience: typeof preparePublicNetworkAudienceForBinding;
  cleanupPublicNetworkFoundation: typeof abandonStalePublicNetworkFoundation;
  publishFinalizedRound: (input: {
    operationKey: string;
    appOrigin: string;
    now: Date;
    signal?: AbortSignal;
  }) => Promise<void>;
  recoverChainExecution: (input: { operationKey: string; signal?: AbortSignal }) => Promise<{
    paymentState: string;
  } | null>;
  recoverRaterCommit: (commitId: string, signal?: AbortSignal) => Promise<{ state: string | null } | null>;
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
  revivePrivacyWorkerFailures: typeof revivePrivacyWorkerFailures;
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
  sweepExpiredPublicMedia: typeof sweepExpiredPublicQuestionMedia;
  reconcileDirectPrivateReviewDeadlines: typeof reconcileDueDirectPrivateReviewDeadlines;
  reconcilePaidAssignmentSettlements: typeof reconcilePaidAssignmentSettlements;
  reconcileNetworkAssignmentSettlements: typeof reconcileNetworkAssignmentSettlements;
  projectDirectPrivateReviewEvidence: typeof projectDirectPrivateReviewDecisionEvidence;
  expireAudienceAssignments: typeof expireAudienceAssignments;
  expirePrivateReviewReservations: typeof expirePrivateUnpaidReviewReservations;
  produceIntegrityEpoch: typeof produceScheduledIntegrityEpoch;
  purgeIntegrityPrivateFeatures: typeof purgeExpiredIntegrityEpochPrivateFeatures;
};

// The three scheduled-work stages and the evidence-pending health probe are pipeline steps rather
// than injectable processors, but an uncaught throw in any of them used to abandon every processor
// that ran after them for the whole tick. They are isolated under their own names.
type MaintenanceStage =
  | "seedScheduledWork"
  | "claimDueWork"
  | "processClaimedWork"
  | "evidencePendingHealth"
  | "invocationDeadline";

type MaintenanceProcessorFailure = {
  processor: keyof MaintenanceProcessors | MaintenanceStage;
  errorCode: string;
  errorDigest: `sha256:${string}`;
};

type MaintenanceProcessorConfiguration = Omit<ScheduledProcessorHealthObservation, "processor">;

type IsolatedMaintenanceProcessorInput<T> = {
  failures: MaintenanceProcessorFailure[];
  processor: keyof MaintenanceProcessors | MaintenanceStage;
  run: () => Promise<T>;
  fallback: T;
  configuration?: (result: T) => MaintenanceProcessorConfiguration;
  observe?: (observation: ScheduledProcessorHealthObservation) => void;
};

type MaintenanceProcessingDeadline = {
  reached: () => boolean;
  recordExhaustion: () => void;
  signal: AbortSignal;
};

function maintenanceProcessorErrorCode(error: unknown) {
  if (error instanceof TokenlessServiceError) return error.code;
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name)) {
    return error.name;
  }
  return "processor_error";
}

function maintenanceProcessorErrorEvidence(
  error: unknown,
  processor: keyof MaintenanceProcessors | MaintenanceStage,
): Omit<MaintenanceProcessorFailure, "processor"> {
  const errorCode = maintenanceProcessorErrorCode(error);
  const errorClass = error instanceof Error ? error.name : typeof error;
  const errorDetail = error instanceof Error ? error.message.slice(0, 1_000) : errorClass;
  return {
    errorCode,
    errorDigest: `sha256:${createHash("sha256")
      .update(`${processor}:${errorCode}:${errorClass}:${errorDetail}`)
      .digest("hex")}`,
  };
}

function recordMaintenanceProcessorFailure(
  error: unknown,
  processor: keyof MaintenanceProcessors | MaintenanceStage,
  failures: MaintenanceProcessorFailure[],
  observe?: (observation: ScheduledProcessorHealthObservation) => void,
) {
  const failure = {
    processor,
    ...maintenanceProcessorErrorEvidence(error, processor),
  };
  failures.push(failure);
  observe?.({ configurationState: "broken", ...failure });
  console.error(
    JSON.stringify({
      event: "tokenless_scheduled_maintenance_processor_failure",
      ...failure,
    }),
  );
}

async function runIsolatedMaintenanceProcessor<T>(input: IsolatedMaintenanceProcessorInput<T>) {
  try {
    const result = await input.run();
    input.observe?.({
      processor: input.processor,
      ...(input.configuration?.(result) ?? { configurationState: "enabled" }),
    });
    return result;
  } catch (error) {
    recordMaintenanceProcessorFailure(error, input.processor, input.failures, input.observe);
    return input.fallback;
  }
}

const defaultProcessors: MaintenanceProcessors = {
  deleteArtifact: processArtifactDeletionByObjectId,
  deletePublicMedia: processPublicQuestionMediaDeletionByAssetId,
  preparePublicNetworkAudience: preparePublicNetworkAudienceForBinding,
  cleanupPublicNetworkFoundation: abandonStalePublicNetworkFoundation,
  async publishFinalizedRound({ operationKey, appOrigin, now, signal }) {
    await appendAndPublishSettledRound({ operationKey, appOrigin, now, signal });
  },
  async recoverChainExecution({ operationKey, signal }) {
    throwIfMaintenanceCancelled(signal);
    return reconcileChainPayment(operationKey, { signal });
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
  revivePrivacyWorkerFailures,
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
  sweepExpiredPublicMedia: sweepExpiredPublicQuestionMedia,
  reconcileDirectPrivateReviewDeadlines: reconcileDueDirectPrivateReviewDeadlines,
  reconcilePaidAssignmentSettlements,
  reconcileNetworkAssignmentSettlements,
  projectDirectPrivateReviewEvidence: projectDirectPrivateReviewDecisionEvidence,
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
  await dbClient.execute({
    sql: `UPDATE tokenless_private_unpaid_review_deliveries
          SET evidence_projection_state = 'retry',
              evidence_projection_next_attempt_at = ?,
              evidence_projection_last_error = 'stale worker claim recovered',
              evidence_projection_claimed_at = NULL
          WHERE evidence_projection_state = 'processing'
            AND delivery_id IN (
              SELECT subject_key FROM tokenless_scheduled_work_items
              WHERE kind = 'project_private_review_evidence' AND state = 'retry'
            )`,
    args: [now],
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
    if (result.rows[0]) {
      const claimedRow = result.rows[0] as Row;
      claimed.push(claimedRow);
      if (rowString(claimedRow, "kind") === "project_private_review_evidence") {
        await dbClient.execute({
          sql: `UPDATE tokenless_private_unpaid_review_deliveries
                SET evidence_projection_state='processing',
                    evidence_projection_next_attempt_at=NULL,
                    evidence_projection_claimed_at=?,
                    evidence_projection_claim_generation=?,
                    evidence_projection_dead_at=NULL
                WHERE delivery_id=?`,
          args: [now, Number(claimedRow.claim_generation), rowString(claimedRow, "subject_key")],
        });
      }
    }
  }
  return claimed;
}

async function processClaimedWork(input: {
  appOrigin: string;
  deadline?: MaintenanceProcessingDeadline;
  items: Row[];
  now: Date;
  processors: MaintenanceProcessors;
}) {
  const summary = {
    completed: 0,
    dead: 0,
    deferred: 0,
    retry: 0,
    privateReviewEvidence: {
      scanned: 0,
      projected: 0,
      packetsReady: 0,
      retry: 0,
      retryDeliveryIds: [] as string[],
      dead: 0,
      deadDeliveryIds: [] as string[],
    },
  };
  for (const [index, row] of input.items.entries()) {
    if (input.deadline?.reached()) {
      input.deadline.recordExhaustion();
      await releaseClaimedWork(input.items.slice(index), input.now);
      break;
    }
    const itemId = rowString(row, "item_id")!;
    const kind = rowString(row, "kind") as WorkKind;
    const subjectKey = rowString(row, "subject_key")!;
    const attempt = Number(row.attempt_count) + 1;
    const claimGeneration = Number(row.claim_generation);
    if (kind === "project_private_review_evidence") {
      summary.privateReviewEvidence.scanned += 1;
    }
    try {
      if (kind === "publish_finalized_round") {
        await input.processors.publishFinalizedRound({
          operationKey: subjectKey,
          appOrigin: input.appOrigin,
          now: input.now,
          signal: input.deadline?.signal,
        });
      } else if (kind === "recover_chain_execution") {
        const recovered = await input.processors.recoverChainExecution({
          operationKey: subjectKey,
          signal: input.deadline?.signal,
        });
        if (recovered?.paymentState !== "confirmed") {
          throw new TokenlessServiceError(
            "Chain execution recovery is still pending.",
            409,
            "chain_recovery_pending",
            true,
          );
        }
      } else if (kind === "recover_rater_commit") {
        const recovered = await input.processors.recoverRaterCommit(subjectKey, input.deadline?.signal);
        if (!new Set(["confirmed", "failed"]).has(recovered?.state ?? "")) {
          throw new TokenlessServiceError(
            "Rater commit recovery is still pending.",
            409,
            "rater_commit_recovery_pending",
            true,
          );
        }
      } else if (kind === "delete_artifact") {
        const deleted = await input.processors.deleteArtifact(subjectKey, input.now, input.deadline?.signal);
        if (!deleted) {
          throw new TokenlessServiceError("Artifact deletion is still pending.", 409, "deletion_not_due", true);
        }
      } else if (kind === "delete_public_media") {
        const deleted = await input.processors.deletePublicMedia(subjectKey, input.now, input.deadline?.signal);
        if (!deleted) {
          throw new TokenlessServiceError("Public media deletion is still pending.", 409, "deletion_not_due", true);
        }
      } else if (kind === "prepare_public_network_audience") {
        await input.processors.preparePublicNetworkAudience(subjectKey, input.now, input.deadline?.signal);
      } else if (kind === "cleanup_public_network_foundation") {
        await input.processors.cleanupPublicNetworkFoundation(subjectKey, input.now, input.deadline?.signal);
      } else if (kind === "project_private_review_evidence") {
        const result = await input.processors.projectDirectPrivateReviewEvidence({
          deliveryId: subjectKey,
          now: input.now,
          signal: input.deadline?.signal,
        });
        if (result.packet !== "ready") throw new Error(result.error);
        if (result.projected) summary.privateReviewEvidence.projected += 1;
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
      if (completed.rows.length === 1) {
        summary.completed += 1;
        if (kind === "project_private_review_evidence") {
          await dbClient.execute({
            sql: `UPDATE tokenless_private_unpaid_review_deliveries
                  SET evidence_projection_state='completed',
                      evidence_projection_attempt_count=?,
                      evidence_projection_next_attempt_at=NULL,
                      evidence_projection_last_error=NULL,
                      evidence_projection_claimed_at=NULL,
                      evidence_projection_dead_at=NULL
                  WHERE delivery_id=?`,
            args: [attempt, subjectKey],
          });
          summary.privateReviewEvidence.packetsReady += 1;
        }
      }
    } catch (error) {
      const nonceIntegrityFailure =
        error instanceof TokenlessServiceError && SCHEDULED_WORK_NONCE_INTEGRITY_CODES.has(error.code);
      const operatorActionFailure =
        error instanceof TokenlessServiceError && SCHEDULED_WORK_OPERATOR_ACTION_CODES.has(error.code);
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
        (error instanceof TokenlessServiceError && SCHEDULED_WORK_IMMEDIATE_DEAD_LETTER_CODES.has(error.code));
      const maximumAttempts =
        kind === "project_private_review_evidence" ? PRIVATE_REVIEW_EVIDENCE_MAX_ATTEMPTS : MAX_ATTEMPTS;
      const dead = !deferred && (immediatelyDead || recordedAttempt >= maximumAttempts);
      const terminalReasonCode =
        error instanceof TokenlessServiceError && SCHEDULED_WORK_TERMINAL_CODES.has(error.code) ? error.code : null;
      const rawMessage = error instanceof Error ? error.message : "Scheduled work failed";
      const diagnosticPrefix = nonceIntegrityFailure
        ? `nonce_integrity:${error.code}: `
        : operatorActionFailure
          ? `operator_action:${error.code}: `
          : "";
      const message = `${diagnosticPrefix}${rawMessage}`.slice(0, 500);
      const failed = await dbClient.execute({
        sql: `UPDATE tokenless_scheduled_work_items
              SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?,
                  terminal_reason_code = ?, dead_at = ?, updated_at = ?
              WHERE item_id = ? AND state = 'processing' AND claim_generation = ?
              RETURNING item_id`,
        args: [
          dead ? "dead" : "retry",
          recordedAttempt,
          retryAt(input.now, deferred ? 1 : recordedAttempt),
          message,
          terminalReasonCode,
          dead ? input.now : null,
          input.now,
          itemId,
          claimGeneration,
        ],
      });
      if (failed.rows.length === 1) {
        summary[dead ? "dead" : deferred ? "deferred" : "retry"] += 1;
        if (kind === "project_private_review_evidence") {
          await dbClient.execute({
            sql: `UPDATE tokenless_private_unpaid_review_deliveries
                  SET evidence_projection_state=?,
                      evidence_projection_attempt_count=?,
                      evidence_projection_next_attempt_at=?,
                      evidence_projection_last_error=?,
                      evidence_projection_claimed_at=NULL,
                      evidence_projection_dead_at=?
                  WHERE delivery_id=?
                    AND evidence_projection_state='processing'
                    AND evidence_projection_claim_generation=?`,
            args: [
              dead ? "dead" : "retry",
              recordedAttempt,
              dead ? null : retryAt(input.now, deferred ? 1 : recordedAttempt),
              message,
              dead ? input.now : null,
              subjectKey,
              claimGeneration,
            ],
          });
          summary.privateReviewEvidence[dead ? "dead" : "retry"] += 1;
          summary.privateReviewEvidence[dead ? "deadDeliveryIds" : "retryDeliveryIds"].push(subjectKey);
        }
      }
    }
  }
  return summary;
}

async function releaseClaimedWork(items: Row[], now: Date) {
  const reason = "maintenance invocation deadline exhausted before processing";
  for (const row of items) {
    const itemId = rowString(row, "item_id")!;
    const kind = rowString(row, "kind") as WorkKind;
    const subjectKey = rowString(row, "subject_key")!;
    const claimGeneration = Number(row.claim_generation);
    const released = await dbClient.execute({
      sql: `UPDATE tokenless_scheduled_work_items
            SET state='retry',next_attempt_at=?,last_error=?,updated_at=?
            WHERE item_id=? AND state='processing' AND claim_generation=?
            RETURNING item_id`,
      args: [now, reason, now, itemId, claimGeneration],
    });
    if (released.rows.length !== 1 || kind !== "project_private_review_evidence") continue;
    await dbClient.execute({
      sql: `UPDATE tokenless_private_unpaid_review_deliveries
            SET evidence_projection_state='retry',
                evidence_projection_next_attempt_at=?,
                evidence_projection_last_error=?,
                evidence_projection_claimed_at=NULL
            WHERE delivery_id=?
              AND evidence_projection_state='processing'
              AND evidence_projection_claim_generation=?`,
      args: [now, reason, subjectKey, claimGeneration],
    });
  }
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
  runtime?: {
    monotonicNow?: () => number;
    processingBudgetMs?: number;
    scheduleDeadlineAbort?: (onDeadline: () => void, delayMs: number) => () => void;
  };
}) {
  const monotonicNow = input.runtime?.monotonicNow ?? Date.now;
  const processingStartedAt = monotonicNow();
  const processingBudgetMs = input.runtime?.processingBudgetMs ?? SCHEDULED_MAINTENANCE_PROCESSING_BUDGET_MS;
  if (
    !Number.isFinite(processingStartedAt) ||
    !Number.isSafeInteger(processingBudgetMs) ||
    processingBudgetMs < 1 ||
    processingBudgetMs > SCHEDULED_MAINTENANCE_PROCESSING_BUDGET_MS
  ) {
    throw new Error("Scheduled maintenance processing deadline is invalid.");
  }
  const processingDeadlineAt = processingStartedAt + processingBudgetMs;
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

  let cancelDeadlineAbort: () => void = () => undefined;
  try {
    const processors: MaintenanceProcessors = { ...defaultProcessors, ...input.processors };
    const processorFailures: MaintenanceProcessorFailure[] = [];
    const processorHealth = new Map<string, ScheduledProcessorHealthObservation>();
    let processingDeadlineExhausted = false;
    const deadlineController = new AbortController();
    const abortForDeadline = () => {
      if (!deadlineController.signal.aborted) {
        deadlineController.abort(new MaintenanceCancellationError());
      }
    };
    const scheduleDeadlineAbort =
      input.runtime?.scheduleDeadlineAbort ??
      ((onDeadline: () => void, delayMs: number) => {
        const timer = setTimeout(onDeadline, delayMs);
        timer.unref();
        return () => clearTimeout(timer);
      });
    cancelDeadlineAbort = scheduleDeadlineAbort(abortForDeadline, Math.max(1, processingDeadlineAt - monotonicNow()));
    const deadlineReached = () => {
      if (monotonicNow() >= processingDeadlineAt) abortForDeadline();
      return deadlineController.signal.aborted;
    };
    const recordDeadlineExhaustion = () => {
      if (processingDeadlineExhausted) return;
      processingDeadlineExhausted = true;
      recordMaintenanceProcessorFailure(
        new TokenlessServiceError(
          "Scheduled maintenance processing deadline was exhausted.",
          503,
          "maintenance_deadline_exhausted",
          true,
        ),
        "invocationDeadline",
        processorFailures,
        observation => processorHealth.set(observation.processor, observation),
      );
    };
    const processingDeadline: MaintenanceProcessingDeadline = {
      reached: deadlineReached,
      recordExhaustion: recordDeadlineExhaustion,
      signal: deadlineController.signal,
    };
    const runProcessor = <T>(
      processorInput: Omit<IsolatedMaintenanceProcessorInput<T>, "failures" | "observe"> & {
        runWhenDeadlineExhausted?: boolean;
      },
    ) => {
      if (!processorInput.runWhenDeadlineExhausted && deadlineReached()) {
        recordDeadlineExhaustion();
        return Promise.resolve(processorInput.fallback);
      }
      return runIsolatedMaintenanceProcessor({
        ...processorInput,
        failures: processorFailures,
        observe: observation => processorHealth.set(observation.processor, observation),
      });
    };
    const expiredQuotes = await runProcessor({
      processor: "sweepExpiredQuotes",
      run: () => processors.sweepExpiredQuotes({ now, limit: workLimit }),
      fallback: { deleted: 0, scanned: 0 } as Awaited<ReturnType<MaintenanceProcessors["sweepExpiredQuotes"]>>,
    });
    // Unattached public media used to be swept only by the two upload routes, so a workspace that
    // stopped uploading never expired its own media. It belongs on the schedule with its siblings.
    const expiredPublicMedia = await runProcessor({
      processor: "sweepExpiredPublicMedia",
      run: () =>
        processors.sweepExpiredPublicMedia({
          now,
          limit: workLimit,
          signal: processingDeadline.signal,
        }),
      fallback: { deleted: 0, failed: [] } as Awaited<ReturnType<MaintenanceProcessors["sweepExpiredPublicMedia"]>>,
    });
    // Runs before both privacy queues so work revived this tick is picked up immediately.
    const revivedPrivacyWork = await runProcessor({
      processor: "revivePrivacyWorkerFailures",
      run: () => processors.revivePrivacyWorkerFailures(now),
      fallback: { revived: 0 } as Awaited<ReturnType<MaintenanceProcessors["revivePrivacyWorkerFailures"]>>,
    });
    const subjectRequests = await runProcessor({
      processor: "processSubjectRequests",
      run: () => processors.processSubjectRequests(now, workLimit),
      fallback: { completed: 0, queued: 0 } as Awaited<ReturnType<MaintenanceProcessors["processSubjectRequests"]>>,
    });
    const privacyRetention = await runProcessor({
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
    const workspaceDeletionRetention = await runProcessor({
      processor: "expireWorkspaceDeletionRetention",
      run: () => processors.expireWorkspaceDeletionRetention(now, workLimit),
      fallback: { completed: 0, deferredByHold: 0, releasedHoldSchedules: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["expireWorkspaceDeletionRetention"]>
      >,
    });
    const directPrivateReviewDeadlines = await runProcessor({
      processor: "reconcileDirectPrivateReviewDeadlines",
      run: () => processors.reconcileDirectPrivateReviewDeadlines({ now, limit: workLimit }),
      fallback: { scanned: 0, finalized: 0, pending: 0, retry: 0, retryOpportunityIds: [] } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDirectPrivateReviewDeadlines"]>
      >,
    });
    const paidAssignmentSettlements = await runProcessor({
      processor: "reconcilePaidAssignmentSettlements",
      run: () =>
        processors.reconcilePaidAssignmentSettlements({
          now,
          limit: workLimit,
          signal: processingDeadline.signal,
        }),
      fallback: {
        scanned: 0,
        transitionedSeats: 0,
        terminalOperations: 0,
        retry: 0,
        retryOperationIds: [],
      } as Awaited<ReturnType<MaintenanceProcessors["reconcilePaidAssignmentSettlements"]>>,
    });
    const networkAssignmentSettlements = await runProcessor({
      processor: "reconcileNetworkAssignmentSettlements",
      run: () =>
        processors.reconcileNetworkAssignmentSettlements({
          now,
          limit: workLimit,
          signal: processingDeadline.signal,
        }),
      fallback: { scanned: 0, terminal: 0, retry: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileNetworkAssignmentSettlements"]>
      >,
    });
    const expiredAudienceAssignments = await runProcessor({
      processor: "expireAudienceAssignments",
      run: () => processors.expireAudienceAssignments(now),
      fallback: { expired: 0 } as Awaited<ReturnType<MaintenanceProcessors["expireAudienceAssignments"]>>,
    });
    const expiredPrivateReviewReservations = await runProcessor({
      processor: "expirePrivateReviewReservations",
      run: () => processors.expirePrivateReviewReservations(now),
      fallback: 0 as Awaited<ReturnType<MaintenanceProcessors["expirePrivateReviewReservations"]>>,
    });
    const integrityEpoch = await runProcessor({
      processor: "produceIntegrityEpoch",
      run: () => processors.produceIntegrityEpoch({ now }),
      configuration: result =>
        result.status === "disabled"
          ? {
              configurationState: "disabled",
              disabledReason: "TOKENLESS_INTEGRITY_EPOCH_PRODUCER_ENABLED is not true",
            }
          : { configurationState: "enabled" },
      fallback: {
        status: "failed" as const,
        epochId: `integrity:${now.toISOString().slice(0, 10)}`,
        manifestHash: null,
        observations: 0,
      },
    });
    const integrityPrivateFeatureRetention = await runProcessor({
      processor: "purgeIntegrityPrivateFeatures",
      run: () => processors.purgeIntegrityPrivateFeatures({ now, limit: workLimit * 100 }),
      fallback: { purged: 0 },
    });
    const evidenceRetention = await runProcessor({
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
    const nonceDriftSweep = await runProcessor({
      processor: "sweepNonceDrift",
      run: () => processors.sweepNonceDrift({ now, limit: workLimit, signal: processingDeadline.signal }),
      fallback: {
        checked: 0,
        pending: 0,
        reconciliationRequired: 0,
        reopened: 0,
        unavailable: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["sweepNonceDrift"]>>,
    });
    const seeded = await runProcessor({
      processor: "seedScheduledWork",
      run: () => seedTokenlessScheduledWork(now),
      fallback: {
        chainRecoveries: 0,
        deletions: 0,
        publicNetworkAudiences: 0,
        publicNetworkFoundations: 0,
        publicMediaDeletions: 0,
        privateReviewEvidence: 0,
        raterCommitRecoveries: 0,
        settlements: 0,
      } as Awaited<ReturnType<typeof seedTokenlessScheduledWork>>,
    });
    const items = await runProcessor({
      processor: "claimDueWork",
      run: () => claimDueWork(now, workLimit),
      fallback: [] as Row[],
    });
    const processedWork = await runProcessor({
      processor: "processClaimedWork",
      run: () =>
        processClaimedWork({
          appOrigin: input.appOrigin,
          deadline: processingDeadline,
          items,
          now,
          processors,
        }),
      runWhenDeadlineExhausted: true,
      fallback: {
        completed: 0,
        dead: 0,
        deferred: 0,
        retry: 0,
        privateReviewEvidence: {
          scanned: 0,
          projected: 0,
          packetsReady: 0,
          retry: 0,
          retryDeliveryIds: [],
          dead: 0,
          deadDeliveryIds: [],
        },
      },
    });
    const directPrivateReviewEvidence = processedWork.privateReviewEvidence;
    const work = {
      completed: processedWork.completed,
      dead: processedWork.dead,
      deferred: processedWork.deferred,
      retry: processedWork.retry,
    };
    const evidencePending = await runProcessor({
      processor: "evidencePendingHealth",
      run: () => evidencePendingOperationalHealth(now),
      fallback: {
        pendingCount: 0,
        oldestCreatedAt: null,
        oldestAgeSeconds: null,
        alertAfterSeconds: EVIDENCE_PENDING_ALERT_SECONDS,
        alert: false,
      } as Awaited<ReturnType<typeof evidencePendingOperationalHealth>>,
    });
    const deadWorkResult = await dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_scheduled_work_items WHERE state = 'dead'",
    });
    const deadWorkItems = Number((deadWorkResult.rows[0] as Row | undefined)?.count ?? 0);
    if (!Number.isSafeInteger(deadWorkItems) || deadWorkItems < 0) {
      throw new Error("Database returned an invalid scheduled dead-letter count.");
    }
    const nonceDriftFindings = await unresolvedManagedEvmNonceFindings();
    const deletionJobs = await runProcessor({
      processor: "reconcileDeletionJobs",
      run: () => processors.reconcileDeletionJobs(now, workLimit),
      fallback: { blocked: 0, completed: 0, pending: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDeletionJobs"]>
      >,
    });
    const deletedAccountPaidAssignmentSeats = await runProcessor({
      processor: "reconcileDeletedAccountPaidAssignmentSeats",
      run: () => processors.reconcileDeletedAccountPaidAssignmentSeats(now, workLimit),
      fallback: { accounts: 0, erasedSeats: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileDeletedAccountPaidAssignmentSeats"]>
      >,
    });
    const deletedAuthGuards = await runProcessor({
      processor: "expireDeletedAuthGuards",
      run: () => processors.expireDeletedAuthGuards(now, workLimit),
      fallback: { expired: 0 } as Awaited<ReturnType<MaintenanceProcessors["expireDeletedAuthGuards"]>>,
    });
    const surpriseBounties = await runProcessor({
      processor: "processSurpriseBounties",
      run: () => processors.processSurpriseBounties({ now, limit: workLimit, signal: processingDeadline.signal }),
      fallback: {
        paid: 0,
        pendingClaim: 0,
        retry: 0,
        reconciliationRequired: 0,
      } as Awaited<ReturnType<MaintenanceProcessors["processSurpriseBounties"]>>,
    });
    const grcReconciliations = await runProcessor({
      processor: "processGrcReconciliations",
      run: () => processors.processGrcReconciliations({ now, limit: 1, signal: processingDeadline.signal }),
      fallback: { enqueued: 0, claimed: 0, succeeded: 0, retry: 0, failed: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processGrcReconciliations"]>
      >,
    });
    const wormExports = await runProcessor({
      processor: "processWormExports",
      run: () => processors.processWormExports({ now, limit: workLimit, signal: processingDeadline.signal }),
      fallback: { due: 0, delivered: 0, retry: 0, dead: 0, skipped: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processWormExports"]>
      >,
    });
    const attestations = await runProcessor({
      processor: "processAttestations",
      run: () => processors.processAttestations({ now, limit: workLimit, signal: processingDeadline.signal }),
      configuration: result => {
        if (result.configured) return { configurationState: "enabled" };
        if (result.unavailable > 0) {
          const error = new TokenlessServiceError(
            "Due assurance attestations cannot run with the current configuration.",
            503,
            "attestation_configuration_unavailable",
          );
          return {
            configurationState: "broken",
            ...maintenanceProcessorErrorEvidence(error, "processAttestations"),
          };
        }
        return {
          configurationState: "disabled",
          disabledReason: "external attestation adapters are not fully configured",
        };
      },
      fallback: { configured: false, due: 0, completed: 0, retry: 0, dead: 0, unavailable: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["processAttestations"]>
      >,
    });
    const prepaidTopups = await runProcessor({
      processor: "reconcilePrepaidTopups",
      run: () => processors.reconcilePrepaidTopups({ now, limit: workLimit, signal: processingDeadline.signal }),
      configuration: () =>
        prepaidTopupsEnabled()
          ? { configurationState: "enabled" }
          : {
              configurationState: "disabled",
              disabledReason: "TOKENLESS_PREPAID_TOPUP_ENABLED is not true",
            },
      fallback: { attempted: 0, credited: 0, failed: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcilePrepaidTopups"]>
      >,
    });
    const prepaidTopupAudit = await runProcessor({
      processor: "drainPrepaidTopupAudit",
      run: () => processors.drainPrepaidTopupAudit({ limit: webhookLimit, signal: processingDeadline.signal }),
      fallback: { attempted: 0, delivered: 0 } as Awaited<ReturnType<MaintenanceProcessors["drainPrepaidTopupAudit"]>>,
    });
    const enterpriseIdentityAuditReservations = await runProcessor({
      processor: "reconcileEnterpriseIdentityAudit",
      run: () => processors.reconcileEnterpriseIdentityAudit(webhookLimit, processingDeadline.signal),
      fallback: { activated: 0, inspected: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["reconcileEnterpriseIdentityAudit"]>
      >,
    });
    const enterpriseIdentityAudit = await runProcessor({
      processor: "drainEnterpriseIdentityAudit",
      run: () => processors.drainEnterpriseIdentityAudit(now, webhookLimit, processingDeadline.signal),
      fallback: { delivered: 0, retry: 0 } as Awaited<
        ReturnType<MaintenanceProcessors["drainEnterpriseIdentityAudit"]>
      >,
    });
    const mechanismHealth = await runProcessor({
      processor: "refreshMechanismHealth",
      run: () => processors.refreshMechanismHealth({ now, limit: workLimit }),
      fallback: { refreshed: 0 } as Awaited<ReturnType<MaintenanceProcessors["refreshMechanismHealth"]>>,
    });
    const assuranceEventProjection = await runProcessor({
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
    const assuranceEventOutcomes = await runProcessor({
      processor: "deliverAssuranceEvents",
      run: () =>
        processors.deliverAssuranceEvents({
          now,
          limit: webhookLimit,
          signal: processingDeadline.signal,
        }),
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
    const webhookOutcomes = await runProcessor({
      processor: "deliverWebhooks",
      run: () => processors.deliverWebhooks({ now, limit: webhookLimit, signal: processingDeadline.signal }),
      fallback: [] as Awaited<ReturnType<MaintenanceProcessors["deliverWebhooks"]>>,
    });
    const webhooks = {
      dead: webhookOutcomes.filter(value => value.state === "dead").length,
      delivered: webhookOutcomes.filter(value => value.state === "delivered").length,
      retry: webhookOutcomes.filter(value => value.state === "retry").length,
    };
    const notifications = await runProcessor({
      processor: "processNotifications",
      run: () =>
        processors.processNotifications({
          appOrigin: input.appOrigin,
          now,
          limit: notificationLimit,
          signal: processingDeadline.signal,
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
    if (deadlineReached()) recordDeadlineExhaustion();
    await persistScheduledProcessorHealth(processorHealth.values(), now);
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
      directPrivateReviewEvidence.retry > 0 ||
      expiredPublicMedia.failed.length > 0
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
      expiredPublicMedia,
      processorFailures,
      processingDeadline: {
        budgetMs: processingBudgetMs,
        exhausted: processingDeadlineExhausted,
      },
      directPrivateReviewDeadlines,
      paidAssignmentSettlements,
      networkAssignmentSettlements,
      directPrivateReviewEvidence,
      expiredAudienceAssignments,
      expiredPrivateReviewReservations,
      integrityEpoch,
      integrityPrivateFeatureRetention,
      revivedPrivacyWork,
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
    cancelDeadlineAbort();
    return { runId, status, summary };
  } catch (error) {
    cancelDeadlineAbort();
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
  workItemId: tokenlessScheduledWorkItemId,
};
