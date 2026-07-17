import { createHash } from "node:crypto";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;

/**
 * Per-workspace oversight alert configuration. Selected events always land in
 * the in-app notification surface for owners and admins; email delivery stays
 * per-person opt-in through the verified notification-email machinery, and
 * browser notifications additionally require an explicit permission grant.
 */
export type WorkspaceAlertPreferences = {
  workspaceId: string;
  gateBlocked: boolean;
  reviewFailed: boolean;
  workspaceStop: boolean;
  coverageFloorHit: boolean;
  disagreementSpikeBps: number | null;
  browserEnabled: boolean;
};

export const DEFAULT_WORKSPACE_ALERT_PREFERENCES: Omit<WorkspaceAlertPreferences, "workspaceId"> = {
  gateBlocked: true,
  reviewFailed: true,
  workspaceStop: true,
  coverageFloorHit: true,
  disagreementSpikeBps: 2_500,
  browserEnabled: false,
};

export const OVERSIGHT_ALERT_SOURCE_TYPES = [
  "oversight.gate_blocked",
  "oversight.review_failed",
  "oversight.review_expired",
  "oversight.workspace_stopped",
  "oversight.disagreement_spike",
  "oversight.coverage_floor_hit",
] as const;

export type OversightAlertSourceType = (typeof OVERSIGHT_ALERT_SOURCE_TYPES)[number];

const MINIMUM_SPIKE_COMPARABLE_SAMPLE = 10;
const SPIKE_WINDOW_MS = 30 * 86_400_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const STAGE_RATE_BPS: Record<string, number> = {
  calibrating: 10_000,
  high_coverage: 5_000,
  medium_coverage: 2_500,
  monitoring: 1_000,
};

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bool(row: Row | undefined, key: string, fallback: boolean) {
  return typeof row?.[key] === "boolean" ? Boolean(row[key]) : fallback;
}

function bounded(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Oversight alert limit is invalid.");
  return Math.min(value, MAX_LIMIT);
}

function invalidPreferences(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_alert_preferences");
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
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
            AND m.role IN ('owner','admin') AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, actor],
  });
  if (!result.rowCount) throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  return actor;
}

function preferencesFromRow(workspaceId: string, row: Row | undefined): WorkspaceAlertPreferences {
  const spike = row?.disagreement_spike_bps;
  return {
    workspaceId,
    gateBlocked: bool(row, "gate_blocked", DEFAULT_WORKSPACE_ALERT_PREFERENCES.gateBlocked),
    reviewFailed: bool(row, "review_failed", DEFAULT_WORKSPACE_ALERT_PREFERENCES.reviewFailed),
    workspaceStop: bool(row, "workspace_stop", DEFAULT_WORKSPACE_ALERT_PREFERENCES.workspaceStop),
    coverageFloorHit: bool(row, "coverage_floor_hit", DEFAULT_WORKSPACE_ALERT_PREFERENCES.coverageFloorHit),
    disagreementSpikeBps: row
      ? spike === null || spike === undefined
        ? null
        : Number(spike)
      : DEFAULT_WORKSPACE_ALERT_PREFERENCES.disagreementSpikeBps,
    browserEnabled: bool(row, "browser_enabled", DEFAULT_WORKSPACE_ALERT_PREFERENCES.browserEnabled),
  };
}

export async function getWorkspaceAlertPreferences(input: {
  accountAddress: string;
  workspaceId: string;
}): Promise<WorkspaceAlertPreferences> {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: "SELECT * FROM tokenless_workspace_alert_preferences WHERE workspace_id = ? LIMIT 1",
    args: [input.workspaceId],
  });
  return preferencesFromRow(input.workspaceId, result.rows[0] as Row | undefined);
}

export function normalizeWorkspaceAlertPreferences(value: unknown): Omit<WorkspaceAlertPreferences, "workspaceId"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidPreferences("Alert preferences must be an object.");
  }
  const source = value as Record<string, unknown>;
  const allowed = [
    "gateBlocked",
    "reviewFailed",
    "workspaceStop",
    "coverageFloorHit",
    "disagreementSpikeBps",
    "browserEnabled",
  ];
  if (Object.keys(source).some(key => !allowed.includes(key))) {
    invalidPreferences("Alert preferences contain an unsupported field.");
  }
  for (const key of ["gateBlocked", "reviewFailed", "workspaceStop", "coverageFloorHit", "browserEnabled"]) {
    if (typeof source[key] !== "boolean") invalidPreferences(`${key} must be a boolean.`);
  }
  const spike = source.disagreementSpikeBps;
  if (spike !== null && (!Number.isSafeInteger(spike) || Number(spike) < 1 || Number(spike) > 10_000)) {
    invalidPreferences("disagreementSpikeBps must be null or an integer between 1 and 10000 basis points.");
  }
  return {
    gateBlocked: Boolean(source.gateBlocked),
    reviewFailed: Boolean(source.reviewFailed),
    workspaceStop: Boolean(source.workspaceStop),
    coverageFloorHit: Boolean(source.coverageFloorHit),
    disagreementSpikeBps: spike === null ? null : Number(spike),
    browserEnabled: Boolean(source.browserEnabled),
  };
}

export async function updateWorkspaceAlertPreferences(input: {
  accountAddress: string;
  workspaceId: string;
  preferences: unknown;
  now?: Date;
}): Promise<WorkspaceAlertPreferences> {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const preferences = normalizeWorkspaceAlertPreferences(input.preferences);
  const now = input.now ?? new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_alert_preferences
          (workspace_id, gate_blocked, review_failed, workspace_stop, coverage_floor_hit,
           disagreement_spike_bps, browser_enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (workspace_id) DO UPDATE SET
            gate_blocked = EXCLUDED.gate_blocked,
            review_failed = EXCLUDED.review_failed,
            workspace_stop = EXCLUDED.workspace_stop,
            coverage_floor_hit = EXCLUDED.coverage_floor_hit,
            disagreement_spike_bps = EXCLUDED.disagreement_spike_bps,
            browser_enabled = EXCLUDED.browser_enabled,
            updated_at = EXCLUDED.updated_at`,
    args: [
      input.workspaceId,
      preferences.gateBlocked,
      preferences.reviewFailed,
      preferences.workspaceStop,
      preferences.coverageFloorHit,
      preferences.disagreementSpikeBps,
      preferences.browserEnabled,
      now,
      now,
    ],
  });
  return { workspaceId: input.workspaceId, ...preferences };
}

type AlertCandidate = {
  principalAddress: string;
  sourceType: OversightAlertSourceType;
  sourceKey: string;
  title: string;
  body: string;
};

function notificationId(candidate: Pick<AlertCandidate, "principalAddress" | "sourceKey" | "sourceType">) {
  return `tn_${createHash("sha256")
    .update(`${candidate.principalAddress}:${candidate.sourceType}:${candidate.sourceKey}`)
    .digest("hex")
    .slice(0, 40)}`;
}

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function eventAlertContent(eventType: string, workspaceName: string) {
  switch (eventType) {
    case "ai.rateloop.gate.blocked":
      return {
        sourceType: "oversight.gate_blocked" as const,
        title: "Output gate blocked",
        body: `The output gate blocked an agent output in ${workspaceName}. The output stays held undelivered.`,
      };
    case "ai.rateloop.review.expired":
      return {
        sourceType: "oversight.review_expired" as const,
        title: "Review expired",
        body: `A human review in ${workspaceName} expired before completion.`,
      };
    default:
      return {
        sourceType: "oversight.review_failed" as const,
        title: "Review failed",
        body: `A human review in ${workspaceName} reached terminal failure.`,
      };
  }
}

async function loadEventAlertCandidates(limit: number): Promise<AlertCandidate[]> {
  const result = await dbClient.execute({
    sql: `SELECT b.principal_address, o.event_id AS source_key, o.event_type, w.name AS workspace_name
          FROM tokenless_assurance_event_outbox o
          JOIN tokenless_workspaces w ON w.workspace_id = o.workspace_id AND w.status = 'active'
          LEFT JOIN tokenless_workspace_alert_preferences p ON p.workspace_id = o.workspace_id
          JOIN tokenless_workspace_members m
            ON m.workspace_id = o.workspace_id AND m.role IN ('owner','admin')
          JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
          LEFT JOIN tokenless_notifications n
            ON n.principal_address = b.principal_address AND n.source_key = o.event_id
              AND n.source_type IN
                ('oversight.gate_blocked','oversight.review_failed','oversight.review_expired')
          WHERE n.notification_id IS NULL AND (
            (o.event_type = 'ai.rateloop.gate.blocked' AND COALESCE(p.gate_blocked, true))
            OR (
              o.event_type IN ('ai.rateloop.review.failed','ai.rateloop.review.expired')
              AND COALESCE(p.review_failed, true)
            )
          )
          ORDER BY o.created_at ASC, o.event_id ASC LIMIT ?`,
    args: [limit],
  });
  return (result.rows as Row[]).flatMap(row => {
    const principalAddress = text(row, "principal_address");
    const sourceKey = text(row, "source_key");
    const eventType = text(row, "event_type");
    if (!principalAddress || !sourceKey || !eventType) return [];
    return [
      { principalAddress, sourceKey, ...eventAlertContent(eventType, text(row, "workspace_name") ?? "your workspace") },
    ];
  });
}

async function loadWorkspaceStopCandidates(limit: number): Promise<AlertCandidate[]> {
  const result = await dbClient.execute({
    sql: `SELECT b.principal_address, s.workspace_id, s.engaged_at, w.name AS workspace_name
          FROM tokenless_workspace_stop_states s
          JOIN tokenless_workspaces w ON w.workspace_id = s.workspace_id AND w.status = 'active'
          LEFT JOIN tokenless_workspace_alert_preferences p ON p.workspace_id = s.workspace_id
          JOIN tokenless_workspace_members m
            ON m.workspace_id = s.workspace_id AND m.role IN ('owner','admin')
          JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
          WHERE s.status = 'engaged' AND COALESCE(p.workspace_stop, true)
          ORDER BY s.engaged_at ASC LIMIT ?`,
    args: [limit],
  });
  return (result.rows as Row[]).flatMap(row => {
    const principalAddress = text(row, "principal_address");
    const workspaceId = text(row, "workspace_id");
    const engagedAt = row.engaged_at instanceof Date ? row.engaged_at : new Date(String(row.engaged_at));
    if (!principalAddress || !workspaceId || !Number.isFinite(engagedAt.getTime())) return [];
    const workspaceName = text(row, "workspace_name") ?? "your workspace";
    return [
      {
        principalAddress,
        sourceType: "oversight.workspace_stopped" as const,
        sourceKey: `${workspaceId}:${engagedAt.toISOString()}`,
        title: "Workspace stop engaged",
        body: `The workspace stop is engaged for ${workspaceName}. New evaluations and releases stay blocked until it is released.`,
      },
    ];
  });
}

async function loadDisagreementSpikeCandidates(now: Date, limit: number): Promise<AlertCandidate[]> {
  const result = await dbClient.execute({
    sql: `SELECT b.principal_address, o.workspace_id, w.name AS workspace_name,
                 COALESCE(p.disagreement_spike_bps, 2500) AS threshold_bps,
                 SUM(CASE WHEN o.comparable AND o.agreement IN ('agree','disagree') THEN 1 ELSE 0 END) AS comparable,
                 SUM(CASE WHEN o.comparable AND o.agreement = 'disagree' THEN 1 ELSE 0 END) AS disagreements
          FROM tokenless_agent_evaluation_observations o
          JOIN tokenless_workspaces w ON w.workspace_id = o.workspace_id AND w.status = 'active'
          LEFT JOIN tokenless_workspace_alert_preferences p ON p.workspace_id = o.workspace_id
          JOIN tokenless_workspace_members m
            ON m.workspace_id = o.workspace_id AND m.role IN ('owner','admin')
          JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
          WHERE o.finalized_at >= ?
            AND (p.workspace_id IS NULL OR p.disagreement_spike_bps IS NOT NULL)
          GROUP BY b.principal_address, o.workspace_id, w.name, p.disagreement_spike_bps
          ORDER BY o.workspace_id ASC LIMIT ?`,
    args: [new Date(now.getTime() - SPIKE_WINDOW_MS), limit],
  });
  return (result.rows as Row[]).flatMap(row => {
    const principalAddress = text(row, "principal_address");
    const workspaceId = text(row, "workspace_id");
    const comparable = Number(row.comparable ?? 0);
    const disagreements = Number(row.disagreements ?? 0);
    const thresholdBps = Number(row.threshold_bps ?? 2_500);
    if (!principalAddress || !workspaceId || comparable < MINIMUM_SPIKE_COMPARABLE_SAMPLE) return [];
    const disagreementBps = Math.floor((disagreements * 10_000) / comparable);
    if (disagreementBps < thresholdBps) return [];
    const workspaceName = text(row, "workspace_name") ?? "your workspace";
    return [
      {
        principalAddress,
        sourceType: "oversight.disagreement_spike" as const,
        sourceKey: `${workspaceId}:${utcDay(now)}`,
        title: "Disagreement spike",
        body: `Human reviewers disagreed with agent outcomes on ${(disagreementBps / 100).toFixed(1)}% of comparable cases in ${workspaceName} over the last 30 days (threshold ${(thresholdBps / 100).toFixed(1)}%).`,
      },
    ];
  });
}

async function loadCoverageFloorCandidates(now: Date, limit: number): Promise<AlertCandidate[]> {
  const result = await dbClient.execute({
    sql: `SELECT b.principal_address, s.workspace_id, s.scope_id, s.workflow_key, s.stage,
                 rp.production_floor_bps, w.name AS workspace_name
          FROM tokenless_agent_evaluation_scopes s
          JOIN tokenless_agent_review_policies rp
            ON rp.workspace_id = s.workspace_id AND rp.policy_id = s.policy_id AND rp.version = s.policy_version
              AND rp.mode = 'adaptive'
          JOIN tokenless_workspaces w ON w.workspace_id = s.workspace_id AND w.status = 'active'
          LEFT JOIN tokenless_workspace_alert_preferences p ON p.workspace_id = s.workspace_id
          JOIN tokenless_workspace_members m
            ON m.workspace_id = s.workspace_id AND m.role IN ('owner','admin')
          JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
          WHERE COALESCE(p.coverage_floor_hit, true)
          ORDER BY s.scope_id ASC LIMIT ?`,
    args: [limit],
  });
  return (result.rows as Row[]).flatMap(row => {
    const principalAddress = text(row, "principal_address");
    const scopeId = text(row, "scope_id");
    const stage = text(row, "stage") ?? "";
    const floorBps = Number(row.production_floor_bps ?? 0);
    const stageRate = STAGE_RATE_BPS[stage];
    if (!principalAddress || !scopeId || stageRate === undefined || stageRate > floorBps) return [];
    const workspaceName = text(row, "workspace_name") ?? "your workspace";
    return [
      {
        principalAddress,
        sourceType: "oversight.coverage_floor_hit" as const,
        sourceKey: `${scopeId}:${utcDay(now)}`,
        title: "Coverage floor reached",
        body: `Adaptive sampling for workflow ${text(row, "workflow_key") ?? scopeId} in ${workspaceName} now runs at its configured production floor (${(floorBps / 100).toFixed(1)}%).`,
      },
    ];
  });
}

/**
 * Materializes oversight alerts into the standard notification table so they
 * reach the in-app inbox immediately and flow through the existing verified
 * email enqueue/deliver cycle for people who opted in. Only workspace owners
 * and admins receive oversight alerts; event selection follows the workspace
 * alert preferences (defaults: gate blocked, review failed/expired, workspace
 * stop, coverage floor, disagreement spike at 25%).
 */
export async function materializeOversightAlertNotifications(input: { limit?: number; now?: Date } = {}) {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit);
  const [events, stops, spikes, floors] = await Promise.all([
    loadEventAlertCandidates(limit),
    loadWorkspaceStopCandidates(limit),
    loadDisagreementSpikeCandidates(now, limit),
    loadCoverageFloorCandidates(now, limit),
  ]);
  const candidates = [...events, ...stops, ...spikes, ...floors].slice(0, limit);
  let inserted = 0;
  for (const candidate of candidates) {
    const existing = await dbClient.execute({
      sql: `SELECT 1 FROM tokenless_notifications
            WHERE principal_address = ? AND source_type = ? AND source_key = ? LIMIT 1`,
      args: [candidate.principalAddress, candidate.sourceType, candidate.sourceKey],
    });
    if (existing.rows.length > 0) continue;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_notifications
            (notification_id, principal_address, kind, title, body, href, preference_key,
             source_type, source_key, created_at)
            VALUES (?, ?, 'oversightAlerts', ?, ?, ?, 'oversightAlerts', ?, ?, ?)
            ON CONFLICT (principal_address, source_type, source_key) DO NOTHING`,
      args: [
        notificationId(candidate),
        candidate.principalAddress,
        candidate.title,
        candidate.body,
        "/agents?tab=evaluations",
        candidate.sourceType,
        candidate.sourceKey,
        now,
      ],
    });
    inserted += 1;
  }
  return { candidates: candidates.length, inserted };
}

export type OversightInboxNotification = {
  notificationId: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  sourceType: string | null;
  createdAt: string;
  readAt: string | null;
};

/** Per-person in-app notification inbox with an unread count. */
export async function listNotificationInbox(input: { accountAddress: string; limit?: number }) {
  let principal: string;
  try {
    principal = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [list, unread] = await Promise.all([
    dbClient.execute({
      sql: `SELECT notification_id, kind, title, body, href, source_type, created_at, read_at
            FROM tokenless_notifications WHERE principal_address = ?
            ORDER BY created_at DESC, notification_id DESC LIMIT ?`,
      args: [principal, limit],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS unread FROM tokenless_notifications WHERE principal_address = ? AND read_at IS NULL",
      args: [principal],
    }),
  ]);
  return {
    unreadCount: Number((unread.rows[0] as Row | undefined)?.unread ?? 0),
    notifications: (list.rows as Row[]).map(row => ({
      notificationId: text(row, "notification_id")!,
      kind: text(row, "kind")!,
      title: text(row, "title")!,
      body: text(row, "body")!,
      href: text(row, "href"),
      sourceType: text(row, "source_type"),
      createdAt: new Date(String(row.created_at)).toISOString(),
      readAt: row.read_at ? new Date(String(row.read_at)).toISOString() : null,
    })) satisfies OversightInboxNotification[],
  };
}

/** Marks the caller's notifications as read; without ids, marks everything. */
export async function markNotificationInboxRead(input: {
  accountAddress: string;
  notificationIds?: unknown;
  now?: Date;
}) {
  let principal: string;
  try {
    principal = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const now = input.now ?? new Date();
  if (input.notificationIds !== undefined) {
    if (
      !Array.isArray(input.notificationIds) ||
      input.notificationIds.length === 0 ||
      input.notificationIds.length > 100 ||
      input.notificationIds.some(value => typeof value !== "string" || !value.trim())
    ) {
      throw new TokenlessServiceError("notificationIds must be 1-100 identifiers.", 400, "invalid_notification_read");
    }
    const ids = input.notificationIds as string[];
    const result = await dbClient.execute({
      sql: `UPDATE tokenless_notifications SET read_at = ?
            WHERE principal_address = ? AND read_at IS NULL
              AND notification_id IN (${ids.map(() => "?").join(",")})`,
      args: [now, principal, ...ids],
    });
    return { marked: result.rowCount ?? 0 };
  }
  const result = await dbClient.execute({
    sql: "UPDATE tokenless_notifications SET read_at = ? WHERE principal_address = ? AND read_at IS NULL",
    args: [now, principal],
  });
  return { marked: result.rowCount ?? 0 };
}
