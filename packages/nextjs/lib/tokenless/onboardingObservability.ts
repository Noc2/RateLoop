import "server-only";
import { isRateLoopPrincipalId, normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

const ACTIVE_CONNECTION_STATUSES = [
  "issued",
  "install_required",
  "authorizing",
  "approval_required",
  "testing",
  "action_required",
] as const;

export const ONBOARDING_FUNNEL_EVENTS = [
  "workspace_created",
  "connection_message_copied",
  "connection_claimed",
  "approval_required",
  "connected",
  "connection_failed",
  "agent_details_confirmed",
  "review_behavior_confirmed",
  "reviewer_invitation_issued",
  "reviewers_deferred",
  "workspace_setup_completed",
] as const;

export type OnboardingFunnelEventName = (typeof ONBOARDING_FUNNEL_EVENTS)[number];
export type OnboardingFailureCategory =
  | "authorization"
  | "cancelled"
  | "conflict"
  | "connection_test"
  | "expired"
  | "permission"
  | "unknown";

export type OnboardingFunnelEvent = Readonly<{
  attempt: number | null;
  elapsedMs: number;
  event: OnboardingFunnelEventName;
  failureCategory?: OnboardingFailureCategory;
  occurredAt: string;
}>;

export type ConnectionMessageCopiedPayload = Readonly<{
  event: "connection_message_copied";
}>;

export type WorkspaceSetupFunnelEventName = Extract<
  OnboardingFunnelEventName,
  | "agent_details_confirmed"
  | "review_behavior_confirmed"
  | "reviewer_invitation_issued"
  | "reviewers_deferred"
  | "workspace_setup_completed"
>;

const SETUP_EVENT_ACTIONS: Record<WorkspaceSetupFunnelEventName, string> = {
  agent_details_confirmed: "onboarding.agent_details_confirmed",
  review_behavior_confirmed: "onboarding.review_behavior_confirmed",
  reviewer_invitation_issued: "onboarding.reviewer_invitation_issued",
  reviewers_deferred: "onboarding.reviewers_deferred",
  workspace_setup_completed: "onboarding.workspace_setup_completed",
};

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowDate(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function elapsedMs(startedAt: Date, occurredAt: Date) {
  return Math.max(0, Math.round(occurredAt.getTime() - startedAt.getTime()));
}

export function parseConnectionMessageCopiedPayload(value: unknown): ConnectionMessageCopiedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError("Onboarding event body must be an object.", 400, "invalid_onboarding_event");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || body.event !== "connection_message_copied") {
    throw new TokenlessServiceError("Onboarding event contains unsupported fields.", 400, "invalid_onboarding_event");
  }
  return { event: "connection_message_copied" };
}

export function categorizeConnectionFailure(diagnosticCode: string | null, status: string): OnboardingFailureCategory {
  if (status === "cancelled") return "cancelled";
  const code = diagnosticCode?.toLowerCase() ?? "";
  if (status === "expired" || code.includes("expired") || code.includes("deadline")) return "expired";
  if (code.includes("conflict") || code.includes("mismatch") || code.includes("claimed_by_another")) {
    return "conflict";
  }
  if (code.includes("permission") || code.includes("forbidden") || code.includes("entitlement")) {
    return "permission";
  }
  if (code.includes("test") || code.includes("verify") || code.includes("connection")) return "connection_test";
  if (status === "rejected" || code.includes("auth") || code.includes("oauth") || code.includes("scope")) {
    return "authorization";
  }
  return "unknown";
}

export async function recordConnectionMessageCopied(input: {
  accountAddress: string;
  workspaceId: string;
  occurredAt?: Date;
}) {
  const actor = normalizeAccountSubject(input.accountAddress);
  const occurredAt = input.occurredAt ?? new Date();
  const active = await dbClient.execute({
    sql: `SELECT c.created_at
          FROM tokenless_agent_connection_intents c
          JOIN tokenless_workspace_members m ON m.workspace_id = c.workspace_id
          JOIN tokenless_workspaces w ON w.workspace_id = c.workspace_id
          WHERE c.workspace_id = ? AND m.account_address = ? AND m.role IN ('owner','admin')
            AND w.status = 'active'
            AND c.status IN (${ACTIVE_CONNECTION_STATUSES.map(() => "?").join(",")})
            AND c.hard_expires_at > ?
          ORDER BY c.created_at DESC LIMIT 1`,
    args: [input.workspaceId, actor, ...ACTIVE_CONNECTION_STATUSES, occurredAt],
  });
  if (!active.rowCount) {
    throw new TokenlessServiceError("Active connection not found.", 404, "connection_intent_not_found");
  }
  await appendAuditEvent({
    action: "onboarding.connection_message_copied",
    actorKind: "system",
    actorReference: "onboarding_observability",
    assuranceMethod: "authorized_browser_session",
    occurredAt,
    purpose: "product_onboarding",
    reason: "workspace_administrator_copied_connection_message",
    result: "success",
    targetId: input.workspaceId,
    targetKind: "workspace_onboarding",
    workspaceId: input.workspaceId,
  });
  return { event: "connection_message_copied" as const, recordedAt: occurredAt.toISOString() };
}

export async function recordWorkspaceSetupFunnelEvent(input: {
  accountAddress: string;
  workspaceId: string;
  event: WorkspaceSetupFunnelEventName;
  revision: number;
  occurredAt?: Date;
}) {
  const actor = normalizeAccountSubject(input.accountAddress);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new TokenlessServiceError("Setup revision is invalid.", 400, "invalid_onboarding_event");
  }
  const occurredAt = input.occurredAt ?? new Date();
  await appendAuditEvent({
    action: SETUP_EVENT_ACTIONS[input.event],
    actorKind: isRateLoopPrincipalId(actor) ? "principal" : "account",
    actorReference: actor,
    assuranceMethod: "authorized_browser_session",
    metadata: { revision: input.revision },
    occurredAt,
    purpose: "product_onboarding",
    reason: "workspace_agent_setup_progress",
    result: "success",
    targetId: input.workspaceId,
    targetKind: "workspace_onboarding",
    workspaceId: input.workspaceId,
  });
  return { event: input.event, recordedAt: occurredAt.toISOString() };
}

export async function loadWorkspaceOnboardingFunnel(workspaceId: string) {
  const workspace = await dbClient.execute({
    sql: "SELECT created_at FROM tokenless_workspaces WHERE workspace_id = ? LIMIT 1",
    args: [workspaceId],
  });
  const workspaceCreatedAt = rowDate(workspace.rows[0] as Row | undefined, "created_at");
  if (!workspaceCreatedAt) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  const [attemptResult, copiedResult, approvalResult, setupResult] = await Promise.all([
    dbClient.execute({
      sql: `SELECT intent_id,status,created_at,claimed_at,connected_at,cancelled_at,rejected_at,
                   last_diagnostic_code,last_diagnostic_at,hard_expires_at
            FROM tokenless_agent_connection_intents
            WHERE workspace_id = ? ORDER BY created_at ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT occurred_at FROM tokenless_audit_events
            WHERE workspace_id = ? AND action = 'onboarding.connection_message_copied'
            ORDER BY occurred_at ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT intent_id,created_at FROM tokenless_agent_connection_intent_events
            WHERE workspace_id = ? AND to_status = 'approval_required'
            ORDER BY created_at ASC`,
      args: [workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT action,occurred_at FROM tokenless_audit_events
            WHERE workspace_id = ? AND action IN (${Object.values(SETUP_EVENT_ACTIONS)
              .map(() => "?")
              .join(",")})
            ORDER BY occurred_at ASC`,
      args: [workspaceId, ...Object.values(SETUP_EVENT_ACTIONS)],
    }),
  ]);

  const attempts = (attemptResult.rows as Row[]).map((row, index) => ({
    attempt: index + 1,
    intentId: rowString(row, "intent_id")!,
    row,
    startedAt: rowDate(row, "created_at")!,
  }));
  const events: OnboardingFunnelEvent[] = [
    {
      attempt: null,
      elapsedMs: 0,
      event: "workspace_created",
      occurredAt: workspaceCreatedAt.toISOString(),
    },
  ];

  for (const copiedRow of copiedResult.rows as Row[]) {
    const occurredAt = rowDate(copiedRow, "occurred_at");
    if (!occurredAt) continue;
    const attempt = attempts.findLast(candidate => candidate.startedAt.getTime() <= occurredAt.getTime());
    events.push({
      attempt: attempt?.attempt ?? null,
      elapsedMs: elapsedMs(attempt?.startedAt ?? workspaceCreatedAt, occurredAt),
      event: "connection_message_copied",
      occurredAt: occurredAt.toISOString(),
    });
  }

  for (const attempt of attempts) {
    const claimedAt = rowDate(attempt.row, "claimed_at");
    if (claimedAt) {
      events.push({
        attempt: attempt.attempt,
        elapsedMs: elapsedMs(attempt.startedAt, claimedAt),
        event: "connection_claimed",
        occurredAt: claimedAt.toISOString(),
      });
    }
    const connectedAt = rowDate(attempt.row, "connected_at");
    if (connectedAt) {
      events.push({
        attempt: attempt.attempt,
        elapsedMs: elapsedMs(attempt.startedAt, connectedAt),
        event: "connected",
        occurredAt: connectedAt.toISOString(),
      });
    }
    const status = rowString(attempt.row, "status") ?? "unknown";
    const diagnosticCode = rowString(attempt.row, "last_diagnostic_code");
    if (status !== "connected" && (diagnosticCode || ["cancelled", "expired", "rejected"].includes(status))) {
      const failedAt =
        rowDate(attempt.row, "last_diagnostic_at") ??
        rowDate(attempt.row, "cancelled_at") ??
        rowDate(attempt.row, "rejected_at") ??
        rowDate(attempt.row, "hard_expires_at");
      if (failedAt) {
        events.push({
          attempt: attempt.attempt,
          elapsedMs: elapsedMs(attempt.startedAt, failedAt),
          event: "connection_failed",
          failureCategory: categorizeConnectionFailure(diagnosticCode, status),
          occurredAt: failedAt.toISOString(),
        });
      }
    }
  }

  const attemptNumbers = new Map(attempts.map(attempt => [attempt.intentId, attempt.attempt]));
  const attemptStarts = new Map(attempts.map(attempt => [attempt.intentId, attempt.startedAt]));
  for (const approvalRow of approvalResult.rows as Row[]) {
    const intentId = rowString(approvalRow, "intent_id");
    const occurredAt = rowDate(approvalRow, "created_at");
    const startedAt = intentId ? attemptStarts.get(intentId) : null;
    if (!intentId || !occurredAt || !startedAt) continue;
    events.push({
      attempt: attemptNumbers.get(intentId) ?? null,
      elapsedMs: elapsedMs(startedAt, occurredAt),
      event: "approval_required",
      occurredAt: occurredAt.toISOString(),
    });
  }

  const setupEventByAction = new Map(
    Object.entries(SETUP_EVENT_ACTIONS).map(([event, action]) => [action, event as WorkspaceSetupFunnelEventName]),
  );
  for (const setupRow of setupResult.rows as Row[]) {
    const event = setupEventByAction.get(rowString(setupRow, "action") ?? "");
    const occurredAt = rowDate(setupRow, "occurred_at");
    if (!event || !occurredAt) continue;
    events.push({
      attempt: null,
      elapsedMs: elapsedMs(workspaceCreatedAt, occurredAt),
      event,
      occurredAt: occurredAt.toISOString(),
    });
  }

  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return { events, workspaceCreatedAt: workspaceCreatedAt.toISOString() };
}
