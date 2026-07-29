import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { scheduledMaintenanceSignals } from "~~/lib/tokenless/scheduledMaintenanceSignals";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
type WorkerState = "degraded" | "healthy" | "stale" | "unavailable";

const STALE_RUNNING_MS = 10 * 60_000;
const STALE_COMPLETION_MS = 15 * 60_000;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parsedSummary(row: Row | undefined) {
  try {
    return object(JSON.parse(text(row, "summary_json") ?? "{}"));
  } catch {
    return {};
  }
}

function signals(row: Row | undefined) {
  return scheduledMaintenanceSignals(parsedSummary(row));
}

async function requireWorkspaceManager(accountAddress: string, workspaceId: string) {
  let principal: string;
  try {
    principal = normalizeAccountSubject(accountAddress);
  } catch {
    throw new TokenlessServiceError("Account is invalid.", 400, "invalid_account");
  }
  const access = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_workspace_members member
          JOIN tokenless_workspaces workspace ON workspace.workspace_id=member.workspace_id
          WHERE member.workspace_id=? AND member.account_address=?
            AND member.role IN ('owner','admin') AND workspace.status='active' LIMIT 1`,
    args: [workspaceId, principal],
  });
  if (access.rows.length !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

export async function getScheduledWorkerHealth(input: { accountAddress: string; workspaceId: string; now?: Date }) {
  await requireWorkspaceManager(input.accountAddress, input.workspaceId);
  const now = input.now ?? new Date();
  const result = await dbClient.execute({
    sql: `SELECT run_id,status,summary_json,started_at,completed_at
          FROM tokenless_scheduled_worker_runs
          ORDER BY started_at DESC,run_id DESC LIMIT 12`,
  });
  const runs = result.rows as Row[];
  const latest = runs[0];
  const latestCompleted = runs.find(row => date(row, "completed_at"));
  const latestStartedAt = date(latest, "started_at");
  const lastCompletedAt = date(latestCompleted, "completed_at");
  let state: WorkerState;
  if (!latest) {
    state = "unavailable";
  } else if (
    (text(latest, "status") === "running" &&
      (!latestStartedAt || now.getTime() - latestStartedAt.getTime() > STALE_RUNNING_MS)) ||
    !lastCompletedAt ||
    now.getTime() - lastCompletedAt.getTime() > STALE_COMPLETION_MS
  ) {
    state = "stale";
  } else if (["degraded", "failed"].includes(text(latestCompleted, "status") ?? "")) {
    state = "degraded";
  } else {
    state = "healthy";
  }
  return {
    state,
    currentRun: text(latest, "status") === "running" ? "running" : "idle",
    lastCompletedAt: lastCompletedAt?.toISOString() ?? null,
    signals: signals(latestCompleted).map(signal => ({ key: signal.key, label: signal.label })),
  };
}

export const __scheduledWorkerHealthTestUtils = { parsedSummary, signals };
