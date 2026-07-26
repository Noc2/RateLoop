"use client";

import { useCallback, useEffect, useState } from "react";

type InboxResponse = {
  notifications?: Array<{ readAt?: string | null; sourceType?: string | null }>;
};

function assignmentUnreadCount(value: InboxResponse) {
  if (!Array.isArray(value.notifications)) return 0;
  return value.notifications.filter(
    notification => notification.sourceType === "assignment.available" && !notification.readAt,
  ).length;
}

export function HumanInboxBadge() {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/inbox?limit=100", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      setUnread(assignmentUnreadCount((await response.json()) as InboxResponse));
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
      aria-label={`${unread} unread review ${unread === 1 ? "assignment" : "assignments"}`}
      className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-content"
    >
      {label}
    </span>
  );
}
