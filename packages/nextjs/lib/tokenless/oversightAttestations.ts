import { createHash } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export const OVERSIGHT_AUTHORITY_SCOPES = ["override", "stop", "both"] as const;
export type OversightAuthorityScope = (typeof OVERSIGHT_AUTHORITY_SCOPES)[number];

export type OversightTrainingRecord = {
  name: string;
  completedAt: string;
  scope: string;
};

export type OversightAttestation = {
  attestationId: string;
  workspaceId: string;
  memberAccountAddress: string;
  competenceBasis: string;
  trainingRecords: OversightTrainingRecord[];
  authorityScope: OversightAuthorityScope;
  attestedBy: string;
  attestedAt: string;
  expiresAt: string;
  status: "active" | "revoked";
  expired: boolean;
  revokedAt: string | null;
  revokedBy: string | null;
};

const DEFAULT_ATTESTATION_TTL_MS = 365 * 86_400_000;
const MAXIMUM_ATTESTATION_TTL_MS = 2 * 365 * 86_400_000;
const MAX_TRAINING_RECORDS = 50;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Stored ${key} is invalid.`);
  return parsed.toISOString();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Oversight attestation value is not JSON serializable.");
  return encoded;
}

function invalidAttestation(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_oversight_attestation");
}

function normalizeCompetenceBasis(value: unknown) {
  if (typeof value !== "string") invalidAttestation("competenceBasis must be 1-2000 characters.");
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000) invalidAttestation("competenceBasis must be 1-2000 characters.");
  return normalized;
}

function normalizeAuthorityScope(value: unknown): OversightAuthorityScope {
  if (typeof value !== "string" || !OVERSIGHT_AUTHORITY_SCOPES.includes(value as OversightAuthorityScope)) {
    invalidAttestation("authorityScope must be override, stop, or both.");
  }
  return value as OversightAuthorityScope;
}

export function normalizeOversightTrainingRecords(value: unknown): OversightTrainingRecord[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TRAINING_RECORDS) {
    invalidAttestation(`trainingRecords must be an array of at most ${MAX_TRAINING_RECORDS} records.`);
  }
  return value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalidAttestation("Each training record must be an object with name, completedAt, and scope.");
    }
    const record = entry as Record<string, unknown>;
    const unexpected = Object.keys(record).filter(key => !["name", "completedAt", "scope"].includes(key));
    if (unexpected.length > 0) {
      invalidAttestation("Each training record must carry only name, completedAt, and scope.");
    }
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const scope = typeof record.scope === "string" ? record.scope.trim() : "";
    const completedAt = typeof record.completedAt === "string" ? new Date(record.completedAt) : null;
    if (!name || name.length > 200) invalidAttestation("Training record names must be 1-200 characters.");
    if (!scope || scope.length > 200) invalidAttestation("Training record scopes must be 1-200 characters.");
    if (!completedAt || !Number.isFinite(completedAt.getTime())) {
      invalidAttestation("Training record completedAt must be a valid timestamp.");
    }
    return { name, completedAt: completedAt.toISOString(), scope };
  });
}

function parseTrainingRecords(value: unknown): OversightTrainingRecord[] {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed as OversightTrainingRecord[];
  } catch {
    throw new Error("Stored oversight training records are invalid.");
  }
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ?
            AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function attestationId(workspaceId: string, member: string) {
  return `ovat_${createHash("sha256").update(`${workspaceId}\0${member}`).digest("hex").slice(0, 32)}`;
}

function attestationFromRow(row: Row, now: Date): OversightAttestation {
  const expiresAt = iso(row, "expires_at");
  const status = text(row, "status") as "active" | "revoked";
  if (!expiresAt || (status !== "active" && status !== "revoked")) {
    throw new Error("Stored oversight attestation is invalid.");
  }
  return {
    attestationId: text(row, "attestation_id")!,
    workspaceId: text(row, "workspace_id")!,
    memberAccountAddress: text(row, "account_address")!,
    competenceBasis: text(row, "competence_basis")!,
    trainingRecords: parseTrainingRecords(row.training_records_json),
    authorityScope: text(row, "authority_scope") as OversightAuthorityScope,
    attestedBy: text(row, "attested_by")!,
    attestedAt: iso(row, "attested_at")!,
    expiresAt,
    status,
    expired: status === "active" && new Date(expiresAt).getTime() <= now.getTime(),
    revokedAt: iso(row, "revoked_at"),
    revokedBy: text(row, "revoked_by"),
  };
}

async function auditActor(actor: string) {
  return {
    actorKind: isRateLoopPrincipalId(actor) ? ("principal" as const) : ("account" as const),
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    purpose: "workspace_oversight_designation",
  };
}

export async function attestOversightDesignation(input: {
  accountAddress: string;
  workspaceId: string;
  memberAccountAddress: string;
  competenceBasis: unknown;
  trainingRecords?: unknown;
  authorityScope: unknown;
  expiresAt?: string | null;
  now?: Date;
}): Promise<OversightAttestation> {
  const actor = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  let member: string;
  try {
    member = normalizeAccountSubject(input.memberAccountAddress);
  } catch {
    throw new TokenlessServiceError("Oversight member account is invalid.", 400, "invalid_account");
  }
  const competenceBasis = normalizeCompetenceBasis(input.competenceBasis);
  const authorityScope = normalizeAuthorityScope(input.authorityScope);
  const trainingRecords = normalizeOversightTrainingRecords(input.trainingRecords);
  const now = input.now ?? new Date();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(now.getTime() + DEFAULT_ATTESTATION_TTL_MS);
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= now ||
    expiresAt.getTime() - now.getTime() > MAXIMUM_ATTESTATION_TTL_MS
  ) {
    invalidAttestation("Oversight attestation expiry must be in the future and within 24 months.");
  }
  const designated = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_member_governance g
          JOIN tokenless_workspace_members m
            ON m.workspace_id = g.workspace_id AND m.account_address = g.account_address
          WHERE g.workspace_id = ? AND g.account_address = ? AND g.governance_role = 'decision_owner' LIMIT 1`,
    args: [input.workspaceId, member],
  });
  if (!designated.rowCount) {
    throw new TokenlessServiceError(
      "Oversight attestations require a workspace member holding the decision_owner role.",
      404,
      "oversight_member_not_found",
    );
  }
  const id = attestationId(input.workspaceId, member);
  const result = await dbClient.execute({
    sql: `INSERT INTO tokenless_oversight_attestations
          (attestation_id, workspace_id, account_address, competence_basis, training_records_json,
           authority_scope, attested_by, attested_at, expires_at, status, revoked_at, revoked_by,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, ?, ?)
          ON CONFLICT (attestation_id) DO UPDATE SET
            competence_basis = EXCLUDED.competence_basis,
            training_records_json = EXCLUDED.training_records_json,
            authority_scope = EXCLUDED.authority_scope,
            attested_by = EXCLUDED.attested_by,
            attested_at = EXCLUDED.attested_at,
            expires_at = EXCLUDED.expires_at,
            status = 'active', revoked_at = NULL, revoked_by = NULL,
            updated_at = EXCLUDED.updated_at
          RETURNING *`,
    args: [
      id,
      input.workspaceId,
      member,
      competenceBasis,
      stableJson(trainingRecords),
      authorityScope,
      actor,
      now,
      expiresAt,
      now,
      now,
    ],
  });
  const attestation = attestationFromRow(result.rows[0] as Row, now);
  await appendAuditEvent({
    ...(await auditActor(actor)),
    workspaceId: input.workspaceId,
    action: "oversight.designation_attested",
    targetKind: "oversight_attestation",
    targetId: id,
    reason: "workspace_manager_attested_oversight_designation",
    result: "success",
    metadata: {
      memberReference: member,
      role: "decision_owner",
      authorityScope,
      expiresAt: attestation.expiresAt,
      trainingRecordCount: trainingRecords.length,
    },
    occurredAt: now,
  });
  return attestation;
}

export async function revokeOversightDesignation(input: {
  accountAddress: string;
  workspaceId: string;
  memberAccountAddress: string;
  now?: Date;
}): Promise<OversightAttestation> {
  const actor = await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  let member: string;
  try {
    member = normalizeAccountSubject(input.memberAccountAddress);
  } catch {
    throw new TokenlessServiceError("Oversight member account is invalid.", 400, "invalid_account");
  }
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_oversight_attestations
          SET status = 'revoked', revoked_at = ?, revoked_by = ?, updated_at = ?
          WHERE workspace_id = ? AND account_address = ? AND status = 'active'
          RETURNING *`,
    args: [now, actor, now, input.workspaceId, member],
  });
  if (!result.rowCount) {
    throw new TokenlessServiceError("Oversight attestation not found.", 404, "oversight_attestation_not_found");
  }
  const attestation = attestationFromRow(result.rows[0] as Row, now);
  await appendAuditEvent({
    ...(await auditActor(actor)),
    workspaceId: input.workspaceId,
    action: "oversight.designation_revoked",
    targetKind: "oversight_attestation",
    targetId: attestation.attestationId,
    reason: "workspace_manager_revoked_oversight_designation",
    result: "success",
    metadata: { memberReference: member, role: "decision_owner" },
    occurredAt: now,
  });
  return attestation;
}

export async function listOversightDesignations(input: {
  accountAddress: string;
  workspaceId: string;
  now?: Date;
}): Promise<OversightAttestation[]> {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_oversight_attestations
          WHERE workspace_id = ? ORDER BY account_address ASC`,
    args: [input.workspaceId],
  });
  return result.rows.map(row => attestationFromRow(row as Row, now));
}

/**
 * Privacy-safe export summary: counts, authority scopes, expiries, and training
 * record names only. The competence-basis free text never leaves the workspace UI.
 */
export function summarizeOversightDesignationsForExport(rows: Row[], now: Date) {
  const designations = rows.map(row => {
    const expiresAt = iso(row, "expires_at")!;
    const status = text(row, "status")!;
    return {
      memberReference: text(row, "account_address")!,
      role: "decision_owner" as const,
      authorityScope: text(row, "authority_scope") as OversightAuthorityScope,
      status:
        status === "revoked"
          ? ("revoked" as const)
          : new Date(expiresAt).getTime() <= now.getTime()
            ? ("expired" as const)
            : ("active" as const),
      attestedAt: iso(row, "attested_at")!,
      expiresAt,
      trainingRecordNames: parseTrainingRecords(row.training_records_json).map(record => record.name),
    };
  });
  return {
    role: "decision_owner" as const,
    counts: {
      total: designations.length,
      active: designations.filter(entry => entry.status === "active").length,
      expired: designations.filter(entry => entry.status === "expired").length,
      revoked: designations.filter(entry => entry.status === "revoked").length,
    },
    designations,
  };
}
