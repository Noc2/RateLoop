import { randomUUID } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown>;

export const PROJECT_ACCESS_ROLES = ["admin", "contributor", "auditor", "reviewer"] as const;
export type ProjectAccessRole = (typeof PROJECT_ACCESS_ROLES)[number];

const ACTION_ROLES = {
  manage: new Set<ProjectAccessRole>(["admin"]),
  write: new Set<ProjectAccessRole>(["admin", "contributor"]),
  read: new Set<ProjectAccessRole>(["admin", "contributor", "auditor"]),
  export: new Set<ProjectAccessRole>(["admin", "auditor"]),
} as const;

export type ProjectAccessAction = keyof typeof ACTION_ROLES;
export type ProjectAccessSubjectKind = "account" | "principal" | "api_key";

export function projectRoleAllowsAction(role: ProjectAccessRole, action: ProjectAccessAction) {
  return ACTION_ROLES[action].has(role);
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export function projectAccountReference(accountAddress: string) {
  try {
    return normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
}

function assertRole(role: string): asserts role is ProjectAccessRole {
  if (!PROJECT_ACCESS_ROLES.includes(role as ProjectAccessRole)) {
    throw new TokenlessServiceError("The project role is invalid.", 400, "invalid_project_role");
  }
}

export async function authorizeProjectSubject(input: {
  action: ProjectAccessAction;
  projectId: string;
  subjectKind: ProjectAccessSubjectKind;
  subjectReference: string;
  workspaceId: string;
  now?: Date;
}) {
  const subjectReference =
    input.subjectKind === "account"
      ? projectAccountReference(input.subjectReference)
      : input.subjectReference.trim().toLowerCase();
  if (!subjectReference) {
    throw new TokenlessServiceError("The project subject is invalid.", 401, "invalid_project_subject");
  }
  const result = await dbClient.execute({
    sql: `SELECT pa.assignment_id, pa.role, p.retention_days
          FROM tokenless_project_access_assignments pa
          JOIN tokenless_assurance_projects p
            ON p.project_id = pa.project_id AND p.workspace_id = pa.workspace_id
          JOIN tokenless_workspaces w ON w.workspace_id = pa.workspace_id
          WHERE pa.workspace_id = ? AND pa.project_id = ?
            AND pa.subject_kind = ? AND pa.subject_reference = ?
            AND pa.status = 'active' AND (pa.expires_at IS NULL OR pa.expires_at > ?)
            AND p.status <> 'deleted' AND w.status = 'active'
          LIMIT 1`,
    args: [input.workspaceId, input.projectId, input.subjectKind, subjectReference, input.now ?? new Date()],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const role = rowString(row, "role");
  if (!role) {
    throw new TokenlessServiceError("Project not found.", 404, "project_not_found");
  }
  assertRole(role);
  if (!projectRoleAllowsAction(role, input.action)) {
    throw new TokenlessServiceError("Project access is not permitted.", 403, "project_access_forbidden");
  }
  return {
    subjectReference,
    assignmentId: rowString(row, "assignment_id")!,
    retentionDays: Number(rowString(row, "retention_days")),
    role,
  };
}

export async function listProjectAuditorAccess(input: { listedBy: string; projectId: string; workspaceId: string }) {
  await authorizeProjectAccount({
    accountAddress: input.listedBy,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const result = await dbClient.execute({
    sql: `SELECT assignment_id,subject_kind,subject_reference,expires_at,granted_by,reason,created_at
          FROM tokenless_project_access_assignments
          WHERE workspace_id=? AND project_id=? AND role='auditor' AND status='active'
            AND (expires_at IS NULL OR expires_at>?)
          ORDER BY created_at ASC,assignment_id ASC`,
    args: [input.workspaceId, input.projectId, new Date()],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    const expiresAt = row.expires_at === null || row.expires_at === undefined ? null : new Date(String(row.expires_at));
    const createdAt = new Date(String(row.created_at));
    if (!Number.isFinite(createdAt.getTime()) || (expiresAt && !Number.isFinite(expiresAt.getTime()))) {
      throw new Error("Stored project auditor assignment timestamps are invalid.");
    }
    return {
      assignmentId: rowString(row, "assignment_id")!,
      subjectKind: rowString(row, "subject_kind") as ProjectAccessSubjectKind,
      subjectReference: rowString(row, "subject_reference")!,
      expiresAt: expiresAt?.toISOString() ?? null,
      grantedBy: rowString(row, "granted_by")!,
      reason: rowString(row, "reason"),
      createdAt: createdAt.toISOString(),
    };
  });
}

export async function authorizeProjectAccount(input: {
  accountAddress: string;
  action: ProjectAccessAction;
  projectId: string;
  workspaceId: string;
  now?: Date;
}) {
  const result = await authorizeProjectSubject({
    action: input.action,
    now: input.now,
    projectId: input.projectId,
    subjectKind: isRateLoopPrincipalId(input.accountAddress) ? "principal" : "account",
    subjectReference: input.accountAddress,
    workspaceId: input.workspaceId,
  });
  return { ...result, accountReference: result.subjectReference };
}

export async function grantProjectAccountAccess(input: {
  accountAddress: string;
  expiresAt?: Date | null;
  grantedBy: string;
  projectId: string;
  reason?: string;
  role: ProjectAccessRole;
  workspaceId: string;
}) {
  assertRole(input.role);
  const manager = await authorizeProjectAccount({
    accountAddress: input.grantedBy,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const subjectReference = projectAccountReference(input.accountAddress);
  const subjectKind = isRateLoopPrincipalId(subjectReference) ? "principal" : "account";
  const now = new Date();
  if (input.expiresAt && input.expiresAt <= now) {
    throw new TokenlessServiceError("Project access expiry must be in the future.", 400, "invalid_project_expiry");
  }
  const existing = await dbClient.execute({
    sql: `SELECT assignment_id,expires_at FROM tokenless_project_access_assignments
          WHERE workspace_id=? AND project_id=? AND subject_kind=? AND subject_reference=? AND status='active'
          LIMIT 1`,
    args: [input.workspaceId, input.projectId, subjectKind, subjectReference],
  });
  const existingRow = existing.rows[0] as QueryRow | undefined;
  const existingAssignmentId = rowString(existingRow, "assignment_id");
  if (existingAssignmentId) {
    const existingExpiry =
      existingRow?.expires_at === null || existingRow?.expires_at === undefined
        ? null
        : new Date(String(existingRow.expires_at));
    if (!existingExpiry || !Number.isFinite(existingExpiry.getTime()) || existingExpiry > now) {
      throw new TokenlessServiceError("This subject already has project access.", 409, "project_assignment_exists");
    }
    await dbClient.execute({
      sql: `UPDATE tokenless_project_access_assignments
            SET status='revoked',revoked_at=?,revoked_by=?
            WHERE assignment_id=? AND status='active'`,
      args: [now, manager.accountReference, existingAssignmentId],
    });
  }
  const assignmentId = `paccess_${randomUUID().replaceAll("-", "")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_project_access_assignments
          (assignment_id, workspace_id, project_id, subject_kind, subject_reference, role, status,
           expires_at, granted_by, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    args: [
      assignmentId,
      input.workspaceId,
      input.projectId,
      subjectKind,
      subjectReference,
      input.role,
      input.expiresAt ?? null,
      manager.accountReference,
      input.reason?.trim() || "project_access",
      now,
    ],
  });
  await appendAuditEvent({
    action: "project.access_granted",
    actorKind: isRateLoopPrincipalId(manager.accountReference) ? "principal" : "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { assignmentId, role: input.role, subjectKind },
    purpose: "project_authorization",
    reason: input.reason?.trim() || "project_access",
    result: "success",
    targetId: subjectReference,
    targetKind: "project_subject",
    workspaceId: input.workspaceId,
  });
  return { assignmentId, subjectReference };
}

export async function revokeProjectAccess(input: {
  assignmentId: string;
  projectId: string;
  revokedBy: string;
  workspaceId: string;
}) {
  const manager = await authorizeProjectAccount({
    accountAddress: input.revokedBy,
    action: "manage",
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_project_access_assignments
          SET status = 'revoked', revoked_at = ?, revoked_by = ?
          WHERE assignment_id = ? AND workspace_id = ? AND project_id = ? AND status = 'active'`,
    args: [new Date(), manager.accountReference, input.assignmentId, input.workspaceId, input.projectId],
  });
  if (result.rowCount !== 1) {
    throw new TokenlessServiceError("Project assignment not found.", 404, "project_assignment_not_found");
  }
  await appendAuditEvent({
    action: "project.access_revoked",
    actorKind: isRateLoopPrincipalId(manager.accountReference) ? "principal" : "account",
    actorReference: manager.accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { assignmentId: input.assignmentId, projectId: input.projectId },
    purpose: "project_authorization",
    reason: "assignment_revoked",
    result: "success",
    targetId: input.assignmentId,
    targetKind: "project_assignment",
    workspaceId: input.workspaceId,
  });
}

export async function createProjectOwnerAssignment(input: {
  accountAddress: string;
  projectId: string;
  workspaceId: string;
  now?: Date;
}) {
  const subjectReference = projectAccountReference(input.accountAddress);
  return createInitialProjectAssignment({
    now: input.now,
    projectId: input.projectId,
    subjectKind: isRateLoopPrincipalId(subjectReference) ? "principal" : "account",
    subjectReference,
    workspaceId: input.workspaceId,
  });
}

export async function createInitialProjectAssignment(input: {
  now?: Date;
  projectId: string;
  subjectKind: "account" | "principal" | "api_key";
  subjectReference: string;
  workspaceId: string;
}) {
  const subjectReference = input.subjectReference.trim().toLowerCase();
  if (!subjectReference || subjectReference.length > 255) {
    throw new TokenlessServiceError("The project subject is invalid.", 400, "invalid_project_subject");
  }
  const assignmentId = `paccess_${randomUUID().replaceAll("-", "")}`;
  const now = input.now ?? new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_project_access_assignments
          (assignment_id, workspace_id, project_id, subject_kind, subject_reference, role, status,
           expires_at, granted_by, reason, created_at)
          VALUES (?, ?, ?, ?, ?, 'admin', 'active', NULL, ?, 'project_creator', ?)`,
    args: [
      assignmentId,
      input.workspaceId,
      input.projectId,
      input.subjectKind,
      subjectReference,
      `${input.subjectKind}:${subjectReference}`,
      now,
    ],
  });
  await appendAuditEvent({
    action: "project.access_initialized",
    actorKind:
      input.subjectKind === "api_key" ? "api_key" : input.subjectKind === "principal" ? "principal" : "account",
    actorReference: subjectReference,
    assuranceMethod: "project_creation",
    metadata: { assignmentId, subjectKind: input.subjectKind },
    purpose: "project_authorization",
    reason: "project_creator",
    result: "success",
    targetId: assignmentId,
    targetKind: "project_assignment",
    workspaceId: input.workspaceId,
  });
  return assignmentId;
}
