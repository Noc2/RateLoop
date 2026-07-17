import { createHash } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { sendTokenlessNotificationEmail } from "~~/lib/notifications/resend";
import { type TokenlessNotificationKey, buildTokenlessSignedUnsubscribeToken } from "~~/lib/notifications/tokenless";
import { materializeOversightAlertNotifications } from "~~/lib/tokenless/oversightAlerts";

type Row = Record<string, unknown>;

type LifecycleCandidate = {
  body: string;
  href: string;
  preferenceKey: TokenlessNotificationKey;
  principalAddress: string;
  sourceKey: string;
  sourceType: string;
  title: string;
};

type DeliveryState = "dead" | "delivered" | "retry" | "suppressed";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_ATTEMPTS = 8;
const STALE_CLAIM_MS = 10 * 60_000;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bounded(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Notification worker limit is invalid.");
  return Math.min(value, MAX_LIMIT);
}

function notificationId(candidate: Pick<LifecycleCandidate, "principalAddress" | "sourceKey" | "sourceType">) {
  return `tn_${digest(`${candidate.principalAddress}:${candidate.sourceType}:${candidate.sourceKey}`).slice(0, 40)}`;
}

function deliveryId(notification: string) {
  return `ted_${digest(notification).slice(0, 40)}`;
}

function retryAt(now: Date, attempt: number) {
  const delayMs = Math.min(30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7), 3_600_000);
  return new Date(now.getTime() + delayMs);
}

function interleave<T>(groups: T[][], limit: number) {
  const values: T[] = [];
  for (let index = 0; values.length < limit; index += 1) {
    let found = false;
    for (const group of groups) {
      const value = group[index];
      if (value !== undefined) {
        values.push(value);
        found = true;
        if (values.length === limit) break;
      }
    }
    if (!found) break;
  }
  return values;
}

function rowsToCandidates(rows: readonly Row[], template: Omit<LifecycleCandidate, "principalAddress" | "sourceKey">) {
  return rows.flatMap(row => {
    const principalAddress = rowString(row, "principal_address");
    const sourceKey = rowString(row, "source_key");
    return principalAddress && sourceKey ? [{ ...template, principalAddress, sourceKey }] : [];
  });
}

async function loadLifecycleCandidates(now: Date, limit: number) {
  const perSource = Math.max(1, Math.ceil(limit / 4));
  const [available, completed, payments, directResults, workspaceResults] = await Promise.all([
    dbClient.execute({
      sql: `SELECT b.principal_address, a.assignment_id AS source_key
            FROM tokenless_assurance_assignments a
            JOIN tokenless_browser_identities b
              ON b.principal_address = lower(a.reviewer_account_address)
            JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
            LEFT JOIN tokenless_private_group_memberships gm
              ON gm.group_id = a.private_group_id AND gm.principal_address = b.principal_address
                AND gm.status = 'active' AND gm.joined_at = a.private_group_membership_joined_at
                AND (gm.membership_expires_at IS NULL OR gm.membership_expires_at > ?)
            LEFT JOIN tokenless_private_groups g
              ON g.group_id = a.private_group_id AND g.workspace_id = a.workspace_id AND g.status = 'active'
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'assignment.available' AND n.source_key = a.assignment_id
            WHERE a.status = 'reserved' AND a.reservation_expires_at > ? AND n.notification_id IS NULL
              AND (
                a.private_group_id IS NULL
                OR (
                  gm.group_id IS NOT NULL AND g.group_id IS NOT NULL
                  AND sp.private_group_id = a.private_group_id
                  AND sp.private_group_policy_version = a.private_group_policy_version
                  AND sp.private_group_policy_hash = a.private_group_policy_hash
                )
              )
            ORDER BY a.created_at ASC LIMIT ?`,
      args: [now, now, perSource],
    }),
    dbClient.execute({
      sql: `SELECT b.principal_address, a.assignment_id AS source_key
            FROM tokenless_assurance_assignments a
            JOIN tokenless_browser_identities b
              ON b.principal_address = lower(a.reviewer_account_address)
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'assignment.completed' AND n.source_key = a.assignment_id
            WHERE a.status = 'completed' AND n.notification_id IS NULL
            ORDER BY a.updated_at ASC LIMIT ?`,
      args: [perSource],
    }),
    dbClient.execute({
      sql: `SELECT b.principal_address, e.entry_id AS source_key
            FROM tokenless_prepaid_ledger_entries e
            JOIN tokenless_workspace_members m ON m.workspace_id = e.workspace_id
            JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'payment.settled' AND n.source_key = e.entry_id
            WHERE e.settlement_status = 'settled' AND e.settled_at IS NOT NULL
              AND m.role IN ('owner', 'admin', 'billing') AND n.notification_id IS NULL
            ORDER BY e.settled_at ASC LIMIT ?`,
      args: [perSource],
    }),
    dbClient.execute({
      sql: `SELECT b.principal_address, o.operation_key AS source_key
            FROM tokenless_ask_ownership o
            JOIN tokenless_browser_identities b ON b.principal_address = lower(o.owner_account_address)
            JOIN tokenless_result_publications p ON p.operation_key = o.operation_key
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'ask.result' AND n.source_key = o.operation_key
            WHERE o.owner_account_address IS NOT NULL AND n.notification_id IS NULL
            GROUP BY b.principal_address, o.operation_key
            ORDER BY min(p.published_at) ASC LIMIT ?`,
      args: [perSource],
    }),
    dbClient.execute({
      sql: `SELECT b.principal_address, o.operation_key AS source_key
            FROM tokenless_ask_ownership o
            JOIN tokenless_workspaces w ON w.workspace_id = o.workspace_id AND w.status = 'active'
            JOIN tokenless_workspace_members m
              ON m.workspace_id = o.workspace_id AND m.role IN ('owner', 'admin')
            JOIN tokenless_browser_identities b ON b.principal_address = lower(m.account_address)
            JOIN tokenless_result_publications p ON p.operation_key = o.operation_key
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'ask.result' AND n.source_key = o.operation_key
            WHERE o.owner_account_address IS NULL AND n.notification_id IS NULL
            GROUP BY b.principal_address, o.operation_key
            ORDER BY min(p.published_at) ASC LIMIT ?`,
      args: [perSource],
    }),
  ]);

  const resultRows = new Map<string, Row>();
  for (const row of [...directResults.rows, ...workspaceResults.rows] as Row[]) {
    const key = `${rowString(row, "principal_address")}:${rowString(row, "source_key")}`;
    resultRows.set(key, row);
  }

  return interleave(
    [
      rowsToCandidates(available.rows as Row[], {
        body: "A human-assurance assignment is ready for review.",
        href: "/human?tab=discover",
        preferenceKey: "assignmentAvailable",
        sourceType: "assignment.available",
        title: "Assignment available",
      }),
      rowsToCandidates(completed.rows as Row[], {
        body: "Your human-assurance response was recorded.",
        href: "/human?tab=discover",
        preferenceKey: "assignmentCompleted",
        sourceType: "assignment.completed",
        title: "Response recorded",
      }),
      rowsToCandidates(payments.rows as Row[], {
        body: "A workspace balance update was settled.",
        href: "/agents?tab=overview",
        preferenceKey: "paymentUpdates",
        sourceType: "payment.settled",
        title: "Workspace funds updated",
      }),
      rowsToCandidates([...resultRows.values()], {
        body: "A human-assurance result is ready for review.",
        href: "/agents?tab=evaluations",
        preferenceKey: "askResults",
        sourceType: "ask.result",
        title: "Agent result ready",
      }),
    ],
    limit,
  );
}

async function insertLifecycleCandidates(candidates: readonly LifecycleCandidate[], now: Date) {
  let inserted = 0;
  for (const candidate of candidates) {
    const result = await dbClient.execute({
      sql: `INSERT INTO tokenless_notifications
            (notification_id, principal_address, kind, title, body, href, preference_key,
             source_type, source_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (principal_address, source_type, source_key) DO NOTHING`,
      args: [
        notificationId(candidate),
        candidate.principalAddress,
        candidate.preferenceKey,
        candidate.title,
        candidate.body,
        candidate.href,
        candidate.preferenceKey,
        candidate.sourceType,
        candidate.sourceKey,
        now,
      ],
    });
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function materializeTokenlessLifecycleNotifications(input: { limit?: number; now?: Date } = {}) {
  const now = input.now ?? new Date();
  const candidates = await loadLifecycleCandidates(now, bounded(input.limit));
  return { candidates: candidates.length, inserted: await insertLifecycleCandidates(candidates, now) };
}

export async function enqueueTokenlessNotificationEmails(input: { limit?: number; now?: Date } = {}) {
  const now = input.now ?? new Date();
  const notifications = await dbClient.execute({
    sql: `SELECT n.notification_id, n.principal_address, n.preference_key
          FROM tokenless_notifications n
          JOIN tokenless_notification_email_subscriptions s ON s.principal_address = n.principal_address
          LEFT JOIN tokenless_notification_email_deliveries d ON d.notification_id = n.notification_id
          WHERE d.delivery_id IS NULL AND s.verified_at IS NOT NULL AND s.unsubscribe_token_hash IS NOT NULL
            AND n.created_at >= s.verified_at
            AND n.preference_key IN (
              'assignmentAvailable', 'assignmentCompleted', 'paymentUpdates', 'askResults', 'accountSecurity',
              'oversightAlerts'
            )
          ORDER BY n.created_at ASC LIMIT ?`,
    args: [bounded(input.limit)],
  });
  let inserted = 0;
  for (const value of notifications.rows) {
    const row = value as Row;
    const notification = rowString(row, "notification_id")!;
    const result = await dbClient.execute({
      sql: `INSERT INTO tokenless_notification_email_deliveries
            (delivery_id, notification_id, principal_address, preference_key, state, attempt_count,
             next_attempt_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
            ON CONFLICT (notification_id) DO NOTHING`,
      args: [
        deliveryId(notification),
        notification,
        rowString(row, "principal_address"),
        rowString(row, "preference_key"),
        now,
        now,
        now,
      ],
    });
    inserted += result.rowCount ?? 0;
  }
  return { candidates: notifications.rows.length, inserted };
}

function preferenceEnabled(row: Row, key: string) {
  const column: Record<string, string> = {
    accountSecurity: "account_security",
    askResults: "ask_results",
    assignmentAvailable: "assignment_available",
    assignmentCompleted: "assignment_completed",
    oversightAlerts: "oversight_alerts",
    paymentUpdates: "payment_updates",
  };
  const selected = column[key];
  return Boolean(selected && row.verified_at && row.unsubscribe_token_hash && row.email && row[selected] === true);
}

function appOrigin(value: string) {
  const parsed = new URL(value);
  const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (
    (parsed.protocol !== "https:" && !isLocalHttp) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("Notification app origin is invalid.");
  }
  return parsed.origin;
}

function actionUrl(origin: string, href: string | null) {
  const safePath = href?.startsWith("/") && !href.startsWith("//") ? href : "/human?tab=settings";
  const target = new URL(safePath, origin);
  if (target.origin !== origin) throw new Error("Notification action URL must remain on the RateLoop origin.");
  return target.toString();
}

export async function deliverPendingTokenlessNotificationEmails(input: {
  appOrigin: string;
  limit?: number;
  now?: Date;
  send?: typeof sendTokenlessNotificationEmail;
  unsubscribeSecret?: string;
}) {
  const now = input.now ?? new Date();
  const origin = appOrigin(input.appOrigin);
  const limit = bounded(input.limit);
  await dbClient.execute({
    sql: `UPDATE tokenless_notification_email_deliveries
          SET state = 'retry', next_attempt_at = ?, last_error = 'stale email claim recovered', updated_at = ?
          WHERE state = 'delivering' AND updated_at <= ?`,
    args: [now, now, new Date(now.getTime() - STALE_CLAIM_MS)],
  });
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id, d.notification_id, d.principal_address, d.preference_key, d.attempt_count,
                 n.title, n.body, n.href,
                 s.email, s.verified_at, s.unsubscribe_token_hash,
                 s.assignment_available, s.assignment_completed, s.payment_updates, s.ask_results, s.account_security,
                 s.oversight_alerts
          FROM tokenless_notification_email_deliveries d
          JOIN tokenless_notifications n ON n.notification_id = d.notification_id
          LEFT JOIN tokenless_notification_email_subscriptions s ON s.principal_address = d.principal_address
          WHERE d.state IN ('pending', 'retry') AND d.next_attempt_at <= ?
          ORDER BY d.next_attempt_at ASC, d.created_at ASC LIMIT ?`,
    args: [now, limit],
  });
  const outcomes: Array<{ deliveryId: string; state: DeliveryState }> = [];
  for (const value of due.rows) {
    const row = value as Row;
    const id = rowString(row, "delivery_id")!;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_notification_email_deliveries SET state = 'delivering', updated_at = ?
            WHERE delivery_id = ? AND state IN ('pending', 'retry')`,
      args: [now, id],
    });
    if (claimed.rowCount !== 1) continue;
    const preferenceKey = rowString(row, "preference_key")!;
    if (!preferenceEnabled(row, preferenceKey)) {
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = 'suppressed', last_error = NULL, suppressed_at = ?, updated_at = ?
              WHERE delivery_id = ? AND state = 'delivering'`,
        args: [now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "suppressed" });
      continue;
    }

    const attempt = Number(row.attempt_count) + 1;
    try {
      const token = buildTokenlessSignedUnsubscribeToken(
        {
          principalAddress: rowString(row, "principal_address") ?? "",
          unsubscribeTokenHash: rowString(row, "unsubscribe_token_hash") ?? "",
        },
        input.unsubscribeSecret,
      );
      const unsubscribeUrl = new URL("/api/notifications/email/unsubscribe", origin);
      unsubscribeUrl.searchParams.set("token", token);
      const sent = await (input.send ?? sendTokenlessNotificationEmail)({
        actionUrl: actionUrl(origin, rowString(row, "href")),
        body: rowString(row, "body") ?? "A RateLoop update is ready.",
        email: rowString(row, "email")!,
        idempotencyKey: id,
        title: rowString(row, "title") ?? "RateLoop update",
        unsubscribeUrl: unsubscribeUrl.toString(),
      });
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = 'delivered', attempt_count = ?, provider_message_id = ?, last_error = NULL,
                  delivered_at = ?, updated_at = ? WHERE delivery_id = ? AND state = 'delivering'`,
        args: [attempt, sent.id, now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "delivered" });
    } catch (error) {
      const dead = attempt >= MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?, dead_at = ?, updated_at = ?
              WHERE delivery_id = ? AND state = 'delivering'`,
        args: [dead ? "dead" : "retry", attempt, retryAt(now, attempt), message, dead ? now : null, now, id],
      });
      const state = dead ? "dead" : "retry";
      outcomes.push({ deliveryId: id, state });
    }
  }
  return outcomes;
}

export async function runTokenlessNotificationCycle(input: { appOrigin: string; limit?: number; now?: Date }) {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit);
  const materialized = await materializeTokenlessLifecycleNotifications({ now, limit });
  const alerts = await materializeOversightAlertNotifications({ now, limit });
  const enqueued = await enqueueTokenlessNotificationEmails({ now, limit });
  const outcomes = await deliverPendingTokenlessNotificationEmails({ appOrigin: input.appOrigin, now, limit });
  return {
    dead: outcomes.filter(value => value.state === "dead").length,
    delivered: outcomes.filter(value => value.state === "delivered").length,
    enqueued: enqueued.inserted,
    materialized: materialized.inserted + alerts.inserted,
    retry: outcomes.filter(value => value.state === "retry").length,
    suppressed: outcomes.filter(value => value.state === "suppressed").length,
  };
}

export const __notificationDeliveryTestUtils = {
  actionUrl,
  insertLifecycleCandidates,
  notificationId,
  retryAt,
};
