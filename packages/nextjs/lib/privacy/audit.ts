import { createHash, randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type AuditEventInput = Readonly<{
  workspaceId: string;
  actorKind: "principal" | "account" | "api_key" | "system" | "operator";
  actorReference: string;
  assuranceMethod: string;
  action: string;
  targetKind: string;
  targetId: string;
  purpose: string;
  reason: string;
  requestCorrelation?: string | null;
  result: "success" | "denied" | "failure";
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}>;

type QueryRow = Record<string, unknown>;
const GENESIS_DIGEST = `sha256:${"0".repeat(64)}`;

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TokenlessServiceError("Audit metadata is invalid.", 400, "invalid_audit_event");
  return encoded;
}

function required(value: string, field: string, max = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_audit_event");
  }
  return normalized;
}

function digest(previousDigest: string, payloadJson: string) {
  return `sha256:${createHash("sha256").update(`${previousDigest}\n${payloadJson}`).digest("hex")}`;
}

export async function appendAuditEvent(input: AuditEventInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const eventId = `audit_${randomUUID().replaceAll("-", "")}`;
  const normalized = {
    action: required(input.action, "Audit action", 160),
    actorKind: input.actorKind,
    actorReference: required(input.actorReference, "Audit actor", 255),
    assuranceMethod: required(input.assuranceMethod, "Audit assurance method", 160),
    eventId,
    homeRegion: "eu",
    metadata: input.metadata ?? {},
    occurredAt: occurredAt.toISOString(),
    purpose: required(input.purpose, "Audit purpose", 160),
    reason: required(input.reason, "Audit reason"),
    requestCorrelation: input.requestCorrelation?.trim() || null,
    result: input.result,
    targetId: required(input.targetId, "Audit target", 255),
    targetKind: required(input.targetKind, "Audit target kind", 120),
    workspaceId: required(input.workspaceId, "Audit workspace", 160),
  } as const;
  const metadataJson = canonicalJson(normalized.metadata);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_audit_heads (workspace_id, last_sequence, last_digest, updated_at)
       VALUES ($1, 0, $2, $3) ON CONFLICT (workspace_id) DO NOTHING`,
      [normalized.workspaceId, GENESIS_DIGEST, occurredAt],
    );
    const headResult = await client.query(
      "SELECT last_sequence, last_digest FROM tokenless_audit_heads WHERE workspace_id = $1 FOR UPDATE",
      [normalized.workspaceId],
    );
    const head = headResult.rows[0] as QueryRow | undefined;
    const sequence = Number(head?.last_sequence ?? 0) + 1;
    const previousDigest = rowString(head, "last_digest") ?? GENESIS_DIGEST;
    const payloadJson = canonicalJson({ ...normalized, metadata: JSON.parse(metadataJson), sequence });
    const eventDigest = digest(previousDigest, payloadJson);
    await client.query(
      `INSERT INTO tokenless_audit_events
       (event_id, workspace_id, sequence, previous_digest, event_digest, home_region, actor_kind, actor_reference,
        assurance_method, action, target_kind, target_id, purpose, reason, request_correlation, result,
        metadata_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, 'eu', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        eventId,
        normalized.workspaceId,
        sequence,
        previousDigest,
        eventDigest,
        normalized.actorKind,
        normalized.actorReference,
        normalized.assuranceMethod,
        normalized.action,
        normalized.targetKind,
        normalized.targetId,
        normalized.purpose,
        normalized.reason,
        normalized.requestCorrelation,
        normalized.result,
        metadataJson,
        occurredAt,
      ],
    );
    await client.query(
      "UPDATE tokenless_audit_heads SET last_sequence = $1, last_digest = $2, updated_at = $3 WHERE workspace_id = $4",
      [sequence, eventDigest, occurredAt, normalized.workspaceId],
    );
    await client.query("COMMIT");
    return { eventDigest, eventId, previousDigest, sequence };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyWorkspaceAuditChain(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT event_id, sequence, previous_digest, event_digest, home_region, actor_kind, actor_reference,
                 assurance_method, action, target_kind, target_id, purpose, reason, request_correlation,
                 result, metadata_json, occurred_at
          FROM tokenless_audit_events WHERE workspace_id = ? ORDER BY sequence ASC`,
    args: [workspaceId],
  });
  let previousDigest = GENESIS_DIGEST;
  let expectedSequence = 1;
  for (const value of result.rows) {
    const row = value as QueryRow;
    if (Number(row.sequence) !== expectedSequence || rowString(row, "previous_digest") !== previousDigest) {
      return { eventCount: expectedSequence - 1, valid: false };
    }
    const payloadJson = canonicalJson({
      action: rowString(row, "action"),
      actorKind: rowString(row, "actor_kind"),
      actorReference: rowString(row, "actor_reference"),
      assuranceMethod: rowString(row, "assurance_method"),
      eventId: rowString(row, "event_id"),
      homeRegion: rowString(row, "home_region"),
      metadata: JSON.parse(rowString(row, "metadata_json") ?? "{}"),
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      purpose: rowString(row, "purpose"),
      reason: rowString(row, "reason"),
      requestCorrelation: rowString(row, "request_correlation"),
      result: rowString(row, "result"),
      sequence: expectedSequence,
      targetId: rowString(row, "target_id"),
      targetKind: rowString(row, "target_kind"),
      workspaceId,
    });
    const expectedDigest = digest(previousDigest, payloadJson);
    if (rowString(row, "event_digest") !== expectedDigest) {
      return { eventCount: expectedSequence - 1, valid: false };
    }
    previousDigest = expectedDigest;
    expectedSequence += 1;
  }
  return { eventCount: expectedSequence - 1, headDigest: previousDigest, valid: true };
}

export async function exportWorkspaceAudit(input: { accountAddress: string; workspaceId: string }) {
  let accountReference: string;
  try {
    accountReference = getAddress(input.accountAddress).toLowerCase();
  } catch {
    throw new TokenlessServiceError("A valid signed-in account is required.", 401, "invalid_account");
  }
  const member = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [input.workspaceId, accountReference],
  });
  if (!new Set(["owner", "admin"]).has(rowString(member.rows[0] as QueryRow | undefined, "role") ?? "")) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  const result = await dbClient.execute({
    sql: `SELECT event_id, sequence, previous_digest, event_digest, home_region, actor_kind, actor_reference,
                 assurance_method, action, target_kind, target_id, purpose, reason, request_correlation,
                 result, metadata_json, occurred_at
          FROM tokenless_audit_events WHERE workspace_id = ? ORDER BY sequence ASC`,
    args: [input.workspaceId],
  });
  return {
    exportedAt: new Date().toISOString(),
    format: "rateloop-audit-v1",
    integrity: await verifyWorkspaceAuditChain(input.workspaceId),
    events: result.rows,
    workspaceId: input.workspaceId,
  };
}
