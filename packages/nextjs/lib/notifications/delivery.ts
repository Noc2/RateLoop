import { createHash } from "node:crypto";
import "server-only";
import { dbClient } from "~~/lib/db";
import { isResendConfigured, sendTokenlessNotificationEmail } from "~~/lib/notifications/resend";
import {
  REVIEWER_LIFECYCLE_NOTIFICATION_HREFS,
  canonicalReviewerNotificationHref,
} from "~~/lib/notifications/reviewerInbox";
import { type TokenlessNotificationKey, buildTokenlessSignedUnsubscribeToken } from "~~/lib/notifications/tokenless";
import { deliverPendingWorkspaceReviewerInvitationEmails } from "~~/lib/notifications/workspaceReviewerInvitations";
import { maintenanceCancellationRequested } from "~~/lib/tokenless/maintenanceCancellation";
import { materializeOversightAlertNotifications } from "~~/lib/tokenless/oversightAlerts";
import { listRaterSettlementNotificationCandidates } from "~~/lib/tokenless/raterSettlementService";

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

type DeliveryState = "dead" | "delivered" | "parked" | "retry" | "suppressed";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_ATTEMPTS = 8;
const MAX_RECOVERIES = 6;
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

function recoveryAt(now: Date, recoveryCount: number) {
  const delayMs = Math.min(6 * 3_600_000 * 2 ** Math.min(Math.max(recoveryCount, 0), 5), 7 * 86_400_000);
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

/**
 * Fraction of the configured response window that may remain before a reviewer is
 * reminded. Expressed as a fraction rather than a fixed lead time because the
 * window itself now ranges from 20 minutes to 30 days: a fixed 24-hour warning
 * would never fire on a short window and would fire immediately on a long one.
 */
export const DEADLINE_REMINDER_REMAINING_FRACTION = 0.25;

/**
 * Kept in TypeScript rather than SQL on purpose. Computing "a quarter of the
 * window remains" in SQL needs interval arithmetic over two columns, which is the
 * kind of expression that behaves differently under pg-mem than under Postgres --
 * and this is a reminder, so a silent no-op would be invisible.
 */
function dueSoonRows(rows: readonly Row[], now: Date) {
  return rows.filter(row => {
    const deadline = row.response_deadline;
    const parsed = deadline instanceof Date ? deadline : new Date(String(deadline));
    const windowSeconds = Number(row.response_window_seconds);
    if (!Number.isFinite(parsed.getTime()) || !Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) return false;
    const remainingMs = parsed.getTime() - now.getTime();
    if (remainingMs <= 0) return false;
    return remainingMs <= windowSeconds * 1_000 * DEADLINE_REMINDER_REMAINING_FRACTION;
  });
}

function rowsToCandidates(
  rows: readonly Row[],
  template: Omit<LifecycleCandidate, "principalAddress" | "sourceKey" | "href"> & {
    href: string | ((row: Row) => string);
  },
) {
  return rows.flatMap(row => {
    const principalAddress = rowString(row, "principal_address");
    const sourceKey = rowString(row, "source_key");
    const href = typeof template.href === "function" ? template.href(row) : template.href;
    return principalAddress && sourceKey ? [{ ...template, href, principalAddress, sourceKey }] : [];
  });
}

function workspaceHref(row: Row, tab: "overview" | "evaluations") {
  const query = new URLSearchParams();
  const workspaceId = rowString(row, "workspace_id");
  if (workspaceId) query.set("workspace", workspaceId);
  const search = query.toString();
  return `/agents/${tab === "evaluations" ? "results" : "overview"}${search ? `?${search}` : ""}`;
}

/**
 * The live private unpaid lane's reviewer-eligibility predicate: active reviewer,
 * active principal, active group and membership, an unrevoked access grant that
 * covers this project and data classification through the response deadline, and
 * no notification of this kind already recorded.
 *
 * Shared by the `assignment.available` and `assignment.deadline_approaching`
 * queries so the two cannot drift. A reminder must be subject to exactly the
 * same eligibility as the original notice: there is no point chasing someone
 * whose grant has since expired, and no excuse for skipping someone who is still
 * able to answer.
 */
function privateUnpaidAssignmentCandidateSql(input: {
  sourceType: "assignment.available" | "assignment.deadline_approaching";
  selectColumns?: string;
  orderBy: string;
}) {
  const sourceType = input.sourceType;
  return `SELECT b.principal_address, a.assignment_id AS source_key${input.selectColumns ?? ""}
            FROM tokenless_private_unpaid_review_assignments a
            JOIN tokenless_private_unpaid_review_deliveries d ON d.delivery_id = a.delivery_id
            JOIN tokenless_agent_review_request_profiles rp
              ON rp.workspace_id = d.workspace_id AND rp.profile_id = d.request_profile_id
             AND rp.version = d.request_profile_version AND rp.profile_hash = d.request_profile_hash
            JOIN tokenless_browser_identities b
              ON b.principal_address = lower(a.reviewer_account_address)
            JOIN tokenless_private_groups g
              ON g.group_id = a.private_group_id AND g.workspace_id = a.workspace_id AND g.status = 'active'
            JOIN tokenless_workspace_reviewers reviewer
              ON reviewer.workspace_id = a.workspace_id
             AND reviewer.principal_address = a.reviewer_account_address
             AND reviewer.status = 'active'
            JOIN tokenless_principals principal
              ON principal.principal_id = reviewer.principal_address AND principal.status = 'active'
            JOIN tokenless_workspace_reviewer_access_grants access_grant
              ON access_grant.workspace_id = a.workspace_id
             AND access_grant.principal_address = a.reviewer_account_address
             AND access_grant.grant_id = a.workspace_reviewer_access_grant_id
             AND access_grant.grant_hash = a.workspace_reviewer_access_grant_hash
            LEFT JOIN tokenless_workspace_reviewer_access_grant_projects grant_project
              ON grant_project.workspace_id = a.workspace_id AND grant_project.grant_id = access_grant.grant_id
             AND grant_project.project_id = a.project_id
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
             AND n.source_type = '${sourceType}' AND n.source_key = a.assignment_id
            WHERE rp.compensation_mode = 'unpaid'
              AND (
                (a.status = 'reserved' AND a.reservation_expires_at > ?)
                OR (a.status = 'accepted' AND a.assignment_expires_at > ?)
              )
              AND a.response_deadline > ?
              AND (a.membership_expires_at IS NULL OR a.membership_expires_at >= a.response_deadline)
              AND access_grant.revoked_at IS NULL AND access_grant.valid_from <= ?
              AND (access_grant.valid_until IS NULL OR access_grant.valid_until >= a.response_deadline)
              AND (
                access_grant.project_scope = 'all'
                OR (access_grant.project_scope = 'selected' AND grant_project.project_id = a.project_id)
              )
              AND CASE rp.private_sensitivity
                    WHEN 'internal' THEN 1 WHEN 'confidential' THEN 2
                    WHEN 'restricted' THEN 3 WHEN 'regulated' THEN 4 ELSE 99
                  END
                  <= CASE access_grant.max_private_sensitivity
                    WHEN 'internal' THEN 1 WHEN 'confidential' THEN 2
                    WHEN 'restricted' THEN 3 WHEN 'regulated' THEN 4 ELSE 0
                  END
              AND n.notification_id IS NULL
            ORDER BY ${input.orderBy} LIMIT ?`;
}

async function loadLifecycleCandidates(
  now: Date,
  limit: number,
  settlementSource: { fetchImpl?: typeof fetch; ponderUrl?: string; signal?: AbortSignal } = {},
) {
  // Each source may fill the whole bounded batch. The final interleave still
  // enforces fairness without limiting assignment production to a fraction
  // of the worker capacity.
  const perSource = limit;
  const settlementCandidates = listRaterSettlementNotificationCandidates({
    fetchImpl: settlementSource.fetchImpl,
    limit: perSource,
    now,
    ponderUrl: settlementSource.ponderUrl,
    signal: settlementSource.signal,
  }).catch(error => {
    console.error("[tokenless-notifications] Settlement notices deferred.", error);
    return [];
  });
  const [available, directAvailable, deadlineReminders, completed, payments, directResults, workspaceResults] =
    await Promise.all([
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
            WHERE (
                (a.status = 'reserved' AND a.reservation_expires_at > ?)
                OR (a.status = 'accepted' AND a.assignment_expires_at > ?)
              )
              AND n.notification_id IS NULL
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
        args: [now, now, now, perSource],
      }),
      dbClient.execute({
        sql: privateUnpaidAssignmentCandidateSql({
          orderBy: "a.created_at ASC",
          sourceType: "assignment.available",
        }),
        args: [now, now, now, now, perSource],
      }),
      dbClient.execute({
        sql: privateUnpaidAssignmentCandidateSql({
          orderBy: "a.response_deadline ASC",
          selectColumns: ", a.response_deadline, rp.response_window_seconds",
          sourceType: "assignment.deadline_approaching",
        }),
        args: [now, now, now, now, perSource],
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
        sql: `SELECT b.principal_address, e.entry_id AS source_key, e.workspace_id
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
        sql: `SELECT b.principal_address, o.operation_key AS source_key, o.workspace_id
            FROM tokenless_ask_ownership o
            JOIN tokenless_browser_identities b ON b.principal_address = lower(o.owner_account_address)
            JOIN tokenless_result_publications p ON p.operation_key = o.operation_key
            LEFT JOIN tokenless_notifications n
              ON n.principal_address = b.principal_address
                AND n.source_type = 'ask.result' AND n.source_key = o.operation_key
            WHERE o.owner_account_address IS NOT NULL AND n.notification_id IS NULL
            GROUP BY b.principal_address, o.operation_key, o.workspace_id
            ORDER BY min(p.published_at) ASC LIMIT ?`,
        args: [perSource],
      }),
      dbClient.execute({
        sql: `SELECT b.principal_address, o.operation_key AS source_key, o.workspace_id
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
            GROUP BY b.principal_address, o.operation_key, o.workspace_id
            ORDER BY min(p.published_at) ASC LIMIT ?`,
        args: [perSource],
      }),
    ]);

  const resultRows = new Map<string, Row>();
  for (const row of [...directResults.rows, ...workspaceResults.rows] as Row[]) {
    const key = `${rowString(row, "principal_address")}:${rowString(row, "source_key")}`;
    resultRows.set(key, row);
  }
  const settlements = await settlementCandidates;
  const revealNotices = settlements.filter(candidate => candidate.kind === "reveal_required");
  const claimNotices = settlements.filter(candidate => candidate.kind === "claim_expiring");

  return interleave(
    [
      rowsToCandidates([...available.rows, ...directAvailable.rows] as Row[], {
        body: "A human-assurance assignment is ready for review.",
        href: REVIEWER_LIFECYCLE_NOTIFICATION_HREFS["assignment.available"],
        preferenceKey: "assignmentAvailable",
        sourceType: "assignment.available",
        title: "Assignment available",
      }),
      rowsToCandidates(dueSoonRows(deadlineReminders.rows as Row[], now), {
        body: "A review you accepted is close to its deadline.",
        href: REVIEWER_LIFECYCLE_NOTIFICATION_HREFS["assignment.deadline_approaching"],
        preferenceKey: "assignmentAvailable",
        sourceType: "assignment.deadline_approaching",
        title: "Review deadline approaching",
      }),
      rowsToCandidates(completed.rows as Row[], {
        body: "Your human-assurance response was recorded.",
        href: REVIEWER_LIFECYCLE_NOTIFICATION_HREFS["assignment.completed"],
        preferenceKey: "assignmentCompleted",
        sourceType: "assignment.completed",
        title: "Response recorded",
      }),
      rowsToCandidates(payments.rows as Row[], {
        body: "A workspace balance update was settled.",
        href: row => workspaceHref(row, "overview"),
        preferenceKey: "paymentUpdates",
        sourceType: "payment.settled",
        title: "Workspace funds updated",
      }),
      rowsToCandidates([...resultRows.values()], {
        body: "A human-assurance result is ready for review.",
        href: row => workspaceHref(row, "evaluations"),
        preferenceKey: "askResults",
        sourceType: "ask.result",
        title: "Agent result ready",
      }),
      revealNotices.map(candidate => ({
        body: "Your committed review needs a self-reveal before its recovery deadline.",
        href: REVIEWER_LIFECYCLE_NOTIFICATION_HREFS["settlement.reveal_required"],
        preferenceKey: "paymentUpdates" as const,
        principalAddress: candidate.principalAddress,
        sourceKey: candidate.sourceKey,
        sourceType: "settlement.reveal_required",
        title: "Review reveal required",
      })),
      claimNotices.map(candidate => ({
        body: "A review payment is nearing its claim deadline.",
        href: REVIEWER_LIFECYCLE_NOTIFICATION_HREFS["settlement.claim_expiring"],
        preferenceKey: "paymentUpdates" as const,
        principalAddress: candidate.principalAddress,
        sourceKey: candidate.sourceKey,
        sourceType: "settlement.claim_expiring",
        title: "Review payment expiring",
      })),
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

export async function materializeTokenlessLifecycleNotifications(
  input: { fetchImpl?: typeof fetch; limit?: number; now?: Date; ponderUrl?: string; signal?: AbortSignal } = {},
) {
  const now = input.now ?? new Date();
  const candidates = await loadLifecycleCandidates(now, bounded(input.limit), {
    fetchImpl: input.fetchImpl,
    ponderUrl: input.ponderUrl,
    signal: input.signal,
  });
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
  const safePath = href?.startsWith("/") && !href.startsWith("//") ? href : "/human/settings";
  const target = new URL(safePath, origin);
  if (target.origin !== origin) throw new Error("Notification action URL must remain on the RateLoop origin.");
  return target.toString();
}

function deliveryConfiguration(input: {
  appOrigin: string;
  send?: typeof sendTokenlessNotificationEmail;
  unsubscribeSecret?: string;
}) {
  let origin: string | null = null;
  let error: string | null = null;
  try {
    origin = appOrigin(input.appOrigin);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Notification app origin is invalid.";
  }
  const unsubscribeSecret = input.unsubscribeSecret ?? process.env.TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET;
  if (!unsubscribeSecret?.trim() || unsubscribeSecret.trim().length < 32) {
    error = "TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET must contain at least 32 characters.";
  } else if (!input.send && !isResendConfigured()) {
    error = "Resend is not configured";
  }
  return { error, origin };
}

/**
 * Only locally detectable deployment problems may park a delivery, because the unpark sweep
 * revives every parked row as soon as `deliveryConfiguration` reports no error. A provider
 * rejection is not detectable that way: the key is present, so the sweep revives the row, the
 * send fails again, and it re-parks - forever, without ever consuming an attempt. Provider
 * failures therefore take the normal bounded-retry path to the dead state.
 */
function isDeliveryConfigurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message === "Resend is not configured" ||
    message.startsWith("TOKENLESS_NOTIFICATION_UNSUBSCRIBE_SECRET ") ||
    message === "Notification app origin is invalid."
  );
}

export async function deliverPendingTokenlessNotificationEmails(input: {
  appOrigin: string;
  limit?: number;
  now?: Date;
  send?: typeof sendTokenlessNotificationEmail;
  signal?: AbortSignal;
  unsubscribeSecret?: string;
}) {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit);
  const configuration = deliveryConfiguration(input);
  if (!configuration.error) {
    await dbClient.execute({
      sql: `UPDATE tokenless_notification_email_deliveries
            SET state = 'retry', next_attempt_at = ?, last_error = NULL, parked_at = NULL, updated_at = ?
            WHERE state = 'parked'`,
      args: [now, now],
    });
    await dbClient.execute({
      sql: `UPDATE tokenless_notification_email_deliveries
            SET state = 'retry', attempt_count = 0, recovery_count = recovery_count + 1,
                next_attempt_at = ?, next_recovery_at = NULL, dead_at = NULL, updated_at = ?
            WHERE state = 'dead' AND recovery_count < ? AND next_recovery_at <= ?`,
      args: [now, now, MAX_RECOVERIES, now],
    });
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_notification_email_deliveries
          SET state = 'retry', next_attempt_at = ?, last_error = 'stale email claim recovered', updated_at = ?
          WHERE state = 'delivering' AND updated_at <= ?`,
    args: [now, now, new Date(now.getTime() - STALE_CLAIM_MS)],
  });
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id, d.notification_id, d.principal_address, d.preference_key, d.attempt_count,
                 d.recovery_count,
                 n.title, n.body, n.href, n.source_type,
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
    if (maintenanceCancellationRequested(input.signal)) break;
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
    if (configuration.error) {
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = 'parked', last_error = ?, parked_at = ?, updated_at = ?
              WHERE delivery_id = ? AND state = 'delivering'`,
        args: [configuration.error.slice(0, 500), now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "parked" });
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
      const unsubscribeUrl = new URL("/api/notifications/email/unsubscribe", configuration.origin!);
      unsubscribeUrl.searchParams.set("token", token);
      const sent = await (input.send ?? sendTokenlessNotificationEmail)(
        {
          actionUrl: actionUrl(
            configuration.origin!,
            canonicalReviewerNotificationHref({
              href: rowString(row, "href"),
              sourceType: rowString(row, "source_type"),
            }),
          ),
          body: rowString(row, "body") ?? "A RateLoop update is ready.",
          email: rowString(row, "email")!,
          idempotencyKey: id,
          title: rowString(row, "title") ?? "RateLoop update",
          unsubscribeUrl: unsubscribeUrl.toString(),
        },
        undefined,
        input.signal,
      );
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = 'delivered', attempt_count = ?, provider_message_id = ?, last_error = NULL,
                  delivered_at = ?, updated_at = ? WHERE delivery_id = ? AND state = 'delivering'`,
        args: [attempt, sent.id, now, now, id],
      });
      outcomes.push({ deliveryId: id, state: "delivered" });
    } catch (error) {
      if (isDeliveryConfigurationError(error)) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery is not configured.";
        await dbClient.execute({
          sql: `UPDATE tokenless_notification_email_deliveries
                SET state = 'parked', last_error = ?, parked_at = ?, updated_at = ?
                WHERE delivery_id = ? AND state = 'delivering'`,
          args: [message, now, now, id],
        });
        outcomes.push({ deliveryId: id, state: "parked" });
        continue;
      }
      const dead = attempt >= MAX_ATTEMPTS;
      const recoveryCount = Number(row.recovery_count);
      const nextRecoveryAt = dead && recoveryCount < MAX_RECOVERIES ? recoveryAt(now, recoveryCount) : null;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Email delivery failed";
      await dbClient.execute({
        sql: `UPDATE tokenless_notification_email_deliveries
              SET state = ?, attempt_count = ?, next_attempt_at = ?, next_recovery_at = ?,
                  last_error = ?, dead_at = ?, updated_at = ?
              WHERE delivery_id = ? AND state = 'delivering'`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          retryAt(now, attempt),
          nextRecoveryAt,
          message,
          dead ? now : null,
          now,
          id,
        ],
      });
      const state = dead ? "dead" : "retry";
      outcomes.push({ deliveryId: id, state });
    }
  }
  return outcomes;
}

export async function runTokenlessNotificationCycle(input: {
  appOrigin: string;
  limit?: number;
  now?: Date;
  signal?: AbortSignal;
}) {
  const now = input.now ?? new Date();
  const limit = bounded(input.limit);
  const materialized = await materializeTokenlessLifecycleNotifications({ now, limit, signal: input.signal });
  const alerts = maintenanceCancellationRequested(input.signal)
    ? { inserted: 0 }
    : await materializeOversightAlertNotifications({ now, limit });
  const enqueued = maintenanceCancellationRequested(input.signal)
    ? { inserted: 0 }
    : await enqueueTokenlessNotificationEmails({ now, limit });
  const outcomes = maintenanceCancellationRequested(input.signal)
    ? []
    : await deliverPendingTokenlessNotificationEmails({
        appOrigin: input.appOrigin,
        now,
        limit,
        signal: input.signal,
      });
  const invitationOutcomes = maintenanceCancellationRequested(input.signal)
    ? []
    : await deliverPendingWorkspaceReviewerInvitationEmails({
        appOrigin: input.appOrigin,
        now,
        limit,
        signal: input.signal,
      });
  const allOutcomes = [...outcomes, ...invitationOutcomes];
  const [notificationBacklog, invitationBacklog] = await Promise.all([
    dbClient.execute({
      sql: `SELECT state,COUNT(*) AS count FROM tokenless_notification_email_deliveries
            WHERE state IN ('retry','parked','dead') GROUP BY state`,
    }),
    dbClient.execute({
      sql: `SELECT state,COUNT(*) AS count FROM tokenless_workspace_reviewer_invitation_email_deliveries
            WHERE state IN ('retry','parked','dead') GROUP BY state`,
    }),
  ]);
  const backlog = new Map<"dead" | "parked" | "retry", number>([
    ["dead", 0],
    ["parked", 0],
    ["retry", 0],
  ]);
  for (const value of [...notificationBacklog.rows, ...invitationBacklog.rows]) {
    const row = value as Row;
    const state = rowString(row, "state");
    if (state === "dead" || state === "parked" || state === "retry") {
      backlog.set(state, (backlog.get(state) ?? 0) + Number(row.count));
    }
  }
  return {
    dead: backlog.get("dead")!,
    delivered: allOutcomes.filter(value => value.state === "delivered").length,
    enqueued: enqueued.inserted,
    materialized: materialized.inserted + alerts.inserted,
    parked: backlog.get("parked")!,
    retry: backlog.get("retry")!,
    suppressed: allOutcomes.filter(value => value.state === "suppressed").length,
  };
}

export const __notificationDeliveryTestUtils = {
  actionUrl,
  deliveryConfiguration,
  dueSoonRows,
  insertLifecycleCandidates,
  isDeliveryConfigurationError,
  notificationId,
  privateUnpaidAssignmentCandidateSql,
  recoveryAt,
  retryAt,
};
