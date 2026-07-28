"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import {
  type ReviewerInboxNotification,
  isReviewerDeadlineOrMoneyNotification,
  isReviewerLifecycleNotification,
} from "~~/lib/notifications/reviewerInbox";
import { readJson } from "~~/lib/tokenless/http";

type InboxResponse = {
  unreadCount: number;
  notifications: ReviewerInboxNotification[];
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function notificationLabel(notification: ReviewerInboxNotification) {
  switch (notification.sourceType) {
    case "settlement.reveal_required":
      return "Reveal deadline";
    case "settlement.claim_expiring":
      return "Payment deadline";
    case "assignment.available":
      return "To review";
    case "assignment.completed":
      return "Recorded";
  }
}

function NotificationList({
  notifications,
  markingIds,
  onMarkRead,
}: {
  notifications: ReviewerInboxNotification[];
  markingIds: Set<string>;
  onMarkRead: (notificationId: string) => Promise<void>;
}) {
  return (
    <ol className="mt-3 space-y-2">
      {notifications.map(notification => {
        const urgent = isReviewerDeadlineOrMoneyNotification(notification);
        return (
          <li
            key={notification.notificationId}
            className={`rounded-xl border px-4 py-3 ${
              urgent
                ? "border-amber-300/25 bg-amber-300/[0.06]"
                : notification.readAt
                  ? "border-white/10 bg-black/10"
                  : "border-white/10 bg-white/[0.04]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <Badge variant={urgent ? "warning" : "neutral"} className="text-[0.65rem]">
                    {notificationLabel(notification)}
                  </Badge>
                  {!notification.readAt ? (
                    <Badge variant="info" className="text-[0.65rem]">
                      Unread
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-base-content/65">{notification.body}</p>
                <time dateTime={notification.createdAt} className="mt-1 block text-xs text-base-content/55">
                  {dateLabel(notification.createdAt)}
                </time>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {notification.href ? (
                  <Link
                    href={notification.href}
                    className="btn btn-sm rateloop-secondary-action px-3"
                    aria-label={`Open: ${notification.title}`}
                  >
                    Open
                  </Link>
                ) : null}
                {!notification.readAt ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Mark read: ${notification.title}`}
                    disabled={markingIds.has(notification.notificationId)}
                    onClick={() => void onMarkRead(notification.notificationId)}
                  >
                    Mark read
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ReviewerNotificationInbox() {
  const [inbox, setInbox] = useState<InboxResponse | null>(null);
  const [markingIds, setMarkingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async (signal?: AbortSignal) => {
    const body = await readJson<InboxResponse>(
      await fetch("/api/notifications/inbox?scope=reviewer&limit=100", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    );
    const notifications = Array.isArray(body.notifications)
      ? body.notifications.filter(isReviewerLifecycleNotification)
      : [];
    setInbox({
      notifications,
      unreadCount: notifications.filter(notification => !notification.readAt).length,
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadInbox(controller.signal).catch(cause => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Unable to load reviewer notifications.");
      }
    });
    return () => controller.abort();
  }, [loadInbox]);

  const actionItems = useMemo(() => inbox?.notifications.filter(isReviewerDeadlineOrMoneyNotification) ?? [], [inbox]);
  const updates = useMemo(
    () => inbox?.notifications.filter(notification => !isReviewerDeadlineOrMoneyNotification(notification)) ?? [],
    [inbox],
  );

  async function markRead(notificationIds: string[]) {
    if (!notificationIds.length) return;
    setMarkingIds(current => new Set([...current, ...notificationIds]));
    setError(null);
    try {
      await readJson(
        await fetch("/api/notifications/inbox", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds }),
        }),
      );
      const readAt = new Date().toISOString();
      setInbox(current => {
        if (!current) return current;
        const marked = new Set(notificationIds);
        const notifications = current.notifications.map(notification =>
          marked.has(notification.notificationId) ? { ...notification, readAt } : notification,
        );
        return {
          notifications,
          unreadCount: notifications.filter(notification => !notification.readAt).length,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to mark the notification as read.");
    } finally {
      setMarkingIds(current => {
        const next = new Set(current);
        notificationIds.forEach(notificationId => next.delete(notificationId));
        return next;
      });
    }
  }

  const unreadIds = inbox?.notifications
    .filter(notification => !notification.readAt)
    .map(notification => notification.notificationId);

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="reviewer-notifications-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reviewer-notifications-heading" className="text-2xl font-semibold">
            Reviewer notifications
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Your assignments, review outcomes, and payment deadlines.
          </p>
        </div>
        {unreadIds?.length ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={markingIds.size > 0}
            onClick={() => void markRead(unreadIds)}
          >
            Mark all read
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {!inbox ? (
        <p className="mt-5 text-sm text-base-content/55" role="status">
          Loading notifications…
        </p>
      ) : null}

      {inbox && inbox.notifications.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">No reviewer notifications yet.</p>
      ) : null}

      {actionItems.length > 0 ? (
        <section className="mt-6" aria-labelledby="reviewer-action-notifications">
          <h3 id="reviewer-action-notifications" className="text-sm font-semibold text-amber-100">
            Deadline and payment actions
          </h3>
          <NotificationList notifications={actionItems} markingIds={markingIds} onMarkRead={id => markRead([id])} />
        </section>
      ) : null}

      {updates.length > 0 ? (
        <section className="mt-6" aria-labelledby="reviewer-update-notifications">
          <h3 id="reviewer-update-notifications" className="text-sm font-semibold">
            Review updates
          </h3>
          <NotificationList notifications={updates} markingIds={markingIds} onMarkRead={id => markRead([id])} />
        </section>
      ) : null}
    </Card>
  );
}
