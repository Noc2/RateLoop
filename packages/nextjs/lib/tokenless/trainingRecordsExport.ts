import { createHash } from "node:crypto";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export const TRAINING_RECORDS_SCHEMA_VERSION = "rateloop.training-records.v1" as const;

/**
 * Article 4-shaped training and literacy record: who the workspace designated
 * for oversight (with their training records, scopes, and expiries) and which
 * reviewer qualifications exist (names, dates, scopes). Free-text competence
 * statements never leave the workspace UI, and reviewers appear only as
 * keyed digests — never as accounts. Whether these records satisfy a legal
 * requirement depends on the customer's system, context, and organization.
 */
export type TrainingRecordsExport = {
  schemaVersion: typeof TRAINING_RECORDS_SCHEMA_VERSION;
  workspaceId: string;
  exportedAt: string;
  oversightPersons: Array<{
    memberReference: string;
    role: "decision_owner";
    authorityScope: string;
    status: "active" | "expired" | "revoked";
    attestedAt: string;
    expiresAt: string;
    trainingRecords: Array<{ name: string; completedAt: string; scope: string }>;
  }>;
  reviewerQualifications: Array<{
    reviewerDigest: string;
    reviewerSource: string;
    qualificationKind: string;
    qualificationKeys: string[];
    evidenceKind: string;
    verifiedAt: string;
    expiresAt: string | null;
    status: string;
  }>;
  counts: {
    oversightPersons: number;
    activeOversightPersons: number;
    reviewerQualifications: number;
    activeReviewerQualifications: number;
  };
  exportDigest: string;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Training records must be JSON serializable.");
  return encoded;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function iso(value: unknown) {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error("Stored training-record timestamp is invalid.");
  return parsed.toISOString();
}

function trainingRecords(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(entry => {
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : null;
      const completedAt = typeof record.completedAt === "string" ? record.completedAt : null;
      const scope = typeof record.scope === "string" ? record.scope : null;
      return name && completedAt && scope ? [{ name, completedAt, scope }] : [];
    });
  } catch {
    return [];
  }
}

function qualificationKeys(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").sort() : [];
  } catch {
    return [];
  }
}

/** Deterministic per-workspace reviewer digest: never the raw account. */
function reviewerDigest(workspaceId: string, subject: string) {
  return `revr_${createHash("sha256").update(`${workspaceId}\0${subject}`).digest("hex").slice(0, 24)}`;
}

export function buildTrainingRecordsPayload(input: {
  workspaceId: string;
  oversightRows: Row[];
  qualificationRows: Row[];
  now: Date;
}) {
  const oversightPersons = input.oversightRows.map(row => {
    const status = text(row, "status")!;
    const expiresAt = iso(row.expires_at);
    return {
      memberReference: text(row, "account_address")!,
      role: "decision_owner" as const,
      authorityScope: text(row, "authority_scope")!,
      status:
        status === "revoked"
          ? ("revoked" as const)
          : new Date(expiresAt).getTime() <= input.now.getTime()
            ? ("expired" as const)
            : ("active" as const),
      attestedAt: iso(row.attested_at),
      expiresAt,
      trainingRecords: trainingRecords(row.training_records_json),
    };
  });
  const reviewerQualifications = input.qualificationRows.map(row => ({
    reviewerDigest: reviewerDigest(
      input.workspaceId,
      text(row, "reviewer_account_address") ?? text(row, "rater_id") ?? "unknown",
    ),
    reviewerSource: text(row, "reviewer_source")!,
    qualificationKind: text(row, "qualification_kind")!,
    qualificationKeys: qualificationKeys(row.qualification_keys_json),
    evidenceKind: text(row, "evidence_kind")!,
    verifiedAt: iso(row.verified_at),
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
    status: text(row, "status")!,
  }));
  return {
    oversightPersons,
    reviewerQualifications,
    counts: {
      oversightPersons: oversightPersons.length,
      activeOversightPersons: oversightPersons.filter(person => person.status === "active").length,
      reviewerQualifications: reviewerQualifications.length,
      activeReviewerQualifications: reviewerQualifications.filter(entry => entry.status === "active").length,
    },
  };
}

export async function exportTrainingRecords(input: {
  accountAddress: string;
  workspaceId: string;
  now?: Date;
}): Promise<TrainingRecordsExport> {
  let actor: string;
  try {
    actor = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ?
            AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [input.workspaceId, actor],
  });
  if (!access.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  const now = input.now ?? new Date();
  const [oversightResult, qualificationResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT account_address, authority_scope, status, attested_at, expires_at, training_records_json
            FROM tokenless_oversight_attestations WHERE workspace_id = ?
            ORDER BY account_address ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT qualification_id, rater_id, reviewer_account_address, reviewer_source, qualification_kind,
                   qualification_keys_json, evidence_kind, verified_at, expires_at, status
            FROM tokenless_reviewer_qualifications WHERE workspace_id = ?
            ORDER BY qualification_id ASC`,
      args: [input.workspaceId],
    }),
  ]);
  const body = buildTrainingRecordsPayload({
    workspaceId: input.workspaceId,
    oversightRows: oversightResult.rows as Row[],
    qualificationRows: qualificationResult.rows as Row[],
    now,
  });
  const payload = {
    schemaVersion: TRAINING_RECORDS_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    exportedAt: now.toISOString(),
    ...body,
  };
  const exported = { ...payload, exportDigest: sha256(payload) };
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "rateloop_session",
    action: "oversight.training_records_export",
    targetKind: "training_records",
    targetId: input.workspaceId,
    purpose: "workspace_assurance_export",
    reason: "authorized_administrator_export",
    result: "success",
    metadata: { exportDigest: exported.exportDigest, ...exported.counts },
    occurredAt: now,
  });
  return exported;
}
