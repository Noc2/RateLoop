"use client";

import { useCallback, useEffect, useState } from "react";
import { isReviewerLifecycleNotification } from "~~/lib/notifications/reviewerInbox";

type InboxResponse = {
  notifications?: Array<{ readAt?: string | null; sourceType?: string | null }>;
};

type SessionResponse = {
  authenticated?: boolean;
};

function unreadReviewerNotifications(value: InboxResponse) {
  if (!Array.isArray(value.notifications)) return [];
  return value.notifications.filter(
    notification => !notification.readAt && isReviewerLifecycleNotification(notification),
  );
}

export function HumanInboxBadge() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!sessionResponse.ok || !((await sessionResponse.json()) as SessionResponse).authenticated) return;
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
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  if (unread === 0) return null;
  const label = unread > 99 ? "99+" : String(unread);
  return (
    <span
      aria-label={`${unread} unread reviewer ${unread === 1 ? "notification" : "notifications"}`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-content"
    >
      {label}
    </span>
  );
}
