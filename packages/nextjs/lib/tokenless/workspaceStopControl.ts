import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { revokeWorkspaceHumanReviewContinuations } from "~~/lib/tokenless/humanReviewContinuations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

export type WorkspaceStopState = {
  workspaceId: string;
  status: "engaged" | "released";
  reason: string;
  engagedBy: string;
  engagedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
};

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

function stateFromRow(row: Row): WorkspaceStopState {
  const status = text(row, "status");
  if (status !== "engaged" && status !== "released") throw new Error("Stored workspace stop state is invalid.");
  return {
    workspaceId: text(row, "workspace_id")!,
    status,
    reason: text(row, "reason")!,
    engagedBy: text(row, "engaged_by")!,
    engagedAt: iso(row, "engaged_at")!,
    releasedBy: text(row, "released_by"),
    releasedAt: iso(row, "released_at"),
  };
}

async function requireWorkspaceRole(accountAddress: string, workspaceId: string, roles: readonly string[]) {
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
            AND m.role IN (${roles.map(() => "?").join(",")}) AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, actor, ...roles],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function normalizeReason(value: unknown) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError("A stop reason of 1-2000 characters is required.", 400, "invalid_workspace_stop");
  }
  const reason = value.trim();
  if (!reason || reason.length > 2_000) {
    throw new TokenlessServiceError("A stop reason of 1-2000 characters is required.", 400, "invalid_workspace_stop");
  }
  return reason;
}

async function appendStopAuditEvent(input: {
  workspaceId: string;
  actor: string;
  action: "workspace.stop_engaged" | "workspace.stop_released";
  reason: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}) {
  await appendAuditEvent({
    workspaceId: input.workspaceId,
    actorKind: isRateLoopPrincipalId(input.actor) ? "principal" : "account",
    actorReference: input.actor,
    assuranceMethod: "rateloop_session",
    action: input.action,
    targetKind: "workspace_stop_state",
    targetId: input.workspaceId,
    purpose: "workspace_oversight_stop",
    reason: input.reason,
    result: "success",
    metadata: input.metadata,
    occurredAt: input.occurredAt,
  });
}

/**
 * One audited action that halts workspace-wide agent activity:
 * - records the engaged stop state (who, why, when),
 * - revokes every unrevoked automatic publishing grant (the per-agent
 *   kill-switch primitive), and
 * - revokes every active human-review continuation.
 * While engaged, `evaluate_review_requirement` and review-triggered release
 * paths yield the existing `blocked` outcome with reason `workspace_stopped`.
 * Releasing the stop re-enables nothing automatically: each agent resumes
 * only when a manager grants it a fresh publishing grant.
 */
export async function engageWorkspaceStop(input: {
  accountAddress: string;
  workspaceId: string;
  reason: unknown;
  now?: Date;
}): Promise<{ state: WorkspaceStopState; replayed: boolean }> {
  const actor = await requireWorkspaceRole(input.accountAddress, input.workspaceId, ["owner", "admin"]);
  const reason = normalizeReason(input.reason);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  let outcome: { state: WorkspaceStopState; revokedGrants: number; revokedContinuations: number } | null = null;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT * FROM tokenless_workspace_stop_states WHERE workspace_id = $1 FOR UPDATE",
      [input.workspaceId],
    );
    const current = existing.rows[0] as Row | undefined;
    if (current && text(current, "status") === "engaged") {
      await client.query("COMMIT");
      return { state: stateFromRow(current), replayed: true };
    }
    const upserted = await client.query(
      `INSERT INTO tokenless_workspace_stop_states
       (workspace_id, status, reason, engaged_by, engaged_at, released_by, released_at, updated_at)
       VALUES ($1, 'engaged', $2, $3, $4, NULL, NULL, $4)
       ON CONFLICT (workspace_id) DO UPDATE SET
         status = 'engaged', reason = EXCLUDED.reason, engaged_by = EXCLUDED.engaged_by,
         engaged_at = EXCLUDED.engaged_at, released_by = NULL, released_at = NULL,
         updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [input.workspaceId, reason, actor, now],
    );
    const grants = await client.query(
      `UPDATE tokenless_agent_publishing_policies
       SET enabled = false, revoked_at = $2, updated_at = $2
       WHERE workspace_id = $1 AND revoked_at IS NULL
       RETURNING policy_id`,
      [input.workspaceId, now],
    );
    const revokedContinuations = await revokeWorkspaceHumanReviewContinuations(client, {
      workspaceId: input.workspaceId,
      reasonCode: "workspace_stop_engaged",
      now,
    });
    await client.query("COMMIT");
    outcome = {
      state: stateFromRow(upserted.rows[0] as Row),
      revokedGrants: grants.rows.length,
      revokedContinuations,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await appendStopAuditEvent({
    workspaceId: input.workspaceId,
    actor,
    action: "workspace.stop_engaged",
    reason: "workspace_manager_engaged_stop",
    metadata: {
      stopReason: reason,
      revokedAutomaticGrantCount: outcome.revokedGrants,
      revokedContinuationCount: outcome.revokedContinuations,
    },
    occurredAt: now,
  });
  return { state: outcome.state, replayed: false };
}

/**
 * Releases the workspace stop. Deliberately re-enables nothing: publishing
 * grants and continuations stay revoked, so every agent stays halted until a
 * manager re-grants it individually.
 */
export async function releaseWorkspaceStop(input: {
  accountAddress: string;
  workspaceId: string;
  now?: Date;
}): Promise<{ state: WorkspaceStopState | null; replayed: boolean }> {
  const actor = await requireWorkspaceRole(input.accountAddress, input.workspaceId, ["owner", "admin"]);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_workspace_stop_states
          SET status = 'released', released_by = ?, released_at = ?, updated_at = ?
          WHERE workspace_id = ? AND status = 'engaged'
          RETURNING *`,
    args: [actor, now, now, input.workspaceId],
  });
  if (!result.rowCount) {
    const current = await dbClient.execute({
      sql: "SELECT * FROM tokenless_workspace_stop_states WHERE workspace_id = ? LIMIT 1",
      args: [input.workspaceId],
    });
    return { state: current.rows[0] ? stateFromRow(current.rows[0] as Row) : null, replayed: true };
  }
  await appendStopAuditEvent({
    workspaceId: input.workspaceId,
    actor,
    action: "workspace.stop_released",
    reason: "workspace_manager_released_stop",
    metadata: { resumesAgentsAutomatically: false },
    occurredAt: now,
  });
  return { state: stateFromRow(result.rows[0] as Row), replayed: false };
}

export async function getWorkspaceStopState(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceStopState | null> {
  await requireWorkspaceRole(input.accountAddress, input.workspaceId, ["owner", "admin", "member", "billing"]);
  const result = await dbClient.execute({
    sql: "SELECT * FROM tokenless_workspace_stop_states WHERE workspace_id = ? LIMIT 1",
    args: [input.workspaceId],
  });
  return result.rows[0] ? stateFromRow(result.rows[0] as Row) : null;
}

/** Unauthenticated preflight used inside evaluation and release paths. */
export async function isWorkspaceStopEngaged(workspaceId: string): Promise<boolean> {
  const result = await dbClient.execute({
    sql: "SELECT 1 FROM tokenless_workspace_stop_states WHERE workspace_id = ? AND status = 'engaged' LIMIT 1",
    args: [workspaceId],
  });
  return Boolean(result.rowCount);
}
