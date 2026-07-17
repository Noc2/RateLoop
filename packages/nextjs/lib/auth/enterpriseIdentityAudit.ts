import type { PoolClient } from "pg";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import { type AuditEventInput, appendAuditEvent } from "~~/lib/privacy/audit";

type IdentityAuditInput = AuditEventInput & { eventKey: string };
let activationHookForTests: ((eventKey: string) => Promise<void>) | null = null;

function retryAt(now: Date, attempt: number) {
  return new Date(now.getTime() + Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000));
}

function metadataJson(metadata: Record<string, unknown> | undefined) {
  return JSON.stringify(metadata ?? {});
}

export async function enqueueEnterpriseIdentityAudit(input: IdentityAuditInput, client?: PoolClient) {
  const occurredAt = input.occurredAt ?? new Date();
  const sql = `INSERT INTO tokenless_enterprise_identity_audit_outbox
    (event_key,workspace_id,action,actor_kind,actor_reference,assurance_method,target_kind,target_id,
     purpose,reason,result,metadata_json,delivery_state,attempt_count,next_attempt_at,last_error,occurred_at,delivered_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',0,$13,NULL,$13,NULL)
    ON CONFLICT (event_key) DO NOTHING`;
  const args = [
    input.eventKey,
    input.workspaceId,
    input.action,
    input.actorKind,
    input.actorReference,
    input.assuranceMethod,
    input.targetKind,
    input.targetId,
    input.purpose,
    input.reason,
    input.result,
    metadataJson(input.metadata),
    occurredAt,
  ];
  if (client) {
    await client.query(sql, args);
  } else {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_enterprise_identity_audit_outbox
        (event_key,workspace_id,action,actor_kind,actor_reference,assurance_method,target_kind,target_id,
         purpose,reason,result,metadata_json,delivery_state,attempt_count,next_attempt_at,last_error,occurred_at,delivered_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'pending',0,?,NULL,?,NULL)
        ON CONFLICT (event_key) DO NOTHING`,
      args: [...args, occurredAt],
    });
  }
}

export async function reserveEnterpriseIdentityAudit(input: IdentityAuditInput, client?: PoolClient) {
  const occurredAt = input.occurredAt ?? new Date();
  const sql = `INSERT INTO tokenless_enterprise_identity_audit_outbox
    (event_key,workspace_id,action,actor_kind,actor_reference,assurance_method,target_kind,target_id,
     purpose,reason,result,metadata_json,delivery_state,attempt_count,next_attempt_at,last_error,occurred_at,delivered_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reserved',0,$13,NULL,$13,NULL)
    ON CONFLICT (event_key) DO NOTHING`;
  const args = [
    input.eventKey,
    input.workspaceId,
    input.action,
    input.actorKind,
    input.actorReference,
    input.assuranceMethod,
    input.targetKind,
    input.targetId,
    input.purpose,
    input.reason,
    input.result,
    metadataJson(input.metadata),
    occurredAt,
  ];
  if (client) {
    await client.query(sql, args);
  } else {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_enterprise_identity_audit_outbox
        (event_key,workspace_id,action,actor_kind,actor_reference,assurance_method,target_kind,target_id,
         purpose,reason,result,metadata_json,delivery_state,attempt_count,next_attempt_at,last_error,occurred_at,delivered_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'reserved',0,?,NULL,?,NULL)
        ON CONFLICT (event_key) DO NOTHING`,
      args: [...args, occurredAt],
    });
  }
}

export async function activateEnterpriseIdentityAudit(eventKey: string, client?: PoolClient) {
  if (activationHookForTests) await activationHookForTests(eventKey);
  const sql = `UPDATE tokenless_enterprise_identity_audit_outbox
               SET delivery_state='pending',next_attempt_at=$1,last_error=NULL
               WHERE event_key=$2 AND delivery_state='reserved'`;
  const args = [new Date(), eventKey];
  if (client) {
    await client.query(sql, args);
  } else {
    await dbClient.execute({ sql: sql.replaceAll(/\$\d+/gu, "?"), args });
  }
}

export function __setEnterpriseIdentityAuditActivationHookForTests(hook: ((eventKey: string) => Promise<void>) | null) {
  activationHookForTests = hook;
}

export async function recordEnterpriseIdentityReservationFailure(eventKey: string, error: unknown) {
  await dbClient.execute({
    sql: `UPDATE tokenless_enterprise_identity_audit_outbox
          SET last_error=? WHERE event_key=? AND delivery_state='reserved'`,
    args: [error instanceof Error ? error.message.slice(0, 500) : "Provider mutation failed", eventKey],
  });
}

export async function enterpriseIdentityAuditState(eventKey: string) {
  const result = await dbClient.execute({
    sql: "SELECT delivery_state FROM tokenless_enterprise_identity_audit_outbox WHERE event_key=? LIMIT 1",
    args: [eventKey],
  });
  const state = result.rows[0]?.delivery_state;
  return state === "reserved" || state === "pending" || state === "delivered" ? state : null;
}

export async function enterpriseIdentityAuditReservation(eventKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT delivery_state,metadata_json FROM tokenless_enterprise_identity_audit_outbox
          WHERE event_key=? LIMIT 1`,
    args: [eventKey],
  });
  const row = result.rows[0];
  const state = row?.delivery_state;
  if (state !== "reserved" && state !== "pending" && state !== "delivered") return null;
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row?.metadata_json ?? "{}")) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return { metadata, state };
}

export async function reconcileEnterpriseIdentityAuditReservations(limit = 50) {
  const reservations = await dbClient.execute({
    sql: `SELECT event_key,workspace_id,action,target_id
          FROM tokenless_enterprise_identity_audit_outbox
          WHERE delivery_state='reserved'
            AND action IN ('identity.provider.deleted','identity.scim.token_revoked')
          ORDER BY occurred_at ASC,event_key ASC LIMIT ?`,
    args: [Math.min(Math.max(limit, 1), 100)],
  });
  let activated = 0;
  for (const row of reservations.rows) {
    const action = String(row.action);
    const table =
      action === "identity.provider.deleted"
        ? "tokenless_enterprise_identity_providers"
        : "tokenless_enterprise_scim_connections";
    const remaining = await dbClient.execute({
      sql: `SELECT 1 FROM ${table} WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
      args: [String(row.workspace_id), String(row.target_id)],
    });
    if (remaining.rowCount === 1) continue;
    await activateEnterpriseIdentityAudit(String(row.event_key));
    activated += 1;
  }
  return { activated, inspected: reservations.rowCount };
}

export async function drainEnterpriseIdentityAuditOutbox(now = new Date(), limit = 50) {
  const due = await dbClient.execute({
    sql: `SELECT event_key,workspace_id,action,actor_kind,actor_reference,assurance_method,target_kind,target_id,
                 purpose,reason,result,metadata_json,attempt_count,occurred_at
          FROM tokenless_enterprise_identity_audit_outbox
          WHERE delivery_state='pending' AND next_attempt_at <= ?
          ORDER BY occurred_at ASC,event_key ASC LIMIT ?`,
    args: [now, Math.min(Math.max(limit, 1), 100)],
  });
  let delivered = 0;
  let retry = 0;
  for (const value of due.rows) {
    const row = value as Record<string, unknown>;
    const eventKey = String(row.event_key);
    const lock = await dbPool.connect();
    try {
      const claimed = await lock.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [
        `enterprise-identity-audit:${eventKey}`,
      ]);
      if (claimed.rows[0]?.locked !== true) continue;
      const current = await dbClient.execute({
        sql: "SELECT delivery_state FROM tokenless_enterprise_identity_audit_outbox WHERE event_key=?",
        args: [eventKey],
      });
      if (String(current.rows[0]?.delivery_state) !== "pending") continue;
      const attempt = Number(row.attempt_count ?? 0) + 1;
      try {
        await appendAuditEvent({
          action: String(row.action),
          actorKind: String(row.actor_kind) as AuditEventInput["actorKind"],
          actorReference: String(row.actor_reference),
          assuranceMethod: String(row.assurance_method),
          idempotencyKey: eventKey,
          metadata: JSON.parse(String(row.metadata_json ?? "{}")) as Record<string, unknown>,
          occurredAt: new Date(String(row.occurred_at)),
          purpose: String(row.purpose),
          reason: String(row.reason),
          result: String(row.result) as AuditEventInput["result"],
          targetId: String(row.target_id),
          targetKind: String(row.target_kind),
          workspaceId: String(row.workspace_id),
        });
        await dbClient.execute({
          sql: `UPDATE tokenless_enterprise_identity_audit_outbox
                SET delivery_state='delivered',attempt_count=?,last_error=NULL,delivered_at=?
                WHERE event_key=? AND delivery_state='pending'`,
          args: [attempt, now, eventKey],
        });
        delivered += 1;
      } catch (error) {
        await dbClient.execute({
          sql: `UPDATE tokenless_enterprise_identity_audit_outbox
                SET attempt_count=?,next_attempt_at=?,last_error=?
                WHERE event_key=? AND delivery_state='pending'`,
          args: [
            attempt,
            retryAt(now, attempt),
            error instanceof Error ? error.message.slice(0, 500) : "Audit delivery failed",
            eventKey,
          ],
        });
        retry += 1;
      }
    } finally {
      await lock
        .query("SELECT pg_advisory_unlock(hashtext($1))", [`enterprise-identity-audit:${eventKey}`])
        .catch(() => undefined);
      lock.release();
    }
  }
  return { delivered, retry };
}
