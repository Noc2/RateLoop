import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { enqueueAssuranceAttestation } from "~~/lib/tokenless/assuranceAttestationPipeline";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type AuditEventInput = Readonly<{
  workspaceId: string;
  actorKind: "principal" | "account" | "api_key" | "oauth_token_family" | "system" | "operator";
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
  idempotencyKey?: string;
}>;

export type SecurityAuditEventInput = Readonly<{
  scopeKind: "identity" | "system";
  scopeId: string;
  actorKind: "principal" | "system" | "operator";
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
const MAX_AUDIT_METADATA_BYTES = 16 * 1024;
const FORBIDDEN_METADATA_KEY =
  /(?:authorization|cookie|email|jwt|otp|password|private[_-]?key|refresh[_-]?token|secret|signature)/iu;

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

function assertSafeAuditMetadata(value: unknown, path = "metadata", depth = 0): void {
  if (depth > 6) {
    throw new TokenlessServiceError("Audit metadata is too deeply nested.", 400, "invalid_audit_event");
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && value.length > 2_048) {
      throw new TokenlessServiceError("Audit metadata contains an oversized value.", 400, "invalid_audit_event");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TokenlessServiceError("Audit metadata contains an invalid number.", 400, "invalid_audit_event");
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new TokenlessServiceError("Audit metadata contains too many values.", 400, "invalid_audit_event");
    }
    value.forEach((entry, index) => assertSafeAuditMetadata(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") {
    throw new TokenlessServiceError("Audit metadata contains an unsupported value.", 400, "invalid_audit_event");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) {
    throw new TokenlessServiceError("Audit metadata contains too many fields.", 400, "invalid_audit_event");
  }
  for (const [key, entry] of entries) {
    if (!key || key.length > 80 || FORBIDDEN_METADATA_KEY.test(key)) {
      throw new TokenlessServiceError(
        `Audit metadata field ${path}.${key || "unknown"} is forbidden.`,
        400,
        "invalid_audit_event",
      );
    }
    assertSafeAuditMetadata(entry, `${path}.${key}`, depth + 1);
  }
}

function auditMetadataJson(metadata: Record<string, unknown>) {
  assertSafeAuditMetadata(metadata);
  const encoded = canonicalJson(metadata);
  if (Buffer.byteLength(encoded, "utf8") > MAX_AUDIT_METADATA_BYTES) {
    throw new TokenlessServiceError("Audit metadata is too large.", 400, "invalid_audit_event");
  }
  return encoded;
}

function required(value: string, field: string, max = 500) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_audit_event");
  }
  return normalized;
}

function optionalCorrelation(value: string | null | undefined) {
  const normalized = value?.trim() || null;
  if (normalized && (normalized.length > 160 || !/^[A-Za-z0-9._:-]+$/u.test(normalized))) {
    return null;
  }
  return normalized;
}

function optionalIdempotencyKey(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = required(value, "Audit idempotency key", 255);
  if (!/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    throw new TokenlessServiceError("Audit idempotency key is invalid.", 400, "invalid_audit_event");
  }
  return normalized;
}

function digest(previousDigest: string, payloadJson: string) {
  return `sha256:${createHash("sha256").update(`${previousDigest}\n${payloadJson}`).digest("hex")}`;
}

function securityScope(input: Pick<SecurityAuditEventInput, "scopeId" | "scopeKind">) {
  const scopeId = required(input.scopeId, "Audit security scope", 255);
  if (input.scopeKind === "identity" && !isRateLoopPrincipalId(scopeId)) {
    throw new TokenlessServiceError("Audit identity scope is invalid.", 400, "invalid_audit_event");
  }
  if (input.scopeKind === "system" && !/^[a-z0-9][a-z0-9:_-]{1,159}$/.test(scopeId)) {
    throw new TokenlessServiceError("Audit system scope is invalid.", 400, "invalid_audit_event");
  }
  return { scopeId, scopeKind: input.scopeKind };
}

export async function appendAuditEvent(input: AuditEventInput) {
  const occurredAt = input.occurredAt ?? new Date();
  const workspaceId = required(input.workspaceId, "Audit workspace", 160);
  const idempotencyKey = optionalIdempotencyKey(input.idempotencyKey);
  const eventId = idempotencyKey
    ? `audit_${createHash("sha256").update(`${workspaceId}\n${idempotencyKey}`).digest("hex").slice(0, 32)}`
    : `audit_${randomUUID().replaceAll("-", "")}`;
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
    requestCorrelation: optionalCorrelation(input.requestCorrelation),
    result: input.result,
    targetId: required(input.targetId, "Audit target", 255),
    targetKind: required(input.targetKind, "Audit target kind", 120),
    workspaceId,
  } as const;
  const metadataJson = auditMetadataJson(normalized.metadata);
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
    if (idempotencyKey) {
      const existingResult = await client.query(
        `SELECT event_id,workspace_id,sequence,previous_digest,event_digest,home_region,actor_kind,actor_reference,
                assurance_method,action,target_kind,target_id,purpose,reason,request_correlation,result,
                metadata_json,occurred_at
         FROM tokenless_audit_events WHERE event_id=$1`,
        [eventId],
      );
      const existing = existingResult.rows[0] as QueryRow | undefined;
      if (existing) {
        const existingOccurredAt = new Date(String(existing.occurred_at));
        const matches =
          rowString(existing, "workspace_id") === normalized.workspaceId &&
          rowString(existing, "home_region") === normalized.homeRegion &&
          rowString(existing, "actor_kind") === normalized.actorKind &&
          rowString(existing, "actor_reference") === normalized.actorReference &&
          rowString(existing, "assurance_method") === normalized.assuranceMethod &&
          rowString(existing, "action") === normalized.action &&
          rowString(existing, "target_kind") === normalized.targetKind &&
          rowString(existing, "target_id") === normalized.targetId &&
          rowString(existing, "purpose") === normalized.purpose &&
          rowString(existing, "reason") === normalized.reason &&
          rowString(existing, "request_correlation") === normalized.requestCorrelation &&
          rowString(existing, "result") === normalized.result &&
          rowString(existing, "metadata_json") === metadataJson &&
          Number.isFinite(existingOccurredAt.getTime()) &&
          existingOccurredAt.toISOString() === normalized.occurredAt;
        if (!matches) {
          throw new TokenlessServiceError(
            "Audit idempotency key was already used for a different event.",
            409,
            "audit_idempotency_conflict",
          );
        }
        await client.query("COMMIT");
        return {
          eventDigest: rowString(existing, "event_digest")!,
          eventId,
          previousDigest: rowString(existing, "previous_digest")!,
          sequence: Number(existing.sequence),
        };
      }
    }
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

/**
 * Records authentication and platform-security events that happen before a
 * workspace exists. Separate tables preserve the workspace foreign-key and
 * tenant-export boundary instead of inventing a synthetic workspace.
 */
export async function appendSecurityAuditEvent(input: SecurityAuditEventInput, transactionClient?: PoolClient) {
  const occurredAt = input.occurredAt ?? new Date();
  const eventId = `saudit_${randomUUID().replaceAll("-", "")}`;
  const scope = securityScope(input);
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
    requestCorrelation: optionalCorrelation(input.requestCorrelation),
    result: input.result,
    ...scope,
    targetId: required(input.targetId, "Audit target", 255),
    targetKind: required(input.targetKind, "Audit target kind", 120),
  } as const;
  const metadataJson = auditMetadataJson(normalized.metadata);
  const client = transactionClient ?? (await dbPool.connect());
  const ownsTransaction = transactionClient === undefined;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_security_audit_heads
       (scope_kind, scope_id, last_sequence, last_digest, updated_at)
       VALUES ($1, $2, 0, $3, $4) ON CONFLICT (scope_kind, scope_id) DO NOTHING`,
      [normalized.scopeKind, normalized.scopeId, GENESIS_DIGEST, occurredAt],
    );
    const headResult = await client.query(
      `SELECT last_sequence, last_digest FROM tokenless_security_audit_heads
       WHERE scope_kind = $1 AND scope_id = $2 FOR UPDATE`,
      [normalized.scopeKind, normalized.scopeId],
    );
    const head = headResult.rows[0] as QueryRow | undefined;
    const sequence = Number(head?.last_sequence ?? 0) + 1;
    const previousDigest = rowString(head, "last_digest") ?? GENESIS_DIGEST;
    const payloadJson = canonicalJson({ ...normalized, metadata: JSON.parse(metadataJson), sequence });
    const eventDigest = digest(previousDigest, payloadJson);
    await client.query(
      `INSERT INTO tokenless_security_audit_events
       (event_id, scope_kind, scope_id, sequence, previous_digest, event_digest, home_region, actor_kind,
        actor_reference, assurance_method, action, target_kind, target_id, purpose, reason,
        request_correlation, result, metadata_json, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'eu', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        eventId,
        normalized.scopeKind,
        normalized.scopeId,
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
      `UPDATE tokenless_security_audit_heads SET last_sequence = $1, last_digest = $2, updated_at = $3
       WHERE scope_kind = $4 AND scope_id = $5`,
      [sequence, eventDigest, occurredAt, normalized.scopeKind, normalized.scopeId],
    );
    if (ownsTransaction) await client.query("COMMIT");
    return { eventDigest, eventId, previousDigest, sequence };
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

function verifyWorkspaceAuditRows(
  workspaceId: string,
  rows: readonly Record<string, unknown>[],
  head: QueryRow | undefined,
) {
  let previousDigest = GENESIS_DIGEST;
  let expectedSequence = 1;
  for (const value of rows) {
    const row = value as QueryRow;
    if (Number(row.sequence) !== expectedSequence || rowString(row, "previous_digest") !== previousDigest) {
      return { eventCount: expectedSequence - 1, valid: false } as const;
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
      return { eventCount: expectedSequence - 1, valid: false } as const;
    }
    previousDigest = expectedDigest;
    expectedSequence += 1;
  }
  const eventCount = expectedSequence - 1;
  if (
    (head && (Number(head.last_sequence) !== eventCount || rowString(head, "last_digest") !== previousDigest)) ||
    (!head && eventCount > 0)
  ) {
    return { eventCount, valid: false } as const;
  }
  return { eventCount, headDigest: previousDigest, valid: true } as const;
}

export async function verifyWorkspaceAuditChain(workspaceId: string) {
  const [result, headResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT event_id, sequence, previous_digest, event_digest, home_region, actor_kind, actor_reference,
                   assurance_method, action, target_kind, target_id, purpose, reason, request_correlation,
                   result, metadata_json, occurred_at
            FROM tokenless_audit_events WHERE workspace_id = ? ORDER BY sequence ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT last_sequence, last_digest FROM tokenless_audit_heads WHERE workspace_id = ? LIMIT 1",
      args: [workspaceId],
    }),
  ]);
  return verifyWorkspaceAuditRows(workspaceId, result.rows as Record<string, unknown>[], headResult.rows[0]);
}

export async function verifySecurityAuditChain(input: Pick<SecurityAuditEventInput, "scopeId" | "scopeKind">) {
  const scope = securityScope(input);
  const [result, headResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT event_id, sequence, previous_digest, event_digest, home_region, actor_kind, actor_reference,
                   assurance_method, action, target_kind, target_id, purpose, reason, request_correlation,
                   result, metadata_json, occurred_at
            FROM tokenless_security_audit_events
            WHERE scope_kind = ? AND scope_id = ? ORDER BY sequence ASC`,
      args: [scope.scopeKind, scope.scopeId],
    }),
    dbClient.execute({
      sql: `SELECT last_sequence, last_digest FROM tokenless_security_audit_heads
            WHERE scope_kind = ? AND scope_id = ? LIMIT 1`,
      args: [scope.scopeKind, scope.scopeId],
    }),
  ]);
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
      scopeId: scope.scopeId,
      scopeKind: scope.scopeKind,
      sequence: expectedSequence,
      targetId: rowString(row, "target_id"),
      targetKind: rowString(row, "target_kind"),
    });
    const expectedDigest = digest(previousDigest, payloadJson);
    if (rowString(row, "event_digest") !== expectedDigest) {
      return { eventCount: expectedSequence - 1, valid: false };
    }
    previousDigest = expectedDigest;
    expectedSequence += 1;
  }
  const eventCount = expectedSequence - 1;
  const head = headResult.rows[0] as QueryRow | undefined;
  if (
    (head && (Number(head.last_sequence) !== eventCount || rowString(head, "last_digest") !== previousDigest)) ||
    (!head && eventCount > 0)
  ) {
    return { eventCount, valid: false };
  }
  return { eventCount, headDigest: previousDigest, valid: true };
}

export async function exportWorkspaceAudit(input: { accountAddress: string; workspaceId: string }) {
  let accountReference: string;
  try {
    accountReference = normalizeAccountSubject(input.accountAddress);
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
  const snapshot = await dbClient.execute({
    sql: `WITH audit_head AS (
            SELECT last_sequence, last_digest FROM tokenless_audit_heads WHERE workspace_id = ? LIMIT 1
          ), retention_policy AS (
            SELECT version, audit_retention_months, basis_json, effective_at
            FROM tokenless_workspace_evidence_retention_policies
            WHERE workspace_id = ? AND superseded_at IS NULL LIMIT 1
          )
          SELECT e.event_id, e.workspace_id, e.sequence, e.previous_digest, e.event_digest, e.home_region,
                 e.actor_kind, e.actor_reference, e.assurance_method, e.action, e.target_kind, e.target_id,
                 e.purpose, e.reason, e.request_correlation, e.result, e.metadata_json, e.occurred_at,
                 h.last_sequence AS head_last_sequence, h.last_digest AS head_last_digest,
                 p.version AS retention_policy_version, p.audit_retention_months,
                 p.basis_json AS retention_basis_json, p.effective_at AS retention_effective_at
          FROM retention_policy p
          LEFT JOIN audit_head h ON true
          LEFT JOIN tokenless_audit_events e ON e.workspace_id = ?
          ORDER BY e.sequence ASC`,
    args: [input.workspaceId, input.workspaceId, input.workspaceId],
  });
  const snapshotRow = snapshot.rows[0] as QueryRow | undefined;
  if (!snapshotRow || snapshotRow.retention_policy_version === null) {
    throw new TokenlessServiceError("The workspace retention policy is unavailable.", 500, "retention_unavailable");
  }
  const events = snapshot.rows.filter(row => row.event_id !== null && row.event_id !== undefined);
  const snapshotHead = snapshot.rows[0]
    ? {
        last_sequence: snapshot.rows[0].head_last_sequence,
        last_digest: snapshot.rows[0].head_last_digest,
      }
    : undefined;
  const integrity = verifyWorkspaceAuditRows(input.workspaceId, events as Record<string, unknown>[], snapshotHead);
  if (!integrity.valid) {
    throw new TokenlessServiceError("The workspace audit chain failed integrity verification.", 409, "audit_invalid");
  }
  const exportedEvents = events.map(event => {
    const exportedEvent = { ...event };
    delete exportedEvent.head_last_sequence;
    delete exportedEvent.head_last_digest;
    delete exportedEvent.retention_policy_version;
    delete exportedEvent.audit_retention_months;
    delete exportedEvent.retention_basis_json;
    delete exportedEvent.retention_effective_at;
    return exportedEvent;
  });
  const retentionBasis = JSON.parse(rowString(snapshotRow, "retention_basis_json") ?? "null") as unknown;
  const exported = {
    exportedAt: new Date().toISOString(),
    format: "rateloop-audit-v1",
    integrity,
    events: exportedEvents,
    retention: {
      policyVersion: Number(snapshotRow.retention_policy_version),
      auditRetentionMonths: Number(snapshotRow.audit_retention_months),
      minimumRetentionMonths: 6,
      basis: retentionBasis,
      effectiveAt: new Date(String(snapshotRow.retention_effective_at)).toISOString(),
    },
    workspaceId: input.workspaceId,
  };
  await appendAuditEvent({
    action: "audit.export",
    actorKind: isRateLoopPrincipalId(accountReference) ? "principal" : "account",
    actorReference: accountReference,
    assuranceMethod: "rateloop_session",
    metadata: { eventCount: exportedEvents.length, exportedHeadDigest: integrity.headDigest },
    purpose: "workspace_audit_export",
    reason: "authorized_administrator_export",
    result: "success",
    targetId: input.workspaceId,
    targetKind: "workspace_audit",
    workspaceId: input.workspaceId,
  });
  await enqueueAssuranceAttestation({
    workspaceId: input.workspaceId,
    kind: "audit_export_head",
    artifactDigest: integrity.headDigest!,
    artifactSchemaVersion: "rateloop-audit-v1",
    boundaryAt: new Date(exported.exportedAt),
  });
  return exported;
}
