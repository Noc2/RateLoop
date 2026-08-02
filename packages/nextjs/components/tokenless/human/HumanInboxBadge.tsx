"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import { isReviewerLifecycleNotification } from "~~/lib/notifications/reviewerInbox";

type InboxResponse = {
  notifications?: Array<{ readAt?: string | null; sourceType?: string | null }>;
};

function unreadReviewerNotifications(value: InboxResponse) {
  if (!Array.isArray(value.notifications)) return [];
  return value.notifications.filter(
    notification => !notification.readAt && isReviewerLifecycleNotification(notification),
  );
}

export function HumanInboxBadge() {
  const t = useTranslations("human");
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      if (!(await readBrowserSession())) {
        setUnread(0);
        return;
      }
      const response = await fetch("/api/notifications/inbox?scope=reviewer&limit=100", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      setUnread(unreadReviewerNotifications((await response.json()) as InboxResponse).length);
    } catch {
      // Navigation remains usable when the optional inbox request is unavailable.
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToBrowserAuthSessionChanges(() => void refresh());
  }, [refresh]);

  if (unread === 0) return null;
  const label = unread > 99 ? "99+" : String(unread);
  return (
    <span
      aria-label={t("inboxBadge", { count: unread })}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-content"
    >
      {label}
    </span>
  );
}
