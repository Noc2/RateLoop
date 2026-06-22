import { and, eq, isNotNull, or } from "drizzle-orm";
import "server-only";
import { RATE_ROUTE } from "~~/constants/routes";
import { getQuestionConfidentiality, isConfidentialityCurrentlyGated } from "~~/lib/confidentiality/context";
import { db, dbClient } from "~~/lib/db";
import { notificationEmailDeliveries, notificationEmailSubscriptions } from "~~/lib/db/schema";
import { getNotificationDeliverySecret, getOptionalAppUrl, getPrimaryServerTargetNetwork } from "~~/lib/env/server";
import { buildRateLoopEmailHtml } from "~~/lib/notifications/emailTemplate";
import { buildNotificationEmailUnsubscribeUrl } from "~~/lib/notifications/emailUrls";
import { isResendConfigured, sendResendEmail } from "~~/lib/notifications/resend";
import { pickSettlingSoonNotification } from "~~/lib/notifications/settlingSoon";
import { resolveContentDeploymentScope } from "~~/lib/protocolDeployment";
import { buildAppRelativeUrl } from "~~/lib/url/appRelative";
import { listWatchedContent } from "~~/lib/watchlist/contentWatch";
import { isPonderAvailable, isPonderConfigured, ponderGet } from "~~/services/ponder/client";

type DeliverySubscription = typeof notificationEmailSubscriptions.$inferSelect;

interface NotificationEventSubmissionItem {
  contentId: string;
  title: string;
  description: string;
  url: string;
  createdAt: string;
  categoryId: string;
  submitter: string;
  profileName: string | null;
}

interface NotificationEventResolutionItem {
  id: string;
  contentId: string;
  roundId: string;
  voter: string;
  isUp: boolean | null;
  title: string;
  description: string;
  url: string;
  settledAt: string | null;
  roundState: number | null;
  roundUpWins: boolean | null;
  profileName: string | null;
  outcome: "won" | "lost" | "cancelled" | "tied" | "reveal_failed" | "resolved";
  source?: "watched" | "voted" | "watched_voted";
}

interface NotificationEventSettlingItem {
  id: string;
  contentId: string;
  roundId: string;
  title: string;
  description: string;
  url: string;
  submitter: string;
  categoryId: string;
  roundStartTime: string | null;
  estimatedSettlementTime: string | null;
  profileName: string | null;
  source: "watched" | "voted" | "watched_voted";
}

interface NotificationEventResponse {
  settlingSoon: NotificationEventSettlingItem[];
  followedSubmissions: NotificationEventSubmissionItem[];
  followedResolutions: NotificationEventResolutionItem[];
  trackedResolutions: NotificationEventResolutionItem[];
}

const PRIVATE_CONTEXT_EMAIL_TITLE = "Private RateLoop question";
const PRIVATE_CONTEXT_EMAIL_DESCRIPTION =
  "This notification references a question with private RateLoop-hosted context.";

interface EmailCandidate {
  walletAddress: string;
  email: string;
  deploymentKey: string;
  chainId: number;
  contentRegistryAddress: `0x${string}`;
  eventKey: string;
  eventType: string;
  contentId?: string;
  subject: string;
  body: string;
  href: string;
}

let ensureNotificationEmailDeliveriesTablePromise: Promise<void> | null = null;
const DELIVERY_LEASE_MS = 2 * 60 * 1000;
const DELIVERY_STATUS_SENT = "sent";
const DELIVERY_STATUS_SENDING = "sending";
type DeliveryStatus = typeof DELIVERY_STATUS_SENT | typeof DELIVERY_STATUS_SENDING;

export function resolveNotificationEmailDeliveryStatus(args: {
  resendConfigured: boolean;
  ponderConfigured: boolean;
  ponderAvailable: boolean;
  appUrlConfigured: boolean;
}) {
  if (!args.resendConfigured || !args.ponderConfigured || !args.appUrlConfigured) {
    return {
      ok: false as const,
      error: "Notification delivery is not configured",
    };
  }

  if (!args.ponderAvailable) {
    return {
      ok: false as const,
      error: "Notification delivery is unavailable while the indexer is offline",
    };
  }

  return {
    ok: true as const,
  };
}

export async function getNotificationEmailDeliveryStatus() {
  const resendConfigured = isResendConfigured();
  const ponderConfigured = isPonderConfigured();
  const ponderAvailable = ponderConfigured ? await isPonderAvailable() : false;
  const appUrlConfigured = Boolean(getOptionalAppUrl());

  return resolveNotificationEmailDeliveryStatus({
    resendConfigured,
    ponderConfigured,
    ponderAvailable,
    appUrlConfigured,
  });
}

function getRequiredNotificationAppUrl() {
  const appUrl = getOptionalAppUrl();
  if (!appUrl) {
    throw new Error("Notification delivery is not configured");
  }
  return appUrl;
}

async function ensureNotificationEmailDeliveriesTable() {
  if (!ensureNotificationEmailDeliveriesTablePromise) {
    ensureNotificationEmailDeliveriesTablePromise = Promise.resolve();
  }

  await ensureNotificationEmailDeliveriesTablePromise;
}

async function getActiveSubscriptions(): Promise<DeliverySubscription[]> {
  return db
    .select()
    .from(notificationEmailSubscriptions)
    .where(
      and(
        isNotNull(notificationEmailSubscriptions.verifiedAt),
        or(
          eq(notificationEmailSubscriptions.roundResolved, true),
          eq(notificationEmailSubscriptions.settlingSoonHour, true),
          eq(notificationEmailSubscriptions.settlingSoonDay, true),
          eq(notificationEmailSubscriptions.followedSubmission, true),
          eq(notificationEmailSubscriptions.followedResolution, true),
        ),
      ),
    );
}

async function getWatchedContentIds(walletAddress: string) {
  const deployment = getNotificationContentDeployment();
  if (!deployment) return [];

  const rows = await listWatchedContent(walletAddress.toLowerCase() as `0x${string}`, deployment);
  return rows.map(row => row.contentId);
}

function getNotificationContentDeployment() {
  const targetNetwork = getPrimaryServerTargetNetwork();
  return targetNetwork ? resolveContentDeploymentScope(targetNetwork.id) : null;
}

async function getNotificationEvents(walletAddress: string): Promise<NotificationEventResponse> {
  const watchedIds = await getWatchedContentIds(walletAddress);
  return ponderGet<NotificationEventResponse>(`/notification-events/${walletAddress}`, {
    watched: watchedIds.join(","),
  });
}

async function redactGatedNotificationEvents(
  events: NotificationEventResponse,
  deployment: NonNullable<ReturnType<typeof getNotificationContentDeployment>>,
): Promise<NotificationEventResponse> {
  const contentIds = [
    ...new Set(
      [
        ...events.settlingSoon.map(item => item.contentId),
        ...events.followedSubmissions.map(item => item.contentId),
        ...events.followedResolutions.map(item => item.contentId),
        ...events.trackedResolutions.map(item => item.contentId),
      ].filter(Boolean),
    ),
  ];
  if (contentIds.length === 0) return events;

  const gatedIds = new Set<string>();
  await Promise.all(
    contentIds.map(async contentId => {
      const confidentiality = await getQuestionConfidentiality(contentId, deployment);
      if (isConfidentialityCurrentlyGated(confidentiality)) gatedIds.add(contentId);
    }),
  );
  if (gatedIds.size === 0) return events;

  const redact = <T extends { contentId: string; description: string; title: string }>(item: T): T =>
    gatedIds.has(item.contentId)
      ? {
          ...item,
          description: PRIVATE_CONTEXT_EMAIL_DESCRIPTION,
          title: PRIVATE_CONTEXT_EMAIL_TITLE,
        }
      : item;

  return {
    followedResolutions: events.followedResolutions.map(redact),
    followedSubmissions: events.followedSubmissions.map(redact),
    settlingSoon: events.settlingSoon.map(redact),
    trackedResolutions: events.trackedResolutions.map(redact),
  };
}

function getDisplayName(address: string, profileName: string | null) {
  return profileName || `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getAbsoluteVoteUrl(contentId: string, appUrl: string) {
  const url = buildAppRelativeUrl(appUrl, RATE_ROUTE);
  url.searchParams.set("content", contentId);
  return url.toString();
}

function getAbsoluteGovernanceUrl(appUrl: string) {
  return buildAppRelativeUrl(appUrl, "/governance").toString();
}

function getAbsoluteRoundResolvedUrl(
  contentId: string,
  source: NotificationEventResolutionItem["source"],
  appUrl: string,
) {
  return source === "watched" ? getAbsoluteVoteUrl(contentId, appUrl) : getAbsoluteGovernanceUrl(appUrl);
}

function buildCandidates(
  subscription: DeliverySubscription,
  events: NotificationEventResponse,
  appUrl: string,
  deployment: NonNullable<ReturnType<typeof getNotificationContentDeployment>>,
): EmailCandidate[] {
  const candidates = new Map<string, EmailCandidate>();
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (subscription.roundResolved) {
    for (const item of events.trackedResolutions) {
      const source = item.source ?? "voted";
      const eventKey = `${deployment.deploymentKey}:round-resolved:${subscription.walletAddress}:${item.contentId}:${item.roundId}`;
      const bodyPrefix =
        source === "watched"
          ? "A watched round resolved"
          : source === "watched_voted"
            ? "A round you watched and voted on resolved"
            : "A round you voted on resolved";
      const href = getAbsoluteRoundResolvedUrl(item.contentId, source, appUrl);
      const body =
        source === "watched"
          ? `${bodyPrefix}: "${item.title}".`
          : `${bodyPrefix}: "${item.title}". Open Governance to claim your LREP from this round.`;

      candidates.set(eventKey, {
        walletAddress: subscription.walletAddress,
        email: subscription.email,
        deploymentKey: deployment.deploymentKey,
        chainId: deployment.chainId,
        contentRegistryAddress: deployment.contentRegistryAddress,
        eventKey,
        eventType: "round_resolved",
        contentId: item.contentId,
        subject: "A tracked round just resolved on RateLoop",
        body,
        href,
      });
    }
  }

  const settlingSoonSummary = pickSettlingSoonNotification({
    nowSeconds,
    items: events.settlingSoon,
    seenHourIds: new Set(),
    seenDayIds: new Set(),
    allowHour: subscription.settlingSoonHour,
    allowDay: subscription.settlingSoonDay,
  });

  if (settlingSoonSummary) {
    const eventKey = `${deployment.deploymentKey}:settling-${settlingSoonSummary.kind}:${subscription.walletAddress}:${settlingSoonSummary.itemIds.join(",")}`;
    candidates.set(eventKey, {
      walletAddress: subscription.walletAddress,
      email: subscription.email,
      deploymentKey: deployment.deploymentKey,
      chainId: deployment.chainId,
      contentRegistryAddress: deployment.contentRegistryAddress,
      eventKey,
      eventType: settlingSoonSummary.kind === "hour" ? "settling_soon_hour" : "settling_soon_day",
      contentId: settlingSoonSummary.contentId,
      subject:
        settlingSoonSummary.kind === "hour"
          ? "A tracked round is settling within the hour"
          : "A tracked round looks likely to settle today",
      body: settlingSoonSummary.body,
      href: getAbsoluteVoteUrl(settlingSoonSummary.contentId, appUrl),
    });
  }

  if (subscription.followedSubmission) {
    for (const item of events.followedSubmissions) {
      const eventKey = `${deployment.deploymentKey}:followed-submission:${subscription.walletAddress}:${item.contentId}:${item.createdAt}`;
      const displayName = getDisplayName(item.submitter, item.profileName);
      candidates.set(eventKey, {
        walletAddress: subscription.walletAddress,
        email: subscription.email,
        deploymentKey: deployment.deploymentKey,
        chainId: deployment.chainId,
        contentRegistryAddress: deployment.contentRegistryAddress,
        eventKey,
        eventType: "followed_submission",
        contentId: item.contentId,
        subject: `${displayName} asked something new on RateLoop`,
        body: `${displayName} just asked "${item.title}".`,
        href: getAbsoluteVoteUrl(item.contentId, appUrl),
      });
    }
  }

  if (subscription.followedResolution) {
    for (const item of events.followedResolutions) {
      const eventKey = `${deployment.deploymentKey}:followed-resolution:${subscription.walletAddress}:${item.contentId}:${item.roundId}:${item.settledAt ?? ""}`;
      const displayName = getDisplayName(item.voter, item.profileName);
      const action = item.outcome === "won" ? "won" : item.outcome === "lost" ? "lost" : "resolved";
      candidates.set(eventKey, {
        walletAddress: subscription.walletAddress,
        email: subscription.email,
        deploymentKey: deployment.deploymentKey,
        chainId: deployment.chainId,
        contentRegistryAddress: deployment.contentRegistryAddress,
        eventKey,
        eventType: "followed_resolution",
        contentId: item.contentId,
        subject: `${displayName} ${action} a RateLoop call`,
        body: `${displayName} ${action} a call on "${item.title}".`,
        href: getAbsoluteVoteUrl(item.contentId, appUrl),
      });
    }
  }

  return [...candidates.values()];
}

async function getDeliveryState(eventKey: string): Promise<DeliveryStatus | null> {
  const [row] = await db
    .select({ status: notificationEmailDeliveries.status })
    .from(notificationEmailDeliveries)
    .where(eq(notificationEmailDeliveries.eventKey, eventKey))
    .limit(1);

  if (!row) return null;
  return row.status === DELIVERY_STATUS_SENDING ? DELIVERY_STATUS_SENDING : DELIVERY_STATUS_SENT;
}

export function resolveNotificationEmailDeliveryAttempt(args: {
  deliveryState: "sent" | "sending" | null;
  leaseAcquired: boolean;
}) {
  if (args.deliveryState === DELIVERY_STATUS_SENT) {
    return "skip-sent" as const;
  }

  if (!args.leaseAcquired) {
    return "skip-lease" as const;
  }

  return "send" as const;
}

async function reservePendingDelivery(candidate: EmailCandidate) {
  const result = await dbClient.execute({
    sql: `
      INSERT INTO notification_email_deliveries (
        wallet_address,
        email,
        deployment_key,
        chain_id,
        content_registry_address,
        event_key,
        event_type,
        content_id,
        status,
        delivered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_key) DO UPDATE SET
        wallet_address = excluded.wallet_address,
        email = excluded.email,
        deployment_key = excluded.deployment_key,
        chain_id = excluded.chain_id,
        content_registry_address = excluded.content_registry_address,
        event_type = excluded.event_type,
        content_id = excluded.content_id,
        status = excluded.status
      WHERE notification_email_deliveries.status != ?
      RETURNING event_key
    `,
    args: [
      candidate.walletAddress,
      candidate.email,
      candidate.deploymentKey,
      candidate.chainId,
      candidate.contentRegistryAddress,
      candidate.eventKey,
      candidate.eventType,
      candidate.contentId ?? null,
      DELIVERY_STATUS_SENDING,
      null,
      DELIVERY_STATUS_SENT,
    ],
  });

  return result.rows.length > 0;
}

async function markDeliverySent(eventKey: string) {
  await db
    .update(notificationEmailDeliveries)
    .set({
      status: DELIVERY_STATUS_SENT,
      deliveredAt: new Date(),
    })
    .where(eq(notificationEmailDeliveries.eventKey, eventKey));
}

async function clearPendingDelivery(eventKey: string) {
  await dbClient.execute({
    sql: "DELETE FROM notification_email_deliveries WHERE event_key = ? AND status = ?",
    args: [eventKey, DELIVERY_STATUS_SENDING],
  });
}

async function acquireDeliveryLease(eventKey: string, now: number) {
  const result = await dbClient.execute({
    sql: `
      INSERT INTO notification_email_delivery_leases (event_key, lease_expires_at)
      VALUES (?, ?)
      ON CONFLICT(event_key) DO UPDATE SET
        lease_expires_at = excluded.lease_expires_at
      WHERE notification_email_delivery_leases.lease_expires_at <= ?
      RETURNING event_key
    `,
    args: [eventKey, now + DELIVERY_LEASE_MS, now],
  });

  return result.rows.length > 0;
}

async function releaseDeliveryLease(eventKey: string) {
  await dbClient.execute({
    sql: "DELETE FROM notification_email_delivery_leases WHERE event_key = ?",
    args: [eventKey],
  });
}

async function sendCandidate(candidate: EmailCandidate, appUrl: string) {
  const unsubscribeSecret = getNotificationDeliverySecret();
  if (!unsubscribeSecret) {
    throw new Error("Notification delivery is not configured");
  }

  const unsubscribeUrl = buildNotificationEmailUnsubscribeUrl({
    appUrl,
    walletAddress: candidate.walletAddress,
    email: candidate.email,
    secret: unsubscribeSecret,
  });

  await sendResendEmail({
    to: candidate.email,
    subject: candidate.subject,
    text: `${candidate.body}\n\nOpen RateLoop: ${candidate.href}\n\nUnsubscribe from these emails: ${unsubscribeUrl}`,
    html: buildRateLoopEmailHtml({
      eyebrow: "RateLoop notification",
      title: candidate.subject,
      body: candidate.body,
      ctaLabel: "Open RateLoop",
      ctaHref: candidate.href,
      footerNote: "You are receiving this email because this notification type is enabled in your RateLoop settings.",
      footerLinkLabel: "Unsubscribe from these emails",
      footerLinkHref: unsubscribeUrl,
    }),
  });
}

export async function deliverNotificationEmails() {
  await ensureNotificationEmailDeliveriesTable();
  const appUrl = getRequiredNotificationAppUrl();
  const deployment = getNotificationContentDeployment();
  if (!deployment) {
    throw new Error("Notification delivery deployment is not configured");
  }

  const subscriptions = await getActiveSubscriptions();
  const result = {
    processedSubscriptions: subscriptions.length,
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const subscription of subscriptions) {
    let candidates: EmailCandidate[];
    try {
      const events = await redactGatedNotificationEvents(
        await getNotificationEvents(subscription.walletAddress),
        deployment,
      );
      candidates = buildCandidates(subscription, events, appUrl, deployment);
    } catch (error) {
      console.error("Failed to prepare notification email candidates:", subscription.walletAddress, error);
      result.failed += 1;
      continue;
    }

    for (const candidate of candidates) {
      result.attempted += 1;

      const deliveryState = await getDeliveryState(candidate.eventKey);
      const leaseAcquired = await acquireDeliveryLease(candidate.eventKey, Date.now());
      const attempt = resolveNotificationEmailDeliveryAttempt({
        deliveryState,
        leaseAcquired,
      });

      if (attempt === "skip-sent" || attempt === "skip-lease") {
        result.skipped += 1;
        continue;
      }

      try {
        const reserved = await reservePendingDelivery(candidate);
        if (!reserved) {
          result.skipped += 1;
          await releaseDeliveryLease(candidate.eventKey);
          continue;
        }

        await sendCandidate(candidate, appUrl);
        try {
          await markDeliverySent(candidate.eventKey);
          result.sent += 1;
          await releaseDeliveryLease(candidate.eventKey);
        } catch (error) {
          console.error(
            "Notification email may have been sent but could not be marked delivered:",
            candidate.eventKey,
            error,
          );
          result.failed += 1;
        }
      } catch (error) {
        console.error("Failed to send notification email:", candidate.eventKey, error);
        await clearPendingDelivery(candidate.eventKey);
        await releaseDeliveryLease(candidate.eventKey);
        result.failed += 1;
      }
    }
  }

  return result;
}
