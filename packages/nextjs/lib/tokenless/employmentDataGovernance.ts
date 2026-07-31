import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const EMPLOYMENT_DATA_PROCESSING_MODES = ["aggregate_only", "reviewer_analytics"] as const;
export type EmploymentDataProcessingMode = (typeof EMPLOYMENT_DATA_PROCESSING_MODES)[number];

export const EMPLOYMENT_DATA_DPIA_STATUSES = ["not_started", "not_required", "completed", "blocked"] as const;
export type EmploymentDataDpiaStatus = (typeof EMPLOYMENT_DATA_DPIA_STATUSES)[number];

export const GERMAN_WORKS_COUNCIL_STATUSES = ["not_applicable", "agreement_recorded", "blocked"] as const;
export type GermanWorksCouncilStatus = (typeof GERMAN_WORKS_COUNCIL_STATUSES)[number];

export const REVIEWER_ANALYTICS_ACTIVATION_GATES = [
  "controllerRole",
  "processorRole",
  "lawfulBasisRecordReference",
  "necessityRecordReference",
  "workerNoticeReference",
  "retentionPolicyReference",
  "accessPolicyReference",
  "dpiaStatus",
  "dpiaReference",
  "dataSubjectProcessReference",
  "worksCouncilStatus",
  "worksCouncilReference",
] as const;
export type ReviewerAnalyticsActivationGate = (typeof REVIEWER_ANALYTICS_ACTIVATION_GATES)[number];

type Row = Record<string, unknown>;

type EmploymentDataGovernanceSnapshot = {
  processingMode: EmploymentDataProcessingMode;
  controllerRole: string | null;
  processorRole: string | null;
  lawfulBasisRecordReference: string | null;
  necessityRecordReference: string | null;
  workerNoticeReference: string | null;
  retentionPolicyReference: string | null;
  accessPolicyReference: string | null;
  dpiaStatus: EmploymentDataDpiaStatus;
  dpiaReference: string | null;
  dataSubjectProcessReference: string | null;
  worksCouncilStatus: GermanWorksCouncilStatus;
  worksCouncilReference: string | null;
};

export type WorkspaceEmploymentDataGovernance = EmploymentDataGovernanceSnapshot & {
  schemaVersion: "rateloop.workspace-employment-data-governance.v1";
  workspaceId: string;
  version: number;
  reviewerAnalyticsActivationGaps: ReviewerAnalyticsActivationGate[];
  reviewerAnalyticsActivatedAt: string | null;
  reviewerAnalyticsActivatedBy: string | null;
  effectiveAt: string;
};

const PROCESSING_MODE_SET = new Set<string>(EMPLOYMENT_DATA_PROCESSING_MODES);
const DPIA_STATUS_SET = new Set<string>(EMPLOYMENT_DATA_DPIA_STATUSES);
const WORKS_COUNCIL_STATUS_SET = new Set<string>(GERMAN_WORKS_COUNCIL_STATUSES);
const INPUT_FIELDS = new Set<string>([
  "processingMode",
  "controllerRole",
  "processorRole",
  "lawfulBasisRecordReference",
  "necessityRecordReference",
  "workerNoticeReference",
  "retentionPolicyReference",
  "accessPolicyReference",
  "dpiaStatus",
  "dpiaReference",
  "dataSubjectProcessReference",
  "worksCouncilStatus",
  "worksCouncilReference",
]);
const SNAPSHOT_FIELDS = [...INPUT_FIELDS] as Array<keyof EmploymentDataGovernanceSnapshot>;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const value = rowString(row, key);
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TokenlessServiceError(
      "Stored employment-data governance is invalid.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  return date.toISOString();
}

function optionalText(value: unknown, field: string, maxLength: number) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new TokenlessServiceError(
      `${field} must be text or null.`,
      400,
      "invalid_employment_data_governance",
      false,
      field,
    );
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new TokenlessServiceError(
      `${field} must be at most ${maxLength} characters.`,
      400,
      "invalid_employment_data_governance",
      false,
      field,
    );
  }
  return normalized;
}

function exactBody(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(
      "Employment-data governance must be a JSON object.",
      400,
      "invalid_employment_data_governance",
    );
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !INPUT_FIELDS.has(key))) {
    throw new TokenlessServiceError(
      "Employment-data governance contains unsupported fields.",
      400,
      "invalid_employment_data_governance",
    );
  }
  return body;
}

function enumValue<T extends string>(value: unknown, allowed: Set<string>, field: string): T {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TokenlessServiceError(
      `${field} is unsupported.`,
      400,
      "invalid_employment_data_governance",
      false,
      field,
    );
  }
  return value as T;
}

function snapshotFromBody(value: unknown): EmploymentDataGovernanceSnapshot {
  const body = exactBody(value);
  return {
    processingMode: enumValue(body.processingMode, PROCESSING_MODE_SET, "processingMode"),
    controllerRole: optionalText(body.controllerRole, "controllerRole", 240),
    processorRole: optionalText(body.processorRole, "processorRole", 240),
    lawfulBasisRecordReference: optionalText(body.lawfulBasisRecordReference, "lawfulBasisRecordReference", 500),
    necessityRecordReference: optionalText(body.necessityRecordReference, "necessityRecordReference", 500),
    workerNoticeReference: optionalText(body.workerNoticeReference, "workerNoticeReference", 500),
    retentionPolicyReference: optionalText(body.retentionPolicyReference, "retentionPolicyReference", 500),
    accessPolicyReference: optionalText(body.accessPolicyReference, "accessPolicyReference", 500),
    dpiaStatus: enumValue(body.dpiaStatus, DPIA_STATUS_SET, "dpiaStatus"),
    dpiaReference: optionalText(body.dpiaReference, "dpiaReference", 500),
    dataSubjectProcessReference: optionalText(body.dataSubjectProcessReference, "dataSubjectProcessReference", 500),
    worksCouncilStatus: enumValue(body.worksCouncilStatus, WORKS_COUNCIL_STATUS_SET, "worksCouncilStatus"),
    worksCouncilReference: optionalText(body.worksCouncilReference, "worksCouncilReference", 500),
  };
}

export function reviewerAnalyticsActivationGaps(
  snapshot: EmploymentDataGovernanceSnapshot,
): ReviewerAnalyticsActivationGate[] {
  const gaps: ReviewerAnalyticsActivationGate[] = [];
  for (const field of [
    "controllerRole",
    "processorRole",
    "lawfulBasisRecordReference",
    "necessityRecordReference",
    "workerNoticeReference",
    "retentionPolicyReference",
    "accessPolicyReference",
    "dpiaReference",
    "dataSubjectProcessReference",
    "worksCouncilReference",
  ] as const) {
    if (!snapshot[field]) gaps.push(field);
  }
  if (snapshot.dpiaStatus !== "completed" && snapshot.dpiaStatus !== "not_required") gaps.push("dpiaStatus");
  if (snapshot.worksCouncilStatus !== "agreement_recorded" && snapshot.worksCouncilStatus !== "not_applicable") {
    gaps.push("worksCouncilStatus");
  }
  return REVIEWER_ANALYTICS_ACTIVATION_GATES.filter(gate => gaps.includes(gate));
}

function storedSnapshot(row: Row): EmploymentDataGovernanceSnapshot {
  const processingMode = rowString(row, "processing_mode");
  const dpiaStatus = rowString(row, "dpia_status");
  const worksCouncilStatus = rowString(row, "works_council_status");
  if (
    !processingMode ||
    !PROCESSING_MODE_SET.has(processingMode) ||
    !dpiaStatus ||
    !DPIA_STATUS_SET.has(dpiaStatus) ||
    !worksCouncilStatus ||
    !WORKS_COUNCIL_STATUS_SET.has(worksCouncilStatus)
  ) {
    throw new TokenlessServiceError(
      "Stored employment-data governance is invalid.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  return {
    processingMode: processingMode as EmploymentDataProcessingMode,
    controllerRole: rowString(row, "controller_role"),
    processorRole: rowString(row, "processor_role"),
    lawfulBasisRecordReference: rowString(row, "lawful_basis_record_reference"),
    necessityRecordReference: rowString(row, "necessity_record_reference"),
    workerNoticeReference: rowString(row, "worker_notice_reference"),
    retentionPolicyReference: rowString(row, "retention_policy_reference"),
    accessPolicyReference: rowString(row, "access_policy_reference"),
    dpiaStatus: dpiaStatus as EmploymentDataDpiaStatus,
    dpiaReference: rowString(row, "dpia_reference"),
    dataSubjectProcessReference: rowString(row, "data_subject_process_reference"),
    worksCouncilStatus: worksCouncilStatus as GermanWorksCouncilStatus,
    worksCouncilReference: rowString(row, "works_council_reference"),
  };
}

function governanceFromRow(row: Row | undefined, workspaceId: string): WorkspaceEmploymentDataGovernance {
  if (!row) {
    throw new TokenlessServiceError(
      "Employment-data governance was not initialized.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TokenlessServiceError(
      "Stored employment-data governance is invalid.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  const snapshot = storedSnapshot(row);
  const reviewerAnalyticsActivatedAt = rowDate(row, "reviewer_analytics_activated_at");
  const reviewerAnalyticsActivatedBy = rowString(row, "reviewer_analytics_activated_by");
  const gaps = reviewerAnalyticsActivationGaps(snapshot);
  if (
    (snapshot.processingMode === "reviewer_analytics" &&
      (gaps.length > 0 || !reviewerAnalyticsActivatedAt || !reviewerAnalyticsActivatedBy)) ||
    (snapshot.processingMode === "aggregate_only" && (reviewerAnalyticsActivatedAt || reviewerAnalyticsActivatedBy))
  ) {
    throw new TokenlessServiceError(
      "Stored employment-data governance is invalid.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  const effectiveAt = rowDate(row, "effective_at");
  if (!effectiveAt) {
    throw new TokenlessServiceError(
      "Stored employment-data governance is invalid.",
      500,
      "stored_employment_data_governance_invalid",
    );
  }
  return {
    schemaVersion: "rateloop.workspace-employment-data-governance.v1",
    workspaceId,
    version,
    ...snapshot,
    reviewerAnalyticsActivationGaps: gaps,
    reviewerAnalyticsActivatedAt,
    reviewerAnalyticsActivatedBy,
    effectiveAt,
  };
}

async function requireManager(client: PoolClient, accountAddress: string, workspaceId: string) {
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
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return actor;
}

const SELECT_LATEST = `SELECT version, processing_mode, controller_role, processor_role,
  lawful_basis_record_reference, necessity_record_reference, worker_notice_reference,
  retention_policy_reference, access_policy_reference, dpia_status, dpia_reference,
  data_subject_process_reference, works_council_status, works_council_reference,
  reviewer_analytics_activated_at, reviewer_analytics_activated_by, effective_at
  FROM tokenless_workspace_employment_data_governance_versions
  WHERE workspace_id = $1 ORDER BY version DESC LIMIT 1`;

export async function getWorkspaceEmploymentDataGovernance(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceEmploymentDataGovernance> {
  const client = await dbPool.connect();
  try {
    await requireManager(client, input.accountAddress, input.workspaceId);
    const result = await client.query(SELECT_LATEST, [input.workspaceId]);
    return governanceFromRow(result.rows[0] as Row | undefined, input.workspaceId);
  } finally {
    client.release();
  }
}

function sameSnapshot(left: EmploymentDataGovernanceSnapshot, right: EmploymentDataGovernanceSnapshot) {
  return SNAPSHOT_FIELDS.every(field => left[field] === right[field]);
}

export async function putWorkspaceEmploymentDataGovernance(input: {
  accountAddress: string;
  workspaceId: string;
  body: unknown;
  now?: Date;
}): Promise<WorkspaceEmploymentDataGovernance> {
  const snapshot = snapshotFromBody(input.body);
  const gaps = reviewerAnalyticsActivationGaps(snapshot);
  if (snapshot.processingMode === "reviewer_analytics" && gaps.length > 0) {
    throw new TokenlessServiceError(
      `Reviewer analytics cannot be activated until these governance gates are complete: ${gaps.join(", ")}.`,
      409,
      "reviewer_analytics_governance_incomplete",
    );
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new TokenlessServiceError("now must be a valid date.", 400, "invalid_employment_data_governance");
  }
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await requireManager(client, input.accountAddress, input.workspaceId);
    await client.query("SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 FOR UPDATE", [
      input.workspaceId,
    ]);
    const currentResult = await client.query(`${SELECT_LATEST} FOR UPDATE`, [input.workspaceId]);
    const current = governanceFromRow(currentResult.rows[0] as Row | undefined, input.workspaceId);
    if (sameSnapshot(current, snapshot)) {
      await client.query("COMMIT");
      return current;
    }
    const version = current.version + 1;
    const reviewerAnalyticsActivatedAt = snapshot.processingMode === "reviewer_analytics" ? now : null;
    const reviewerAnalyticsActivatedBy = snapshot.processingMode === "reviewer_analytics" ? actor : null;
    const inserted = await client.query(
      `INSERT INTO tokenless_workspace_employment_data_governance_versions
       (workspace_id, version, processing_mode, controller_role, processor_role,
        lawful_basis_record_reference, necessity_record_reference, worker_notice_reference,
        retention_policy_reference, access_policy_reference, dpia_status, dpia_reference,
        data_subject_process_reference, works_council_status, works_council_reference,
        reviewer_analytics_activated_at, reviewer_analytics_activated_by, effective_at, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$18)
       RETURNING version, processing_mode, controller_role, processor_role,
         lawful_basis_record_reference, necessity_record_reference, worker_notice_reference,
         retention_policy_reference, access_policy_reference, dpia_status, dpia_reference,
         data_subject_process_reference, works_council_status, works_council_reference,
         reviewer_analytics_activated_at, reviewer_analytics_activated_by, effective_at`,
      [
        input.workspaceId,
        version,
        snapshot.processingMode,
        snapshot.controllerRole,
        snapshot.processorRole,
        snapshot.lawfulBasisRecordReference,
        snapshot.necessityRecordReference,
        snapshot.workerNoticeReference,
        snapshot.retentionPolicyReference,
        snapshot.accessPolicyReference,
        snapshot.dpiaStatus,
        snapshot.dpiaReference,
        snapshot.dataSubjectProcessReference,
        snapshot.worksCouncilStatus,
        snapshot.worksCouncilReference,
        reviewerAnalyticsActivatedAt,
        reviewerAnalyticsActivatedBy,
        now,
        actor,
      ],
    );
    const governance = governanceFromRow(inserted.rows[0] as Row | undefined, input.workspaceId);
    await appendAuditEvent(
      {
        workspaceId: input.workspaceId,
        actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
        actorReference: actor,
        assuranceMethod: "rateloop_session",
        action: "employment_data.governance.updated",
        targetKind: "workspace_employment_data_governance",
        targetId: `${input.workspaceId}:${version}`,
        purpose: "employment_data_governance",
        reason: "authorized_workspace_governance_update",
        result: "success",
        metadata: {
          version,
          previousVersion: current.version,
          processingMode: snapshot.processingMode,
          dpiaStatus: snapshot.dpiaStatus,
          worksCouncilStatus: snapshot.worksCouncilStatus,
        },
        occurredAt: now,
      },
      client,
    );
    await client.query("COMMIT");
    return governance;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
