import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
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

function nestedNumber(source: Record<string, unknown>, path: string) {
  let value: unknown = source;
  for (const segment of path.split(".")) value = object(value)[segment];
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

const SIGNALS = [
  [
    "processorFailures",
    "Processor failures",
    (summary: Record<string, unknown>) => {
      const value = summary.processorFailures;
      return Array.isArray(value) ? value.length : 0;
    },
  ],
  ["deadWorkItems", "Dead work items", (summary: Record<string, unknown>) => nestedNumber(summary, "deadWorkItems")],
  ["work.retry", "Work retries", (summary: Record<string, unknown>) => nestedNumber(summary, "work.retry")],
  ["work.dead", "Dead work", (summary: Record<string, unknown>) => nestedNumber(summary, "work.dead")],
  [
    "notifications.retry",
    "Notification retries",
    (summary: Record<string, unknown>) => nestedNumber(summary, "notifications.retry"),
  ],
  [
    "notifications.parked",
    "Parked notifications",
    (summary: Record<string, unknown>) => nestedNumber(summary, "notifications.parked"),
  ],
  [
    "notifications.dead",
    "Dead notifications",
    (summary: Record<string, unknown>) => nestedNumber(summary, "notifications.dead"),
  ],
  ["webhooks.retry", "Webhook retries", (summary: Record<string, unknown>) => nestedNumber(summary, "webhooks.retry")],
  ["webhooks.dead", "Dead webhooks", (summary: Record<string, unknown>) => nestedNumber(summary, "webhooks.dead")],
  [
    "directPrivateReviewEvidence.retry",
    "Evidence retries",
    (summary: Record<string, unknown>) => nestedNumber(summary, "directPrivateReviewEvidence.retry"),
  ],
  [
    "directPrivateReviewEvidence.dead",
    "Dead evidence projections",
    (summary: Record<string, unknown>) => nestedNumber(summary, "directPrivateReviewEvidence.dead"),
  ],
] as const;

function signals(row: Row | undefined) {
  const summary = parsedSummary(row);
  return SIGNALS.flatMap(([key, label, read]) => {
    const count = read(summary);
    return count > 0 ? [{ key, label, count }] : [];
  });
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
    latestRunId: text(latest, "run_id"),
    signals: signals(latestCompleted),
    recent: {
      healthy: runs.filter(row => text(row, "status") === "healthy").length,
      degraded: runs.filter(row => text(row, "status") === "degraded").length,
      failed: runs.filter(row => text(row, "status") === "failed").length,
    },
  };
}

export const __scheduledWorkerHealthTestUtils = { nestedNumber, parsedSummary, signals };
