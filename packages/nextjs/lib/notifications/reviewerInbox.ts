export const REVIEWER_LIFECYCLE_NOTIFICATION_SOURCE_TYPES = [
  "assignment.available",
  "assignment.completed",
  "settlement.reveal_required",
  "settlement.claim_expiring",
] as const;

export type ReviewerLifecycleNotificationSourceType = (typeof REVIEWER_LIFECYCLE_NOTIFICATION_SOURCE_TYPES)[number];

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
    notification.sourceType === "settlement.reveal_required" || notification.sourceType === "settlement.claim_expiring"
  );
}
