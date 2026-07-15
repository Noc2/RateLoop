import { randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { dbClient } from "~~/lib/db";
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

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export function projectAccountReference(accountAddress: string) {
  try {
    return getAddress(accountAddress).toLowerCase();
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
  if (!ACTION_ROLES[input.action].has(role)) {
    throw new TokenlessServiceError("Project access is not permitted.", 403, "project_access_forbidden");
  }
  return {
    subjectReference,
    assignmentId: rowString(row, "assignment_id")!,
    retentionDays: Number(rowString(row, "retention_days")),
    role,
  };
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
    subjectKind: "account",
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
  const now = new Date();
  if (input.expiresAt && input.expiresAt <= now) {
    throw new TokenlessServiceError("Project access expiry must be in the future.", 400, "invalid_project_expiry");
  }
  const assignmentId = `paccess_${randomUUID().replaceAll("-", "")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_project_access_assignments
          (assignment_id, workspace_id, project_id, subject_kind, subject_reference, role, status,
           expires_at, granted_by, reason, created_at)
          VALUES (?, ?, ?, 'account', ?, ?, 'active', ?, ?, ?, ?)`,
    args: [
      assignmentId,
      input.workspaceId,
      input.projectId,
      subjectReference,
      input.role,
      input.expiresAt ?? null,
      manager.accountReference,
      input.reason?.trim() || "project_access",
      now,
    ],
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
    subjectKind: "account",
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
  return assignmentId;
}
