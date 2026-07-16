import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { authorizeProjectAccount } from "~~/lib/tokenless/projectAccess";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const SUBJECT_REQUEST_TYPES = [
  "access",
  "correction",
  "restriction",
  "objection",
  "export",
  "deletion",
] as const;
export type SubjectRequestType = (typeof SUBJECT_REQUEST_TYPES)[number];
export const SUBJECT_REQUEST_STATUSES = [
  "received",
  "identity_verified",
  "in_progress",
  "blocked_by_hold",
  "completed",
  "denied",
] as const;
export type SubjectRequestStatus = (typeof SUBJECT_REQUEST_STATUSES)[number];

const TRANSITIONS = new Map<SubjectRequestStatus, ReadonlySet<SubjectRequestStatus>>([
  ["received", new Set(["identity_verified", "denied"])],
  ["identity_verified", new Set(["in_progress", "denied"])],
  ["in_progress", new Set(["blocked_by_hold", "completed", "denied"])],
  ["blocked_by_hold", new Set(["in_progress", "completed", "denied"])],
  ["completed", new Set()],
  ["denied", new Set()],
]);

type QueryRow = Record<string, unknown>;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function required(value: string, field: string, max = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_privacy_request");
  }
  return normalized;
}

export async function createLegalHold(input: {
  accountAddress: string;
  projectId: string;
  reason: string;
  reviewAt: Date;
  scope?: string;
  workspaceId: string;
  now?: Date;
}) {
  const manager = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const now = input.now ?? new Date();
  if (input.reviewAt <= now || input.reviewAt.getTime() - now.getTime() > 365 * 86_400_000) {
    throw new TokenlessServiceError("Legal holds require a review within one year.", 400, "invalid_legal_hold_review");
  }
  const holdId = `hold_${randomUUID().replaceAll("-", "")}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_legal_holds
       (hold_id, workspace_id, project_id, scope, reason, status, created_by, created_at, review_at)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8)`,
      [
        holdId,
        input.workspaceId,
        input.projectId,
        required(input.scope ?? "project", "Hold scope", 120),
        required(input.reason, "Hold reason"),
        manager.accountReference,
        now,
        input.reviewAt,
      ],
    );
    await client.query(
      "UPDATE tokenless_assurance_projects SET legal_hold_state = 'active', updated_at = $1 WHERE project_id = $2 AND workspace_id = $3",
      [now, input.projectId, input.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "privacy.legal_hold_created",
    actorKind: "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { holdId, projectId: input.projectId, reviewAt: input.reviewAt.toISOString() },
    purpose: "legal_hold",
    reason: input.reason,
    result: "success",
    targetId: holdId,
    targetKind: "legal_hold",
    workspaceId: input.workspaceId,
  });
  return { holdId, reviewAt: input.reviewAt.toISOString() };
}

export async function releaseLegalHold(input: {
  accountAddress: string;
  holdId: string;
  projectId: string;
  reason: string;
  workspaceId: string;
  now?: Date;
}) {
  const manager = await authorizeProjectAccount({
    accountAddress: input.accountAddress,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const released = await client.query(
      `UPDATE tokenless_legal_holds
       SET status = 'released', released_by = $1, released_at = $2, release_reason = $3
       WHERE hold_id = $4 AND workspace_id = $5 AND project_id = $6 AND status = 'active'`,
      [
        manager.accountReference,
        now,
        required(input.reason, "Release reason"),
        input.holdId,
        input.workspaceId,
        input.projectId,
      ],
    );
    if (released.rowCount !== 1) {
      throw new TokenlessServiceError("Legal hold not found.", 404, "legal_hold_not_found");
    }
    await client.query(
      `UPDATE tokenless_assurance_projects SET legal_hold_state = 'none', updated_at = $1
       WHERE project_id = $2 AND workspace_id = $3
         AND NOT EXISTS (SELECT 1 FROM tokenless_legal_holds WHERE project_id = $2 AND status = 'active')`,
      [now, input.projectId, input.workspaceId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    action: "privacy.legal_hold_released",
    actorKind: "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { holdId: input.holdId, projectId: input.projectId },
    purpose: "legal_hold",
    reason: input.reason,
    result: "success",
    targetId: input.holdId,
    targetKind: "legal_hold",
    workspaceId: input.workspaceId,
  });
}

export async function assertProjectDeletionAllowed(projectId: string, workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT legal_hold_state FROM tokenless_assurance_projects
          WHERE project_id = ? AND workspace_id = ? LIMIT 1`,
    args: [projectId, workspaceId],
  });
  if (rowString(result.rows[0] as QueryRow | undefined, "legal_hold_state") === "active") {
    throw new TokenlessServiceError("Deletion is blocked by an active legal hold.", 409, "deletion_blocked_by_hold");
  }
}

export async function createSubjectRequest(input: {
  identityAssurance: string;
  principalId: string;
  requestType: SubjectRequestType;
  scope: Record<string, unknown>;
  workspaceId?: string | null;
  now?: Date;
}) {
  if (!SUBJECT_REQUEST_TYPES.includes(input.requestType)) {
    throw new TokenlessServiceError("Subject request type is invalid.", 400, "invalid_privacy_request");
  }
  const principalId = required(input.principalId, "Principal", 120);
  const now = input.now ?? new Date();
  const requestId = `dsr_${randomUUID().replaceAll("-", "")}`;
  const dueAt = new Date(now.getTime() + 30 * 86_400_000);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_subject_requests
       (request_id, principal_id, workspace_id, request_type, status, scope_json, identity_assurance, received_at, due_at)
       VALUES ($1, $2, $3, $4, 'received', $5, $6, $7, $8)`,
      [
        requestId,
        principalId,
        input.workspaceId ?? null,
        input.requestType,
        JSON.stringify(input.scope),
        required(input.identityAssurance, "Identity assurance", 120),
        now,
        dueAt,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_subject_request_events
       (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
       VALUES ($1, $2, NULL, 'received', $3, 'request_received', $4)`,
      [`dsre_${randomUUID().replaceAll("-", "")}`, requestId, principalId, now],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (input.workspaceId) {
    await appendAuditEvent({
      action: "privacy.subject_request_received",
      actorKind: "principal",
      actorReference: principalId,
      assuranceMethod: input.identityAssurance,
      metadata: { requestType: input.requestType },
      purpose: "data_subject_rights",
      reason: "subject_request",
      result: "success",
      targetId: requestId,
      targetKind: "subject_request",
      workspaceId: input.workspaceId,
    });
  }
  return { dueAt: dueAt.toISOString(), requestId };
}

export async function transitionSubjectRequest(input: {
  actorReference: string;
  nextStatus: SubjectRequestStatus;
  reason: string;
  requestId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  let workspaceId: string | null = null;
  let previousStatus: SubjectRequestStatus | null = null;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT status, workspace_id FROM tokenless_subject_requests WHERE request_id = $1 FOR UPDATE",
      [input.requestId],
    );
    const status = rowString(current.rows[0] as QueryRow | undefined, "status") as SubjectRequestStatus | null;
    if (!status) throw new TokenlessServiceError("Subject request not found.", 404, "subject_request_not_found");
    if (!TRANSITIONS.get(status)?.has(input.nextStatus)) {
      throw new TokenlessServiceError(
        "Subject request transition is invalid.",
        409,
        "invalid_subject_request_transition",
      );
    }
    previousStatus = status;
    workspaceId = rowString(current.rows[0] as QueryRow | undefined, "workspace_id");
    await client.query(
      `UPDATE tokenless_subject_requests SET status = $1, completed_at = CASE WHEN $1 IN ('completed','denied') THEN $2 ELSE NULL END
       WHERE request_id = $3`,
      [input.nextStatus, now, input.requestId],
    );
    await client.query(
      `INSERT INTO tokenless_subject_request_events
       (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `dsre_${randomUUID().replaceAll("-", "")}`,
        input.requestId,
        status,
        input.nextStatus,
        required(input.actorReference, "Actor", 160),
        required(input.reason, "Transition reason"),
        now,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (workspaceId && previousStatus) {
    await appendAuditEvent({
      action: "privacy.subject_request_transitioned",
      actorKind: "operator",
      actorReference: input.actorReference,
      assuranceMethod: "privacy_workflow",
      metadata: { fromStatus: previousStatus, toStatus: input.nextStatus },
      purpose: "data_subject_rights",
      reason: input.reason,
      result: "success",
      targetId: input.requestId,
      targetKind: "subject_request",
      workspaceId,
    });
  }
}

export async function recordSubjectRequestCompletion(input: {
  completedBy: string;
  deletedCategories?: string[];
  anonymizedCategories?: string[];
  retainedCategories?: Array<{ category: string; basis: string }>;
  pendingBackupExpiry?: Array<{ category: string; expiresAt: string }>;
  publicChainExceptions?: string[];
  evidence?: Record<string, unknown>;
  requestId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const completedBy = required(input.completedBy, "Completion actor", 160);
  const payload = {
    anonymizedCategories: JSON.stringify(input.anonymizedCategories ?? []),
    deletedCategories: JSON.stringify(input.deletedCategories ?? []),
    evidence: JSON.stringify(input.evidence ?? {}),
    pendingBackupExpiry: JSON.stringify(input.pendingBackupExpiry ?? []),
    publicChainExceptions: JSON.stringify(input.publicChainExceptions ?? []),
    retainedCategories: JSON.stringify(input.retainedCategories ?? []),
  };
  let completionId = `dsrc_${randomUUID().replaceAll("-", "")}`;
  let previousStatus: SubjectRequestStatus | null = null;
  let workspaceId: string | null = null;
  let transitioned = false;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      "SELECT status, workspace_id FROM tokenless_subject_requests WHERE request_id = $1 FOR UPDATE",
      [input.requestId],
    );
    const status = rowString(current.rows[0] as QueryRow | undefined, "status") as SubjectRequestStatus | null;
    if (!status) throw new TokenlessServiceError("Subject request not found.", 404, "subject_request_not_found");
    previousStatus = status;
    workspaceId = rowString(current.rows[0] as QueryRow | undefined, "workspace_id");
    if (status !== "completed" && !TRANSITIONS.get(status)?.has("completed")) {
      throw new TokenlessServiceError(
        "Subject request transition is invalid.",
        409,
        "invalid_subject_request_transition",
      );
    }

    const existing = await client.query(
      `SELECT completion_id, deleted_categories_json, anonymized_categories_json,
              retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
              evidence_json, completed_by
       FROM tokenless_subject_request_completions WHERE request_id = $1 FOR UPDATE`,
      [input.requestId],
    );
    let completion = existing.rows[0] as QueryRow | undefined;
    if (!completion) {
      const inserted = await client.query(
        `INSERT INTO tokenless_subject_request_completions
         (completion_id, request_id, deleted_categories_json, anonymized_categories_json,
          retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
          evidence_json, completed_by, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (request_id) DO NOTHING
         RETURNING completion_id, deleted_categories_json, anonymized_categories_json,
                   retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
                   evidence_json, completed_by`,
        [
          completionId,
          input.requestId,
          payload.deletedCategories,
          payload.anonymizedCategories,
          payload.retainedCategories,
          payload.pendingBackupExpiry,
          payload.publicChainExceptions,
          payload.evidence,
          completedBy,
          now,
        ],
      );
      completion = inserted.rows[0] as QueryRow | undefined;
      if (!completion) {
        const raced = await client.query(
          `SELECT completion_id, deleted_categories_json, anonymized_categories_json,
                  retained_categories_json, pending_backup_expiry_json, public_chain_exceptions_json,
                  evidence_json, completed_by
           FROM tokenless_subject_request_completions WHERE request_id = $1 FOR UPDATE`,
          [input.requestId],
        );
        completion = raced.rows[0] as QueryRow | undefined;
      }
    }
    if (!completion || !completionMatches(completion, payload, completedBy)) {
      throw new TokenlessServiceError(
        "Subject request completion conflicts with the recorded evidence.",
        409,
        "subject_request_completion_conflict",
      );
    }
    completionId = rowString(completion, "completion_id")!;

    if (status === "completed") {
      await client.query("COMMIT");
    } else {
      await client.query(
        "UPDATE tokenless_subject_requests SET status = 'completed', completed_at = $1 WHERE request_id = $2",
        [now, input.requestId],
      );
      await client.query(
        `INSERT INTO tokenless_subject_request_events
         (event_id, request_id, from_status, to_status, actor_reference, reason, created_at)
         VALUES ($1, $2, $3, 'completed', $4, 'completion_evidence_recorded', $5)`,
        [`dsre_${randomUUID().replaceAll("-", "")}`, input.requestId, status, completedBy, now],
      );
      transitioned = true;
      await client.query("COMMIT");
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (workspaceId && previousStatus && transitioned) {
    await appendAuditEvent({
      action: "privacy.subject_request_transitioned",
      actorKind: "operator",
      actorReference: completedBy,
      assuranceMethod: "privacy_workflow",
      metadata: { fromStatus: previousStatus, toStatus: "completed" },
      purpose: "data_subject_rights",
      reason: "completion_evidence_recorded",
      result: "success",
      targetId: input.requestId,
      targetKind: "subject_request",
      workspaceId,
    });
  }
  return completionId;
}

function completionMatches(
  row: QueryRow,
  payload: {
    anonymizedCategories: string;
    deletedCategories: string;
    evidence: string;
    pendingBackupExpiry: string;
    publicChainExceptions: string;
    retainedCategories: string;
  },
  completedBy: string,
) {
  if (rowString(row, "completed_by") !== completedBy) return false;
  const fields: Array<[string, string]> = [
    ["deleted_categories_json", payload.deletedCategories],
    ["anonymized_categories_json", payload.anonymizedCategories],
    ["retained_categories_json", payload.retainedCategories],
    ["pending_backup_expiry_json", payload.pendingBackupExpiry],
    ["public_chain_exceptions_json", payload.publicChainExceptions],
    ["evidence_json", payload.evidence],
  ];
  return fields.every(([field, expected]) => {
    const stored = rowString(row, field);
    if (stored === null) return false;
    try {
      return isDeepStrictEqual(JSON.parse(stored), JSON.parse(expected));
    } catch {
      return false;
    }
  });
}
