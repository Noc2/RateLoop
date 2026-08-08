export const REVIEWER_LIFECYCLE_NOTIFICATION_SOURCE_TYPES = [
  "assignment.available",
  "assignment.deadline_approaching",
  "assignment.completed",
  "settlement.reveal_required",
  "settlement.claim_expiring",
] as const;

export type ReviewerLifecycleNotificationSourceType = (typeof REVIEWER_LIFECYCLE_NOTIFICATION_SOURCE_TYPES)[number];

export const REVIEWER_LIFECYCLE_NOTIFICATION_HREFS: Record<ReviewerLifecycleNotificationSourceType, string> = {
  "assignment.available": "/human/review",
  "assignment.deadline_approaching": "/human/review",
  "assignment.completed": "/human/history",
  "settlement.reveal_required": "/human/profile?section=paid-settlement",
  "settlement.claim_expiring": "/human/profile?section=paid-settlement",
};

export type ReviewerInboxNotification = {
  notificationId: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  sourceType: ReviewerLifecycleNotificationSourceType;
  createdAt: string;
  readAt: string | null;
};

export function isReviewerLifecycleNotification<T extends { sourceType?: string | null }>(
  notification: T,
): notification is T & { sourceType: ReviewerLifecycleNotificationSourceType } {
  return REVIEWER_LIFECYCLE_NOTIFICATION_SOURCE_TYPES.some(sourceType => sourceType === notification.sourceType);
}

export function isReviewerDeadlineOrMoneyNotification(notification: Pick<ReviewerInboxNotification, "sourceType">) {
  return (
    notification.sourceType === "assignment.deadline_approaching" ||
    notification.sourceType === "settlement.reveal_required" ||
    notification.sourceType === "settlement.claim_expiring"
  );
}

/**
 * Lifecycle type, not persisted copy, owns the destination. This repairs old
 * legacy-tab links and keeps in-app and email actions on the same route.
 */
export function canonicalReviewerNotificationHref(notification: { href?: string | null; sourceType?: string | null }) {
  return isReviewerLifecycleNotification(notification)
    ? REVIEWER_LIFECYCLE_NOTIFICATION_HREFS[notification.sourceType]
    : (notification.href ?? null);
}
