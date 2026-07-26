import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const DELETION_DUE_MS = 30 * 24 * 60 * 60_000;
const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60_000;
const BILLING_RETENTION_MS = 3_650 * 24 * 60 * 60_000;
const TOMBSTONED_WORKSPACE_NAME = "Deleted workspace";
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["free", "canceled", "incomplete_expired"]);

type Row = Record<string, unknown>;

type PrivateQuoteErasureEvidence = {
  deletedUnreferenced: number;
  erasedReferencedContent: number;
  ownerTombstone: string;
  remainingWorkspaceOwnerLinks: number;
  retainedReferencedCommitmentOnly: number;
};

export type WorkspaceDeletionBlocker = { code: string; message: string };

export type WorkspaceDeletionPreview = {
  workspace: { workspaceId: string; name: string };
  immediate: boolean;
  blockers: WorkspaceDeletionBlocker[];
  impact: {
    otherMembers: number;
    agents: number;
    activeWork: number;
    privateObjects: number;
    retainedPrivateQuotes: number;
    publicRecords: number;
    legalHolds: number;
    settledAtomic: string;
    reservedAtomic: string;
    availableAtomic: string;
  };
  warnings: string[];
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: Row | undefined, key: string) {
  const value = Number(row?.[key] ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function accountReference(value: string) {
  try {
    return normalizeAccountSubject(value);
  } catch {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

function evidenceDigest(jobId: string, category: string, outcome: string) {
  return createHash("sha256").update(`rateloop-workspace-deletion-v1:${jobId}:${category}:${outcome}`).digest("hex");
}

async function loadPreviewRow(
  client: PoolClient,
  input: { accountAddress: string; workspaceId: string; lock?: boolean },
) {
  const accountAddress = accountReference(input.accountAddress);
  const workspace = await client.query(
    `SELECT workspace_id, name, status FROM tokenless_workspaces
     WHERE workspace_id = $1 AND status = 'active'
     LIMIT 1${input.lock ? " FOR UPDATE" : ""}`,
    [input.workspaceId],
  );
  const workspaceRow = workspace.rows[0] as Row | undefined;
  if (!workspaceRow) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  const membership = await client.query(
    `SELECT role FROM tokenless_workspace_members
     WHERE workspace_id = $1 AND account_address = $2 AND role = 'owner'
     LIMIT 1${input.lock ? " FOR UPDATE" : ""}`,
    [input.workspaceId, accountAddress],
  );
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  const subscription = await client.query(
    `SELECT provider_status, provider_subscription_id FROM tokenless_workspace_subscriptions
     WHERE workspace_id = $1 LIMIT 1${input.lock ? " FOR UPDATE" : ""}`,
    [input.workspaceId],
  );

  const aggregates = await client.query(
    `SELECT
       (SELECT COUNT(*)::integer - 1 FROM tokenless_workspace_members WHERE workspace_id = $1) AS other_members,
       (SELECT COUNT(*)::integer FROM tokenless_agents
        WHERE workspace_id = $1 AND status = 'active') AS active_agents,
       (SELECT COUNT(*)::integer FROM tokenless_assurance_assignments
        WHERE workspace_id = $1 AND status IN ('reserved','accepted')) AS active_assignments,
       (SELECT COUNT(*)::integer FROM tokenless_ask_ownership ownership
        JOIN tokenless_agent_asks asks ON asks.operation_key = ownership.operation_key
        WHERE ownership.workspace_id = $1
          AND (asks.status IN ('open','pending') OR asks.verdict_status = 'pending')) AS open_asks,
       (SELECT COUNT(*)::integer FROM tokenless_payment_intents
        WHERE workspace_id = $1 AND state NOT IN ('failed','confirmed')) AS active_payment_intents,
       (SELECT COUNT(*)::integer FROM tokenless_prepaid_reservations
        WHERE workspace_id = $1 AND status = 'reserved') AS active_prepaid_reservations,
       (SELECT COUNT(*)::integer FROM tokenless_agent_policy_budget_reservations
        WHERE workspace_id = $1 AND status = 'reserved') AS active_policy_reservations,
       (SELECT COUNT(*)::integer FROM tokenless_workspace_usage_allocations
        WHERE workspace_id = $1 AND state = 'reserved') AS active_usage_reservations,
       (SELECT COUNT(*)::integer FROM tokenless_prepaid_ledger_entries
        WHERE workspace_id = $1 AND settlement_status <> 'settled') AS unsettled_ledger_entries,
       (SELECT COUNT(*)::integer FROM tokenless_assurance_artifact_objects
        WHERE workspace_id = $1 AND status = 'active') AS active_artifacts,
       (SELECT COUNT(*)::integer FROM tokenless_public_question_media
        WHERE workspace_id = $1 AND technical_status = 'ready') AS active_media,
       (SELECT COUNT(*)::integer FROM tokenless_agent_quotes quote
        WHERE quote.owner_workspace_id = $1
          AND quote.quote_id NOT IN (
            SELECT quote_id FROM tokenless_agent_asks
            UNION
            SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
          )) AS unreferenced_private_quotes,
       (SELECT COUNT(*)::integer FROM tokenless_agent_quotes quote
        WHERE quote.owner_workspace_id = $1
          AND quote.quote_id IN (
            SELECT quote_id FROM tokenless_agent_asks
            UNION
            SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
          )) AS retained_private_quotes,
       (SELECT COUNT(*)::integer FROM tokenless_chain_executions executions
        JOIN tokenless_ask_ownership ownership ON ownership.operation_key = executions.operation_key
        WHERE ownership.workspace_id = $1
          AND (executions.round_id IS NOT NULL OR executions.submission_transaction_hash IS NOT NULL)) AS public_records,
       (SELECT COUNT(*)::integer FROM tokenless_legal_holds
        WHERE workspace_id = $1 AND status = 'active') AS active_legal_holds,
       (SELECT COALESCE(SUM(delta_atomic), 0)::text FROM tokenless_prepaid_ledger_entries
        WHERE workspace_id = $1 AND settlement_status = 'settled') AS settled_atomic,
       (SELECT COALESCE(SUM(amount_atomic), 0)::text FROM tokenless_prepaid_reservations
        WHERE workspace_id = $1 AND status = 'reserved') AS reserved_atomic,
       (SELECT status FROM tokenless_workspace_fund_resolution_requests
        WHERE workspace_id=$1 ORDER BY requested_at DESC,resolution_id DESC LIMIT 1)
        AS fund_resolution_status`,
    [input.workspaceId],
  );
  return {
    ...workspaceRow,
    ...((membership.rows[0] as Row | undefined) ?? {}),
    ...((subscription.rows[0] as Row | undefined) ?? {}),
    ...((aggregates.rows[0] as Row | undefined) ?? {}),
  };
}

function previewFromRow(row: Row): WorkspaceDeletionPreview {
  const workspaceId = text(row, "workspace_id");
  const name = text(row, "name");
  if (!workspaceId || !name) throw new Error("Database returned an invalid workspace deletion preview.");

  const settledAtomic = text(row, "settled_atomic") ?? "0";
  const reservedAtomic = text(row, "reserved_atomic") ?? "0";
  const settled = BigInt(settledAtomic);
  const reserved = BigInt(reservedAtomic);
  const availableAtomic = (settled - reserved).toString();
  const otherMembers = integer(row, "other_members");
  const agents = integer(row, "active_agents");
  const activeAssignments = integer(row, "active_assignments");
  const openAsks = integer(row, "open_asks");
  const activePaymentReservations =
    integer(row, "active_payment_intents") +
    integer(row, "active_prepaid_reservations") +
    integer(row, "active_policy_reservations") +
    integer(row, "active_usage_reservations") +
    integer(row, "unsettled_ledger_entries");
  const pendingPrivateObjects = integer(row, "active_artifacts") + integer(row, "active_media");
  const unreferencedPrivateQuotes = integer(row, "unreferenced_private_quotes");
  const retainedPrivateQuotes = integer(row, "retained_private_quotes");
  const privateObjects = pendingPrivateObjects + unreferencedPrivateQuotes;
  const publicRecords = integer(row, "public_records");
  const legalHolds = integer(row, "active_legal_holds");
  const blockers: WorkspaceDeletionBlocker[] = [];
  const subscriptionStatus = text(row, "provider_status") ?? "free";
  const subscriptionId = text(row, "provider_subscription_id");

  const fundResolutionStatus = text(row, "fund_resolution_status");
  if ((settled !== 0n || reserved !== 0n || settled - reserved !== 0n) && fundResolutionStatus !== "refunded") {
    blockers.push({
      code: "workspace_funds_active",
      message:
        "Workspace funds require a verified refund before deletion. Confirming deletion queues a manual fund-resolution request without forfeiting the balance.",
    });
  }
  if (!TERMINAL_SUBSCRIPTION_STATUSES.has(subscriptionStatus) || (subscriptionStatus === "free" && subscriptionId)) {
    blockers.push({
      code: "workspace_subscription_active",
      message: "Cancel the workspace subscription and wait for cancellation to complete before deletion.",
    });
  }
  if (activeAssignments > 0) {
    blockers.push({
      code: "workspace_assignments_active",
      message: "Active reviewer assignments must finish or expire before deletion.",
    });
  }
  if (openAsks > 0) {
    blockers.push({
      code: "workspace_asks_active",
      message: "Active review requests must reach a terminal result before deletion.",
    });
  }
  if (activePaymentReservations > 0) {
    blockers.push({
      code: "workspace_payment_reservations_active",
      message: "Pending payment and usage reservations must settle before deletion.",
    });
  }

  const warnings: string[] = [];
  if (otherMembers > 0)
    warnings.push(`${otherMembers} other workspace member${otherMembers === 1 ? "" : "s"} will lose access.`);
  if (agents > 0) warnings.push(`${agents} connected agent${agents === 1 ? "" : "s"} will be disconnected.`);
  if (pendingPrivateObjects > 0) warnings.push("Private stored files will be deleted asynchronously.");
  if (unreferencedPrivateQuotes > 0) warnings.push("Unreferenced private quote records will be deleted.");
  if (retainedPrivateQuotes > 0)
    warnings.push("Referenced private quotes will be anonymized and retained as restricted settlement evidence.");
  if (publicRecords > 0) warnings.push("Public-chain settlement records cannot be erased by RateLoop.");
  if (legalHolds > 0) warnings.push("Records covered by an active legal hold remain restricted until the hold ends.");
  if (fundResolutionStatus === "refunded")
    warnings.push("A compliance operator recorded the external workspace refund; billing evidence remains retained.");

  return {
    workspace: { workspaceId, name },
    immediate: blockers.length === 0 && pendingPrivateObjects === 0,
    blockers,
    impact: {
      otherMembers,
      agents,
      activeWork: activeAssignments + openAsks,
      privateObjects,
      retainedPrivateQuotes,
      publicRecords,
      legalHolds,
      settledAtomic,
      reservedAtomic,
      availableAtomic,
    },
    warnings,
  };
}

export async function getWorkspaceDeletionPreview(input: { accountAddress: string; workspaceId: string }) {
  const client = await dbPool.connect();
  try {
    return previewFromRow(await loadPreviewRow(client, input));
  } finally {
    client.release();
  }
}

export async function listWorkspaceFundResolutionRequests(input: { limit?: number } = {}) {
  const limit = input.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TokenlessServiceError("Fund-resolution limit is invalid.", 400, "invalid_fund_resolution");
  }
  const result = await dbPool.query(
    `SELECT resolution_id,request_id,workspace_id,settled_atomic_snapshot,
            reserved_atomic_snapshot,available_atomic_snapshot,status,requested_at,updated_at
     FROM tokenless_workspace_fund_resolution_requests
     WHERE status IN ('pending','manual_review')
     ORDER BY requested_at ASC,resolution_id ASC LIMIT $1`,
    [limit],
  );
  return result.rows.map(value => {
    const row = value as Row;
    return {
      resolutionId: text(row, "resolution_id"),
      requestId: text(row, "request_id"),
      workspaceId: text(row, "workspace_id"),
      settledAtomic: text(row, "settled_atomic_snapshot"),
      reservedAtomic: text(row, "reserved_atomic_snapshot"),
      availableAtomic: text(row, "available_atomic_snapshot"),
      status: text(row, "status"),
      requestedAt: new Date(String(row.requested_at)).toISOString(),
    };
  });
}

export async function recordWorkspaceFundResolution(input: {
  resolutionId: string;
  status: "refunded" | "manual_review";
  resolutionReference: string;
  resolvedBy: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const reference = input.resolutionReference.trim();
  const resolvedBy = input.resolvedBy.trim();
  if (
    !/^wfr_[0-9a-f]{32}$/u.test(input.resolutionId) ||
    !reference ||
    reference.length > 500 ||
    !resolvedBy ||
    resolvedBy.length > 160
  ) {
    throw new TokenlessServiceError("Fund-resolution decision is invalid.", 400, "invalid_fund_resolution");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT request_id,status,resolution_reference,resolved_by,resolved_at
       FROM tokenless_workspace_fund_resolution_requests
       WHERE resolution_id=$1 LIMIT 1 FOR UPDATE`,
      [input.resolutionId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row)
      throw new TokenlessServiceError("Fund-resolution request was not found.", 404, "fund_resolution_not_found");
    const currentStatus = text(row, "status");
    if (currentStatus !== "pending" && currentStatus !== "manual_review") {
      if (
        currentStatus !== input.status ||
        text(row, "resolution_reference") !== reference ||
        text(row, "resolved_by") !== resolvedBy
      ) {
        throw new TokenlessServiceError(
          "Fund-resolution decision is already recorded.",
          409,
          "fund_resolution_conflict",
        );
      }
      await client.query("COMMIT");
      return { resolutionId: input.resolutionId, status: input.status, replay: true as const };
    }
    await client.query(
      `UPDATE tokenless_workspace_fund_resolution_requests
       SET status=$1,resolution_reference=$2,resolved_by=$3,resolved_at=$4,updated_at=$4
       WHERE resolution_id=$5`,
      [input.status, reference, resolvedBy, now, input.resolutionId],
    );
    const requestId = text(row, "request_id")!;
    if (input.status === "refunded") {
      await client.query(
        `UPDATE tokenless_subject_requests SET status='in_progress'
         WHERE request_id=$1 AND status='blocked_by_funds'`,
        [requestId],
      );
      await client.query(
        `INSERT INTO tokenless_subject_request_events
         (event_id,request_id,from_status,to_status,actor_reference,reason,created_at)
         VALUES ($1,$2,'blocked_by_funds','in_progress',$3,'external_refund_verified',$4)`,
        [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, `compliance:${resolvedBy}`, now],
      );
    }
    await client.query("COMMIT");
    return { resolutionId: input.resolutionId, status: input.status, replay: false as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function insertCategory(
  client: PoolClient,
  input: {
    basisCode?: string | null;
    category: string;
    disposition: "erase" | "anonymize" | "retain" | "public_chain";
    jobId: string;
    outcome: string;
    pending?: boolean;
    retentionDeadline?: Date | null;
    now: Date;
  },
) {
  const status = input.pending
    ? "in_progress"
    : input.disposition === "retain" || input.disposition === "public_chain"
      ? "retained"
      : "completed";
  await client.query(
    `INSERT INTO tokenless_deletion_job_categories
       (job_id, category, disposition, status, basis_code, retention_deadline, evidence_digest,
        created_at, started_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9)`,
    [
      input.jobId,
      input.category,
      input.disposition,
      status,
      input.basisCode ?? null,
      input.retentionDeadline ?? null,
      input.pending ? null : evidenceDigest(input.jobId, input.category, input.outcome),
      input.now,
      input.pending ? null : input.now,
    ],
  );
}

async function eraseWorkspacePrivateQuoteOwnership(
  client: PoolClient,
  workspaceId: string,
  jobId: string,
): Promise<PrivateQuoteErasureEvidence> {
  const ownerTombstone = `deleted-workspace-quote:${evidenceDigest(jobId, "quote_owner", "anonymized")}`;
  const deleted = await client.query(
    `DELETE FROM tokenless_agent_quotes
     WHERE owner_workspace_id = $1
       AND quote_id NOT IN (
         SELECT quote_id FROM tokenless_agent_asks
         UNION
         SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
       )`,
    [workspaceId],
  );
  const erasedReferencedContent = await client.query(
    `UPDATE tokenless_content_records
     SET content_json=jsonb_build_object(
           'schemaVersion','rateloop.erased-private-content.v1',
           'contentCommitment',content_hash
         )::text,
         updated_at=CURRENT_TIMESTAMP
     WHERE content_id IN (
       SELECT qr.content_id
       FROM tokenless_agent_quotes q
       JOIN tokenless_agent_asks a ON a.quote_id=q.quote_id
       JOIN tokenless_ask_ownership ao ON ao.operation_key=a.operation_key
       JOIN tokenless_question_records qr ON qr.question_id=ao.question_id
       WHERE q.owner_workspace_id=$1
     )`,
    [workspaceId],
  );
  const retained = await client.query(
    `UPDATE tokenless_agent_quotes
     SET owner_principal_id = $2, owner_workspace_id = NULL, owner_api_key_id = NULL,
         request_json=jsonb_build_object(
           'schemaVersion','rateloop.erased-private-quote.v1',
           'visibility','private',
           'requestCommitment',request_hash
         )::text
     WHERE owner_workspace_id = $1
       AND quote_id IN (
         SELECT quote_id FROM tokenless_agent_asks
         UNION
         SELECT quote_id FROM tokenless_paid_assignment_operations WHERE quote_id IS NOT NULL
       )`,
    [workspaceId, ownerTombstone],
  );
  const remaining = await client.query(
    `SELECT COUNT(*) AS count FROM tokenless_agent_quotes WHERE owner_workspace_id = $1`,
    [workspaceId],
  );
  return {
    deletedUnreferenced: deleted.rowCount ?? 0,
    erasedReferencedContent: erasedReferencedContent.rowCount ?? 0,
    ownerTombstone,
    remainingWorkspaceOwnerLinks: integer(remaining.rows[0] as Row | undefined, "count"),
    retainedReferencedCommitmentOnly: retained.rowCount ?? 0,
  };
}

export async function requestWorkspaceDeletion(input: {
  accountAddress: string;
  confirmationName: string;
  identityAssurance: string;
  now?: Date;
  workspaceId: string;
}) {
  if (typeof input.confirmationName !== "string") {
    throw new TokenlessServiceError(
      "Workspace name confirmation is required.",
      400,
      "workspace_confirmation_required",
      false,
      "confirmationName",
    );
  }
  const requester = accountReference(input.accountAddress);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const previewRow = await loadPreviewRow(client, {
      accountAddress: requester,
      workspaceId: input.workspaceId,
      lock: true,
    });
    const preview = previewFromRow(previewRow);
    if (input.confirmationName !== preview.workspace.name) {
      throw new TokenlessServiceError(
        "Workspace name confirmation does not match.",
        400,
        "workspace_confirmation_mismatch",
        false,
        "confirmationName",
      );
    }
    if (preview.blockers.length > 0) {
      if (preview.blockers.length === 1 && preview.blockers[0]?.code === "workspace_funds_active") {
        const existing = await client.query(
          `SELECT resolution.resolution_id,requests.request_id,requests.due_at
           FROM tokenless_workspace_fund_resolution_requests resolution
           JOIN tokenless_subject_requests requests ON requests.request_id=resolution.request_id
           WHERE resolution.workspace_id=$1 AND resolution.status IN ('pending','manual_review')
             AND requests.status='blocked_by_funds'
           ORDER BY resolution.requested_at DESC LIMIT 1 FOR UPDATE`,
          [input.workspaceId],
        );
        const existingRow = existing.rows[0] as Row | undefined;
        if (existingRow) {
          await client.query("COMMIT");
          return {
            deleted: false as const,
            immediate: false,
            requestId: text(existingRow, "request_id")!,
            resolutionId: text(existingRow, "resolution_id")!,
            status: "blocked_by_funds" as const,
          };
        }
        const requestId = `dsr_${randomUUID().replaceAll("-", "")}`;
        const resolutionId = `wfr_${randomUUID().replaceAll("-", "")}`;
        const dueAt = new Date(now.getTime() + DELETION_DUE_MS);
        await client.query(
          `INSERT INTO tokenless_subject_requests
           (request_id,principal_id,workspace_id,request_type,status,scope_json,
            identity_assurance,received_at,due_at,completed_at)
           VALUES ($1,$2,$3,'deletion','blocked_by_funds',$4,$5,$6,$7,NULL)`,
          [
            requestId,
            requester,
            input.workspaceId,
            JSON.stringify({ workspaceDeletion: true, workspaceId: input.workspaceId, fundResolutionRequired: true }),
            input.identityAssurance,
            now,
            dueAt,
          ],
        );
        for (const [fromStatus, toStatus, reason] of [
          [null, "received", "authenticated_workspace_deletion_request"],
          ["received", "identity_verified", "active_browser_session"],
          ["identity_verified", "in_progress", "workspace_deletion_started"],
          ["in_progress", "blocked_by_funds", "verified_refund_required"],
        ] as const) {
          await client.query(
            `INSERT INTO tokenless_subject_request_events
             (event_id,request_id,from_status,to_status,actor_reference,reason,created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, fromStatus, toStatus, requester, reason, now],
          );
        }
        await client.query(
          `INSERT INTO tokenless_workspace_fund_resolution_requests
           (resolution_id,request_id,workspace_id,requested_by,settled_atomic_snapshot,
            reserved_atomic_snapshot,available_atomic_snapshot,status,requested_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)`,
          [
            resolutionId,
            requestId,
            input.workspaceId,
            requester,
            preview.impact.settledAtomic,
            preview.impact.reservedAtomic,
            preview.impact.availableAtomic,
            now,
          ],
        );
        await client.query("COMMIT");
        return {
          deleted: false as const,
          immediate: false,
          requestId,
          resolutionId,
          status: "blocked_by_funds" as const,
        };
      }
      const blocker = preview.blockers[0];
      throw new TokenlessServiceError(blocker.message, 409, blocker.code);
    }

    const resumable = await client.query(
      `SELECT requests.request_id,requests.due_at
       FROM tokenless_subject_requests requests
       JOIN tokenless_workspace_fund_resolution_requests resolution
         ON resolution.request_id=requests.request_id
       WHERE requests.workspace_id=$1 AND requests.request_type='deletion'
         AND requests.status='in_progress' AND resolution.status='refunded'
       ORDER BY requests.received_at DESC LIMIT 1 FOR UPDATE`,
      [input.workspaceId],
    );
    const resumableRow = resumable.rows[0] as Row | undefined;
    const requestId = text(resumableRow, "request_id") ?? `dsr_${randomUUID().replaceAll("-", "")}`;
    const dueAt = resumableRow ? new Date(String(resumableRow.due_at)) : new Date(now.getTime() + DELETION_DUE_MS);
    const jobId = `del_${randomUUID().replaceAll("-", "")}`;
    const hasPendingObjects = integer(previewRow, "active_artifacts") + integer(previewRow, "active_media") > 0;
    const receiptDigest = hasPendingObjects ? null : evidenceDigest(jobId, "receipt", "completed");
    const privateQuoteErasure = await eraseWorkspacePrivateQuoteOwnership(client, input.workspaceId, jobId);
    if (privateQuoteErasure.remainingWorkspaceOwnerLinks !== 0) {
      throw new Error("Workspace deletion postcondition failed: privateQuoteOwnerLinks.");
    }

    if (!resumableRow) {
      await client.query(
        `INSERT INTO tokenless_subject_requests
       (request_id, principal_id, workspace_id, request_type, status, scope_json,
        identity_assurance, received_at, due_at, completed_at)
       VALUES ($1, $2, $3, 'deletion', $4, $5, $6, $7, $8, $9)`,
        [
          requestId,
          requester,
          input.workspaceId,
          hasPendingObjects ? "in_progress" : "completed",
          JSON.stringify({
            privateQuotes: {
              deletedUnreferenced: privateQuoteErasure.deletedUnreferenced,
              erasedReferencedContent: privateQuoteErasure.erasedReferencedContent,
              ownerTombstone:
                privateQuoteErasure.retainedReferencedCommitmentOnly > 0 ? privateQuoteErasure.ownerTombstone : null,
              retainedReferencedCommitmentOnly: privateQuoteErasure.retainedReferencedCommitmentOnly,
            },
            workspaceDeletion: true,
            workspaceId: input.workspaceId,
          }),
          input.identityAssurance,
          now,
          dueAt,
          hasPendingObjects ? null : now,
        ],
      );
      for (const [fromStatus, toStatus, reason] of [
        [null, "received", "authenticated_workspace_deletion_request"],
        ["received", "identity_verified", "active_browser_session"],
        ["identity_verified", "in_progress", "workspace_deletion_started"],
      ] as const) {
        await client.query(
          `INSERT INTO tokenless_subject_request_events
         (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, fromStatus, toStatus, requester, reason, now],
        );
      }
    } else {
      await client.query(
        `UPDATE tokenless_subject_requests
         SET status=$1,scope_json=$2,completed_at=$3 WHERE request_id=$4`,
        [
          hasPendingObjects ? "in_progress" : "completed",
          JSON.stringify({
            fundResolutionCompleted: true,
            privateQuotes: {
              deletedUnreferenced: privateQuoteErasure.deletedUnreferenced,
              erasedReferencedContent: privateQuoteErasure.erasedReferencedContent,
              ownerTombstone:
                privateQuoteErasure.retainedReferencedCommitmentOnly > 0 ? privateQuoteErasure.ownerTombstone : null,
              retainedReferencedCommitmentOnly: privateQuoteErasure.retainedReferencedCommitmentOnly,
            },
            workspaceDeletion: true,
            workspaceId: input.workspaceId,
          }),
          hasPendingObjects ? null : now,
          requestId,
        ],
      );
    }

    await client.query(
      `INSERT INTO tokenless_deletion_jobs
       (job_id, scope_kind, scope_id, subject_request_id, requested_by, status, due_at,
        requested_at, started_at, completed_at, receipt_digest)
       VALUES ($1, 'workspace', $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
      [
        jobId,
        input.workspaceId,
        requestId,
        requester,
        hasPendingObjects ? "running" : "completed",
        dueAt,
        now,
        hasPendingObjects ? null : now,
        receiptDigest,
      ],
    );

    await client.query(
      `UPDATE tokenless_agent_oauth_authorization_codes SET revoked_at = COALESCE(revoked_at, $1)
       WHERE token_family_id IN (
         SELECT token_family_id FROM tokenless_agent_integrations
         WHERE workspace_id = $2 AND token_family_id IS NOT NULL
       )`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_refresh_tokens
       SET revoked_at = COALESCE(revoked_at, $1), revocation_reason = COALESCE(revocation_reason, 'workspace_deleted')
       WHERE token_family_id IN (
         SELECT token_family_id FROM tokenless_agent_integrations
         WHERE workspace_id = $2 AND token_family_id IS NOT NULL
       )`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_access_tokens
       SET revoked_at = COALESCE(revoked_at, $1), revocation_reason = COALESCE(revocation_reason, 'workspace_deleted')
       WHERE token_family_id IN (
         SELECT token_family_id FROM tokenless_agent_integrations
         WHERE workspace_id = $2 AND token_family_id IS NOT NULL
       )`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_oauth_token_families
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, $1), revoked_by = COALESCE(revoked_by, $2),
           revocation_reason = COALESCE(revocation_reason, 'workspace_deleted')
       WHERE token_family_id IN (
         SELECT token_family_id FROM tokenless_agent_integrations
         WHERE workspace_id = $3 AND token_family_id IS NOT NULL
       ) AND status = 'active'`,
      [now, requester, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_workspace_api_keys SET revoked_at = COALESCE(revoked_at, $1) WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_integrations
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, $1), updated_at = $1
       WHERE workspace_id = $2 AND status = 'active'`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_pairing_sessions
       SET status = 'revoked', revoked_at = COALESCE(revoked_at, $1)
       WHERE workspace_id = $2 AND status IN ('open','claimed','approved')`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_connection_intents
       SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, $1), last_transition_at = $1,
           last_transition_reason = 'workspace_deleted'
       WHERE workspace_id = $2
         AND status IN ('issued','install_required','authorizing','approval_required','testing','connected','action_required')`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agent_publishing_policies
       SET enabled = false, revoked_at = COALESCE(revoked_at, $1), updated_at = $1
       WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_agents
       SET status = 'inactive', deactivated_at = COALESCE(deactivated_at, $1), updated_at = $1
       WHERE workspace_id = $2 AND status = 'active'`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_webhook_endpoints
       SET active = false, url = 'deleted://' || endpoint_id, event_types_json = '[]',
           secret_ciphertext = 'deleted', secret_key_version = 'deleted', updated_at = $1
       WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_workspace_member_invites SET revoked_at = COALESCE(revoked_at, $1)
       WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    const workspaceScreenings = await client.query(
      `SELECT sanctions_screening_id FROM tokenless_paid_eligibility_scopes WHERE workspace_id=$1`,
      [input.workspaceId],
    );
    await client.query(`DELETE FROM tokenless_paid_eligibility_scopes WHERE workspace_id=$1`, [input.workspaceId]);
    const workspaceScreeningIds = workspaceScreenings.rows
      .map(value => text(value as Row, "sanctions_screening_id"))
      .filter((value): value is string => value !== null);
    if (workspaceScreeningIds.length) {
      await client.query(`DELETE FROM tokenless_sanctions_screenings WHERE screening_id=ANY($1::text[])`, [
        workspaceScreeningIds,
      ]);
    }
    await client.query(
      `DELETE FROM tokenless_private_group_invitation_expertise_attestations
       WHERE materialized_qualification_id IN (
         SELECT qualification_id FROM tokenless_reviewer_qualifications
         WHERE workspace_id=$1 AND reviewer_source='customer_invited'
       )`,
      [input.workspaceId],
    );
    await client.query(
      `DELETE FROM tokenless_reviewer_qualifications
       WHERE workspace_id=$1 AND reviewer_source='customer_invited'`,
      [input.workspaceId],
    );
    const reviewerTombstone = `rlp_erased_ws_${evidenceDigest(jobId, "reviewer_roster", "anonymized").slice(0, 24)}`;
    await client.query(
      `INSERT INTO tokenless_principals (principal_id,status,created_at,updated_at,disabled_at)
       VALUES ($1,'deleted',$2,$2,$2) ON CONFLICT (principal_id) DO NOTHING`,
      [reviewerTombstone, now],
    );
    await client.query(
      `INSERT INTO tokenless_workspace_reviewers
       (workspace_id,principal_address,status,activated_at,ended_at,end_reason,created_by,updated_at)
       SELECT workspace_id,$1,'removed',MIN(activated_at),$2::timestamptz,
              'workspace_deleted','system:workspace_deletion',$2::timestamptz
       FROM tokenless_workspace_reviewers WHERE workspace_id=$3 GROUP BY workspace_id
       ON CONFLICT (workspace_id,principal_address) DO NOTHING`,
      [reviewerTombstone, now, input.workspaceId],
    );
    const assuranceAssignmentSubjects = await client.query(
      `SELECT assignment_id,project_id,cohort_id,source,paid_assignment,
              assurance_snapshot_hash,integrity_provenance_hash
       FROM tokenless_assurance_assignments
       WHERE workspace_id=$1 ORDER BY assignment_id FOR UPDATE`,
      [input.workspaceId],
    );
    let networkAssignmentsAnonymized = 0;
    let networkAssignmentHistoryAnonymized = 0;
    let networkVoucherSnapshotsAnonymized = 0;
    for (const value of assuranceAssignmentSubjects.rows) {
      const row = value as Row;
      const assignmentId = text(row, "assignment_id")!;
      const networkManaged = text(row, "source") === "rateloop_network";
      const assignmentTombstone = `rlp_erased_assignment_${evidenceDigest(
        jobId,
        "assurance_assignment",
        assignmentId,
      ).slice(0, 24)}`;
      const assignmentTombstoneDigest = evidenceDigest(jobId, "network_assignment_subject", assignmentId);
      const assignmentTombstonePayout = `0x${assignmentTombstoneDigest.slice(0, 40)}`;
      const assignmentTombstoneRater = `rater_erased_ws_${assignmentTombstoneDigest.slice(0, 32)}`;
      if (networkManaged) {
        await client.query(
          `INSERT INTO tokenless_rater_profiles
           (rater_id,principal_id,account_address,nullifier_seed_ciphertext,
            nullifier_key_version,nullifier_key_domain,deletion_receipt_hash,deleted_at,
            created_at,updated_at)
           VALUES ($1,NULL,$2,$3,'deleted-receipt-v1','vote_mapping',$4,$5,$5,$5)
           ON CONFLICT (rater_id) DO NOTHING`,
          [
            assignmentTombstoneRater,
            assignmentTombstonePayout,
            `deleted:${assignmentTombstoneDigest}`,
            `sha256:${assignmentTombstoneDigest}`,
            now,
          ],
        );
      }
      await client.query(
        `INSERT INTO tokenless_assurance_cohort_reviewers
         (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
          qualification_expires_at,maximum_active_assignments,active_reservations,status,
          network_managed,created_by,created_at,updated_at)
         VALUES ($1,$2,$3,'{"subject":"deleted"}',$4,1,0,'removed',
                 $5,'system:workspace_deletion',$4,$4)
         ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO NOTHING`,
        [row.project_id, row.cohort_id, assignmentTombstone, now, networkManaged],
      );
      if (networkManaged) {
        const assuranceSnapshot = JSON.stringify({
          schemaVersion: "rateloop.erased-assurance-snapshot.v1",
          snapshotCommitment: text(row, "assurance_snapshot_hash"),
        });
        const integrityProvenance =
          text(row, "integrity_provenance_hash") === null
            ? null
            : JSON.stringify({
                schemaVersion: "rateloop.erased-integrity-provenance.v1",
                provenanceCommitment: text(row, "integrity_provenance_hash"),
              });
        const assignment = await client.query(
          `UPDATE tokenless_assurance_assignments
           SET reviewer_account_address=$1,rater_id=$2,
               payout_account_snapshot=CASE WHEN paid_assignment=true THEN $3 ELSE NULL END,
               qualification_provenance_json='[]',assurance_snapshot_json=$4,
               blinding_json='{"subject":"deleted"}',integrity_reviewer_lookup=NULL,
               integrity_cluster_pseudonym=NULL,integrity_risk_band=NULL,
               provider_subject_hashes_json=CASE
                 WHEN provider_subject_hashes_json IS NULL THEN NULL ELSE '[]' END,
               integrity_provenance_json=$5,updated_at=$6
           WHERE assignment_id=$7 AND source='rateloop_network'`,
          [
            assignmentTombstone,
            assignmentTombstoneRater,
            assignmentTombstonePayout,
            assuranceSnapshot,
            integrityProvenance,
            now,
            assignmentId,
          ],
        );
        networkAssignmentsAnonymized += assignment.rowCount ?? 0;
        const history = await client.query(
          `UPDATE tokenless_integrity_assignment_history
           SET reviewer_lookup=$1,cluster_pseudonym=$2,provider_subject_hashes_json='[]'
           WHERE assignment_id=$3`,
          [
            `deleted-reviewer:${assignmentTombstoneDigest.slice(0, 48)}`,
            `deleted-cluster:${evidenceDigest(jobId, "network_assignment_cluster", assignmentId).slice(0, 48)}`,
            assignmentId,
          ],
        );
        networkAssignmentHistoryAnonymized += history.rowCount ?? 0;
        const voucherSnapshots = await client.query(
          `SELECT snapshot.voucher_id,snapshot.snapshot_hash
           FROM tokenless_voucher_assurance_snapshots snapshot
           JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=snapshot.voucher_id
           WHERE voucher.network_assignment_id=$1 FOR UPDATE`,
          [assignmentId],
        );
        for (const snapshotValue of voucherSnapshots.rows) {
          const snapshot = snapshotValue as Row;
          const updated = await client.query(
            `UPDATE tokenless_voucher_assurance_snapshots SET snapshot_json=$1
             WHERE voucher_id=$2`,
            [
              JSON.stringify({
                schemaVersion: "rateloop.erased-voucher-assurance-snapshot.v1",
                snapshotCommitment: text(snapshot, "snapshot_hash"),
              }),
              snapshot.voucher_id,
            ],
          );
          networkVoucherSnapshotsAnonymized += updated.rowCount ?? 0;
        }
      } else {
        await client.query(
          `UPDATE tokenless_assurance_assignments
           SET reviewer_account_address=$1,updated_at=$2 WHERE assignment_id=$3`,
          [assignmentTombstone, now, assignmentId],
        );
      }
    }
    const directAssignmentSubjects = await client.query(
      `SELECT assignment_id,project_id,cohort_id FROM tokenless_private_unpaid_review_assignments
       WHERE workspace_id=$1 ORDER BY assignment_id FOR UPDATE`,
      [input.workspaceId],
    );
    for (const value of directAssignmentSubjects.rows) {
      const row = value as Row;
      const assignmentId = text(row, "assignment_id")!;
      const assignmentTombstone = `rlp_erased_assignment_${evidenceDigest(
        jobId,
        "direct_private_assignment",
        assignmentId,
      ).slice(0, 24)}`;
      await client.query(
        `INSERT INTO tokenless_assurance_cohort_reviewers
       (project_id,cohort_id,reviewer_account_address,qualification_provenance_json,
        qualification_expires_at,maximum_active_assignments,active_reservations,status,
        network_managed,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,'{"subject":"deleted"}',$4,1,0,'removed',
               false,'system:workspace_deletion',$4,$4)
         ON CONFLICT (project_id,cohort_id,reviewer_account_address) DO NOTHING`,
        [row.project_id, row.cohort_id, assignmentTombstone, now],
      );
      await client.query(
        `UPDATE tokenless_private_unpaid_review_assignments
         SET reviewer_account_address=$1,updated_at=$2 WHERE assignment_id=$3`,
        [assignmentTombstone, now, assignmentId],
      );
    }
    await client.query(`DELETE FROM tokenless_private_group_policy_acceptances WHERE workspace_id=$1`, [
      input.workspaceId,
    ]);
    await client.query(
      `DELETE FROM tokenless_assurance_cohort_reviewers
       WHERE project_id IN (
         SELECT project_id FROM tokenless_assurance_projects WHERE workspace_id=$1
       )
       AND reviewer_account_address NOT LIKE 'rlp_erased_assignment_%'`,
      [input.workspaceId],
    );
    await client.query(`DELETE FROM tokenless_workspace_reviewer_terms_acceptances WHERE workspace_id=$1`, [
      input.workspaceId,
    ]);
    await client.query(`DELETE FROM tokenless_workspace_reviewer_invitation_redemptions WHERE workspace_id=$1`, [
      input.workspaceId,
    ]);
    await client.query(
      `UPDATE tokenless_workspace_reviewer_access_grants
       SET principal_address=$1,revoked_at=COALESCE(revoked_at,$2),
           revoked_by=COALESCE(revoked_by,'system:workspace_deletion'),
           created_by='system:workspace_deletion'
       WHERE workspace_id=$3`,
      [reviewerTombstone, now, input.workspaceId],
    );
    await client.query(
      `DELETE FROM tokenless_workspace_reviewers
       WHERE workspace_id=$1 AND principal_address<>$2`,
      [input.workspaceId, reviewerTombstone],
    );
    await client.query(
      `UPDATE tokenless_workspace_reviewer_events
       SET principal_address=NULL,actor_reference='system:workspace_deletion',
           details_json='{"workspaceSubject":"deleted"}'
       WHERE workspace_id=$1`,
      [input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_workspace_reviewer_invitations
       SET intended_account_address=NULL,intended_email_hash=NULL,intended_email_domain=NULL,
           paid_adulthood_attested=false,paid_adulthood_attested_by=NULL,paid_adulthood_attested_at=NULL,
           revoked_at=COALESCE(revoked_at,$1),revoked_by='system:workspace_deletion',
           created_by='system:workspace_deletion'
       WHERE workspace_id=$2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_private_group_invitations
       SET revoked_at = COALESCE(revoked_at, $1), revoked_by = COALESCE(revoked_by, $2)
       WHERE workspace_id = $3`,
      [now, requester, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_assurance_reviewer_invitations
       SET revoked_at = COALESCE(revoked_at, $1), intended_account_address = NULL
       WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_workspace_member_invites
       SET intended_account_address = NULL, redeemed_by_account_address = NULL
       WHERE workspace_id = $1`,
      [input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_project_access_assignments
       SET status = 'revoked', revoked_at = $1, revoked_by = $2
       WHERE workspace_id = $3 AND status = 'active'`,
      [now, requester, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_assurance_artifact_leases SET revoked_at = COALESCE(revoked_at, $1)
       WHERE workspace_id = $2`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_private_group_memberships
       SET status = 'removed', ended_at = $1, end_reason = 'workspace_deleted', updated_at = $1
       WHERE status = 'active' AND group_id IN (
         SELECT group_id FROM tokenless_private_groups WHERE workspace_id = $2
       )`,
      [now, input.workspaceId],
    );
    await client.query(
      `DELETE FROM tokenless_private_group_invitation_redemptions
       WHERE group_id IN (SELECT group_id FROM tokenless_private_groups WHERE workspace_id=$1)`,
      [input.workspaceId],
    );
    await client.query(
      `DELETE FROM tokenless_private_group_memberships
       WHERE group_id IN (SELECT group_id FROM tokenless_private_groups WHERE workspace_id=$1)`,
      [input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_private_groups SET status = 'archived', updated_at = $1
       WHERE workspace_id = $2 AND status = 'active'`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_assurance_artifact_objects
       SET delete_after = CASE WHEN delete_after < $1 THEN delete_after ELSE $1 END
       WHERE workspace_id = $2 AND status = 'active'`,
      [now, input.workspaceId],
    );
    await client.query(
      `UPDATE tokenless_public_question_media SET deletion_requested_at = $1
       WHERE workspace_id = $2 AND technical_status = 'ready'`,
      [now, input.workspaceId],
    );
    await client.query("DELETE FROM tokenless_workspace_member_clients WHERE workspace_id = $1", [input.workspaceId]);
    await client.query("DELETE FROM tokenless_workspace_member_governance WHERE workspace_id = $1", [
      input.workspaceId,
    ]);
    await client.query("DELETE FROM tokenless_workspace_members WHERE workspace_id = $1", [input.workspaceId]);
    await client.query("DELETE FROM tokenless_workspace_agent_setups WHERE workspace_id = $1", [input.workspaceId]);
    await client.query("SELECT set_config('rateloop.account_erasure','on',true)");
    await client.query("DELETE FROM tokenless_forecast_integrity_findings WHERE workspace_id=$1", [input.workspaceId]);
    await client.query("DELETE FROM tokenless_forecast_pair_accumulators WHERE workspace_id=$1", [input.workspaceId]);
    await client.query("DELETE FROM tokenless_forecast_calibration_accumulators WHERE workspace_id=$1", [
      input.workspaceId,
    ]);
    await client.query("DELETE FROM tokenless_forecast_workspace_histograms WHERE workspace_id=$1", [
      input.workspaceId,
    ]);
    await client.query("DELETE FROM tokenless_forecast_integrity_terminal_receipts WHERE workspace_id=$1", [
      input.workspaceId,
    ]);
    await client.query(
      `UPDATE tokenless_workspaces
       SET name = $1, status = 'deleted', deleted_at = $2, updated_at = $2
       WHERE workspace_id = $3`,
      [TOMBSTONED_WORKSPACE_NAME, now, input.workspaceId],
    );
    const accessPostconditions = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_workspace_reviewers
          WHERE workspace_id=$1 AND status='active') AS active_reviewers,
         (SELECT COUNT(*) FROM tokenless_workspace_reviewer_access_grants
          WHERE workspace_id=$1 AND revoked_at IS NULL) AS active_grants,
         (SELECT COUNT(*) FROM tokenless_workspace_reviewer_terms_acceptances
          WHERE workspace_id=$1) AS terms_acceptances,
         (SELECT COUNT(*) FROM tokenless_workspace_reviewer_invitation_redemptions
          WHERE workspace_id=$1) AS invitation_redemptions,
         (SELECT COUNT(*) FROM tokenless_paid_eligibility_scopes
          WHERE workspace_id=$1) AS paid_eligibility_scopes,
         (SELECT COUNT(*) FROM tokenless_forecast_calibration_accumulators
          WHERE workspace_id=$1) AS forecast_calibration,
         (SELECT COUNT(*) FROM tokenless_forecast_pair_accumulators
          WHERE workspace_id=$1) AS forecast_pairs,
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_findings
          WHERE workspace_id=$1) AS forecast_findings,
         (SELECT COUNT(*) FROM tokenless_forecast_workspace_histograms
          WHERE workspace_id=$1) AS forecast_histograms,
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_terminal_receipts
          WHERE workspace_id=$1) AS forecast_terminal_receipts,
         (SELECT COUNT(*) FROM tokenless_private_group_policy_acceptances
          WHERE workspace_id=$1) AS private_group_policy_acceptances,
         (SELECT COUNT(*) FROM tokenless_private_group_memberships membership
          JOIN tokenless_private_groups private_group ON private_group.group_id=membership.group_id
          WHERE private_group.workspace_id=$1) AS private_group_memberships,
         (SELECT COUNT(*) FROM tokenless_assurance_assignments
          WHERE workspace_id=$1 AND reviewer_account_address NOT LIKE 'rlp_erased_assignment_%')
          AS assurance_assignment_direct_subjects,
         (SELECT COUNT(*) FROM tokenless_assurance_assignments assignment
          LEFT JOIN tokenless_rater_profiles profile ON profile.rater_id=assignment.rater_id
          WHERE assignment.workspace_id=$1 AND assignment.source='rateloop_network'
            AND (assignment.reviewer_account_address NOT LIKE 'rlp_erased_assignment_%'
              OR profile.principal_id IS NOT NULL OR profile.deleted_at IS NULL
              OR (assignment.paid_assignment=true
                AND assignment.payout_account_snapshot<>profile.account_address)
              OR assignment.qualification_provenance_json<>'[]'
              OR assignment.assurance_snapshot_json
                NOT LIKE '%rateloop.erased-assurance-snapshot.v1%'
              OR assignment.blinding_json<>'{"subject":"deleted"}'
              OR assignment.integrity_reviewer_lookup IS NOT NULL
              OR assignment.integrity_cluster_pseudonym IS NOT NULL
              OR assignment.integrity_risk_band IS NOT NULL
              OR COALESCE(assignment.provider_subject_hashes_json,'[]')<>'[]'
              OR (assignment.integrity_provenance_hash IS NOT NULL
                AND COALESCE(assignment.integrity_provenance_json,'')
                  NOT LIKE '%rateloop.erased-integrity-provenance.v1%')))
          AS network_assignment_personal_copies,
         (SELECT COUNT(*) FROM tokenless_integrity_assignment_history history
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=history.assignment_id
          WHERE assignment.workspace_id=$1 AND assignment.source='rateloop_network'
            AND (history.reviewer_lookup NOT LIKE 'deleted-reviewer:%'
              OR history.cluster_pseudonym NOT LIKE 'deleted-cluster:%'
              OR history.provider_subject_hashes_json<>'[]'))
          AS network_history_personal_copies,
         (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots snapshot
          JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=snapshot.voucher_id
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=voucher.network_assignment_id
          WHERE assignment.workspace_id=$1
            AND snapshot.snapshot_json
              NOT LIKE '%rateloop.erased-voucher-assurance-snapshot.v1%')
          AS network_voucher_snapshot_personal_copies,
         (SELECT COUNT(*) FROM tokenless_private_unpaid_review_assignments
          WHERE workspace_id=$1 AND reviewer_account_address NOT LIKE 'rlp_erased_assignment_%')
          AS direct_private_assignment_subjects,
         (SELECT COUNT(*) FROM tokenless_workspace_members
          WHERE workspace_id=$1) AS workspace_memberships`,
      [input.workspaceId],
    );
    const accessRow = accessPostconditions.rows[0] as Row;
    const incompleteAccess = Object.entries(accessRow).find(([, value]) => Number(value) !== 0);
    if (incompleteAccess) {
      throw new Error(`Workspace deletion postcondition failed: ${incompleteAccess[0]}.`);
    }
    const retainedNetworkEvidence = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_paid_vouchers voucher
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=voucher.network_assignment_id
          JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
          WHERE assignment.workspace_id=$1 AND profile.principal_id IS NOT NULL)
          AS voucher_rater_links,
         (SELECT COUNT(*) FROM tokenless_voucher_assurance_snapshots snapshot
          JOIN tokenless_paid_vouchers voucher ON voucher.voucher_id=snapshot.voucher_id
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=voucher.network_assignment_id
          JOIN tokenless_rater_profiles profile ON profile.rater_id=snapshot.rater_id
          WHERE assignment.workspace_id=$1 AND profile.principal_id IS NOT NULL
            AND snapshot.snapshot_json
              LIKE '%rateloop.erased-voucher-assurance-snapshot.v1%')
          AS voucher_snapshot_rater_links,
         (SELECT COUNT(*) FROM tokenless_network_assignment_settlements settlement
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=settlement.assignment_id
          WHERE assignment.workspace_id=$1) AS settlement_commitments,
         (SELECT COUNT(*) FROM tokenless_network_assignment_settlement_receipts receipt
          JOIN tokenless_network_assignment_settlements settlement
            ON settlement.binding_id=receipt.binding_id
          JOIN tokenless_assurance_assignments assignment
            ON assignment.assignment_id=settlement.assignment_id
          WHERE assignment.workspace_id=$1) AS settlement_receipt_commitments,
         (SELECT COUNT(*) FROM tokenless_public_network_review_bindings
          WHERE workspace_id=$1) AS public_network_bindings`,
      [input.workspaceId],
    );
    const retainedNetworkRow = retainedNetworkEvidence.rows[0] as Row | undefined;
    const networkEvidenceRetention = {
      basis: "settlement_and_audit",
      form: "restricted_claim_links_and_commitment_only_receipts",
      publicNetworkBindings: integer(retainedNetworkRow, "public_network_bindings"),
      settlementCommitments: integer(retainedNetworkRow, "settlement_commitments"),
      settlementReceiptCommitments: integer(retainedNetworkRow, "settlement_receipt_commitments"),
      voucherRaterLinks: integer(retainedNetworkRow, "voucher_rater_links"),
      voucherSnapshotRaterLinks: integer(retainedNetworkRow, "voucher_snapshot_rater_links"),
    };

    await insertCategory(client, {
      category: "workspace_access",
      disposition: "erase",
      jobId,
      now,
      outcome: "revoked_and_removed",
    });
    await insertCategory(client, {
      category: "workspace_identity",
      disposition: "anonymize",
      jobId,
      now,
      outcome:
        `tombstoned:network_assignments:${networkAssignmentsAnonymized}` +
        `:network_history:${networkAssignmentHistoryAnonymized}` +
        `:network_voucher_snapshots:${networkVoucherSnapshotsAnonymized}`,
    });
    await insertCategory(client, {
      category: "private_objects",
      disposition: "erase",
      jobId,
      now,
      outcome: "no_active_objects",
      pending: hasPendingObjects,
    });
    await insertCategory(client, {
      category: "private_quote_plaintext_payloads",
      disposition: "erase",
      jobId,
      now,
      outcome: `deleted_unreferenced:${privateQuoteErasure.deletedUnreferenced}:erased_referenced_content:${privateQuoteErasure.erasedReferencedContent}`,
    });
    await insertCategory(client, {
      basisCode: "settlement_and_audit",
      category: "referenced_private_quote_commitments",
      disposition: "retain",
      jobId,
      now,
      outcome: `retained_commitment_only:${privateQuoteErasure.retainedReferencedCommitmentOnly}`,
      retentionDeadline: new Date(now.getTime() + AUDIT_RETENTION_MS),
    });
    await insertCategory(client, {
      basisCode: "statutory_record",
      category: "billing_records",
      disposition: "retain",
      jobId,
      now,
      outcome: "retained_restricted",
      retentionDeadline: new Date(now.getTime() + BILLING_RETENTION_MS),
    });
    await insertCategory(client, {
      basisCode: "settlement_and_audit",
      category: "settlement_audit",
      disposition: "retain",
      jobId,
      now,
      outcome:
        `retained_restricted:private_quote_commitments:${privateQuoteErasure.retainedReferencedCommitmentOnly}` +
        `:network_voucher_rater_links:${networkEvidenceRetention.voucherRaterLinks}` +
        `:network_snapshot_rater_links:${networkEvidenceRetention.voucherSnapshotRaterLinks}` +
        `:network_settlement_commitments:${networkEvidenceRetention.settlementCommitments}` +
        `:network_settlement_receipts:${networkEvidenceRetention.settlementReceiptCommitments}` +
        `:public_network_bindings:${networkEvidenceRetention.publicNetworkBindings}`,
      retentionDeadline: new Date(now.getTime() + AUDIT_RETENTION_MS),
    });
    if (preview.impact.publicRecords > 0) {
      await insertCategory(client, {
        basisCode: "public_record",
        category: "public_chain_records",
        disposition: "public_chain",
        jobId,
        now,
        outcome: "public_unerasable",
      });
    }
    if (preview.impact.legalHolds > 0) {
      await insertCategory(client, {
        basisCode: "active_legal_hold",
        category: "legal_hold_records",
        disposition: "retain",
        jobId,
        now,
        outcome: "retained_restricted",
      });
    }

    if (!hasPendingObjects) {
      await client.query(
        `INSERT INTO tokenless_subject_request_events
         (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
         VALUES ($1, $2, 'in_progress', 'completed', 'system:workspace_deletion', 'eligible_categories_completed', $3)`,
        [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, now],
      );
      await client.query(
        `INSERT INTO tokenless_subject_request_completions
         (completion_id, request_id, deleted_categories_json, anonymized_categories_json,
          retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
          evidence_json, completed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, '[]', $6, $7, 'system:workspace_deletion', $8)`,
        [
          `dsrc_${randomUUID().replaceAll("-", "")}`,
          requestId,
          JSON.stringify(["workspace_access", "private_objects", "private_quote_plaintext_payloads"]),
          JSON.stringify(["workspace_identity"]),
          JSON.stringify([
            { basis: "statutory_record", category: "billing_records" },
            { basis: "settlement_and_audit", category: "settlement_audit" },
            { basis: "settlement_and_audit", category: "referenced_private_quote_commitments" },
            ...(preview.impact.legalHolds > 0 ? [{ basis: "active_legal_hold", category: "legal_hold_records" }] : []),
          ]),
          JSON.stringify(preview.impact.publicRecords > 0 ? ["public_chain_records"] : []),
          JSON.stringify({
            privateQuotes: {
              deletedUnreferenced: privateQuoteErasure.deletedUnreferenced,
              ownerTombstone:
                privateQuoteErasure.retainedReferencedCommitmentOnly > 0 ? privateQuoteErasure.ownerTombstone : null,
              erasedReferencedContent: privateQuoteErasure.erasedReferencedContent,
              retainedReferencedCommitmentOnly: privateQuoteErasure.retainedReferencedCommitmentOnly,
            },
            networkEvidenceRetention,
            receiptDigest,
          }),
          now,
        ],
      );
    }

    await client.query("COMMIT");
    return {
      deleted: true as const,
      immediate: !hasPendingObjects,
      jobId,
      requestId,
      status: hasPendingObjects ? ("in_progress" as const) : ("completed" as const),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const __workspaceDeletionTestUtils = { evidenceDigest, previewFromRow };
