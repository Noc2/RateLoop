import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const MINIMUM_RETENTION_MONTHS = 6;
const MAXIMUM_RETENTION_MONTHS = 120;

type Row = Record<string, unknown>;
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Row[] }> };

export type WorkspaceEvidenceRetentionPolicy = {
  schemaVersion: "rateloop.workspace-evidence-retention.v1";
  workspaceId: string;
  version: number;
  evidenceRetentionMonths: number;
  auditRetentionMonths: number;
  minimumRetentionMonths: 6;
  basis: { floor: "six_calendar_months"; reasons: string[] };
  effectiveAt: string;
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function exactObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Retention settings must be a JSON object.", 400, "invalid_retention_policy");
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(["evidenceRetentionMonths", "auditRetentionMonths"]);
  if (Object.keys(record).some(key => !allowed.has(key))) {
    throw new TokenlessServiceError("Retention settings contain unsupported fields.", 400, "invalid_retention_policy");
  }
  return record;
}

function months(value: unknown, name: string) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < MINIMUM_RETENTION_MONTHS ||
    Number(value) > MAXIMUM_RETENTION_MONTHS
  ) {
    throw new TokenlessServiceError(
      `${name} must be between six and 120 calendar months.`,
      400,
      "invalid_retention_policy",
    );
  }
  return Number(value);
}

function parsePolicy(row: Row, workspaceId: string): WorkspaceEvidenceRetentionPolicy {
  const basis = JSON.parse(rowString(row, "basis_json") ?? "null") as WorkspaceEvidenceRetentionPolicy["basis"];
  if (basis?.floor !== "six_calendar_months" || !Array.isArray(basis.reasons)) {
    throw new TokenlessServiceError("Stored retention policy is invalid.", 500, "stored_retention_policy_invalid");
  }
  return {
    schemaVersion: "rateloop.workspace-evidence-retention.v1",
    workspaceId,
    version: Number(row.version),
    evidenceRetentionMonths: Number(row.evidence_retention_months),
    auditRetentionMonths: Number(row.audit_retention_months),
    minimumRetentionMonths: 6,
    basis,
    effectiveAt: new Date(String(row.effective_at)).toISOString(),
  };
}

async function requireManager(client: Queryable, accountAddress: string, workspaceId: string) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const membership = await client.query(
    `SELECT m.role FROM tokenless_workspace_members m
     JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id AND w.status = 'active'
     WHERE m.workspace_id = $1 AND m.account_address = $2 AND m.role IN ('owner','admin') LIMIT 1`,
    [workspaceId, actor],
  );
  if (!membership.rows[0]) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

export async function getWorkspaceEvidenceRetentionPolicy(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceEvidenceRetentionPolicy> {
  const client = await dbPool.connect();
  try {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const result = await client.query(
      `SELECT version, evidence_retention_months, audit_retention_months, basis_json, effective_at
       FROM tokenless_workspace_evidence_retention_policies
       WHERE workspace_id = $1 AND superseded_at IS NULL LIMIT 1`,
      [input.workspaceId],
    );
    if (!result.rows[0]) {
      throw new TokenlessServiceError("Retention policy not found.", 500, "stored_retention_policy_invalid");
    }
    return parsePolicy(result.rows[0], input.workspaceId);
  } finally {
    client.release();
  }
}

export async function putWorkspaceEvidenceRetentionPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  body: unknown;
  now?: Date;
}): Promise<WorkspaceEvidenceRetentionPolicy> {
  const body = exactObject(input.body);
  const evidenceRetentionMonths = months(body.evidenceRetentionMonths, "Evidence retention");
  const auditRetentionMonths = months(body.auditRetentionMonths, "Audit retention");
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let actor = "";
  let policy: WorkspaceEvidenceRetentionPolicy;
  try {
    await client.query("BEGIN");
    actor = await requireManager(client, input.accountAddress, input.workspaceId);
    const current = await client.query(
      `SELECT version, evidence_retention_months, audit_retention_months, basis_json, effective_at
       FROM tokenless_workspace_evidence_retention_policies
       WHERE workspace_id = $1 AND superseded_at IS NULL FOR UPDATE`,
      [input.workspaceId],
    );
    const row = current.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Retention policy not found.", 500, "stored_retention_policy_invalid");
    if (
      Number(row.evidence_retention_months) === evidenceRetentionMonths &&
      Number(row.audit_retention_months) === auditRetentionMonths
    ) {
      await client.query("COMMIT");
      return parsePolicy(row, input.workspaceId);
    }
    const version = Number(row.version) + 1;
    await client.query(
      `UPDATE tokenless_workspace_evidence_retention_policies SET superseded_at = $1
       WHERE workspace_id = $2 AND version = $3 AND superseded_at IS NULL`,
      [now, input.workspaceId, row.version],
    );
    const basis = {
      floor: "six_calendar_months" as const,
      reasons: ["eu_ai_act_article_26_6_deployer_log_minimum", "workspace_assurance_evidence_policy"],
    };
    const inserted = await client.query(
      `INSERT INTO tokenless_workspace_evidence_retention_policies
       (workspace_id, version, evidence_retention_months, audit_retention_months, basis_json,
        effective_at, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $6)
       RETURNING version, evidence_retention_months, audit_retention_months, basis_json, effective_at`,
      [input.workspaceId, version, evidenceRetentionMonths, auditRetentionMonths, JSON.stringify(basis), now, actor],
    );
    policy = parsePolicy(inserted.rows[0], input.workspaceId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: "principal",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "evidence.retention.updated",
    targetKind: "workspace_evidence_retention_policy",
    targetId: `${input.workspaceId}:${policy.version}`,
    purpose: "assurance_evidence_governance",
    reason: "authorized_workspace_policy_update",
    result: "success",
    metadata: { policyVersion: policy.version, evidenceRetentionMonths, auditRetentionMonths },
  });
  return policy;
}

export const WORKSPACE_EVIDENCE_RETENTION_DEFAULTS = {
  minimumMonths: MINIMUM_RETENTION_MONTHS,
  defaultMonths: 12,
  maximumMonths: MAXIMUM_RETENTION_MONTHS,
} as const;
