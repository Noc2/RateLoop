"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
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

function NotificationList({
  notifications,
  markingIds,
  onMarkRead,
}: {
  notifications: ReviewerInboxNotification[];
  markingIds: Set<string>;
  onMarkRead: (notificationId: string) => Promise<void>;
}) {
  const t = useTranslations("human.notifications");
  const format = useFormatter();
  return (
    <ol className="mt-3 space-y-2">
      {notifications.map(notification => {
        const urgent = isReviewerDeadlineOrMoneyNotification(notification);
        return (
          <li
            key={notification.notificationId}
            className={`rounded-xl border px-4 py-3 ${
              urgent
                ? "border-warning/25 bg-warning/[0.06]"
                : notification.readAt
                  ? "border-base-content/10 bg-base-content/[0.02]"
                  : "border-base-content/10 bg-base-content/[0.04]"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{notification.title}</p>
                  <Badge variant={urgent ? "warning" : "neutral"} className="text-[0.65rem]">
                    {t(`labels.${notification.sourceType}`)}
                  </Badge>
                  {!notification.readAt ? (
                    <Badge variant="info" className="text-[0.65rem]">
                      {t("unread")}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-base-content/65">{notification.body}</p>
                <time dateTime={notification.createdAt} className="mt-1 block text-xs text-base-content/55">
                  {format.dateTime(new Date(notification.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {notification.href ? (
                  <Link
                    href={notification.href}
                    className="btn btn-sm rateloop-secondary-action px-3"
                    aria-label={t("openLabel", { title: notification.title })}
                  >
                    {t("open")}
                  </Link>
                ) : null}
                {!notification.readAt ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={t("markReadLabel", { title: notification.title })}
                    disabled={markingIds.has(notification.notificationId)}
                    onClick={() => void onMarkRead(notification.notificationId)}
                  >
                    {t("markRead")}
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
  const t = useTranslations("human.notifications");
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
    void loadInbox(controller.signal).catch(() => {
      if (!controller.signal.aborted) {
        setError(t("loadFailed"));
      }
    });
    return () => controller.abort();
  }, [loadInbox, t]);

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
    } catch {
      setError(t("markFailed"));
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
            {t("title")}
          </h2>
        </div>
        {unreadIds?.length ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={markingIds.size > 0}
            onClick={() => void markRead(unreadIds)}
          >
            {t("markAllRead")}
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      {!inbox ? (
        <p className="mt-5 text-sm text-base-content/55" role="status">
          {t("loading")}
        </p>
      ) : null}

      {inbox && inbox.notifications.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">{t("empty")}</p>
      ) : null}

      {actionItems.length > 0 ? (
        <section className="mt-6" aria-labelledby="reviewer-action-notifications">
          <h3 id="reviewer-action-notifications" className="text-sm font-semibold text-warning">
            {t("actions")}
          </h3>
          <NotificationList notifications={actionItems} markingIds={markingIds} onMarkRead={id => markRead([id])} />
        </section>
      ) : null}

      {updates.length > 0 ? (
        <section className="mt-6" aria-labelledby="reviewer-update-notifications">
          <h3 id="reviewer-update-notifications" className="text-sm font-semibold">
            {t("updates")}
          </h3>
          <NotificationList notifications={updates} markingIds={markingIds} onMarkRead={id => markRead([id])} />
        </section>
      ) : null}
    </Card>
  );
}
