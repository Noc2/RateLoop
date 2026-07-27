"use client";

import { useCallback, useEffect, useState } from "react";

type InboxResponse = {
  notifications?: Array<{ notificationId?: string; readAt?: string | null; sourceType?: string | null }>;
};

type SessionResponse = {
  authenticated?: boolean;
};

function unreadAssignmentNotifications(value: InboxResponse) {
  if (!Array.isArray(value.notifications)) return [];
  return value.notifications.filter(
    notification => notification.sourceType === "assignment.available" && !notification.readAt,
  );
}

export function HumanInboxBadge({ markAssignmentsRead = false }: { markAssignmentsRead?: boolean }) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const sessionResponse = await fetch("/api/auth/session", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!sessionResponse.ok || !((await sessionResponse.json()) as SessionResponse).authenticated) return;
      const response = await fetch("/api/notifications/inbox?limit=100", {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const assignments = unreadAssignmentNotifications((await response.json()) as InboxResponse);
      const notificationIds = assignments.flatMap(notification =>
        typeof notification.notificationId === "string" ? [notification.notificationId] : [],
      );
      if (markAssignmentsRead && notificationIds.length > 0) {
        const marked = await fetch("/api/notifications/inbox", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds }),
        });
        if (marked.ok) {
          setUnread(0);
          return;
        }
      }
      setUnread(assignments.length);
    } catch {
      // Navigation remains usable when the optional inbox request is unavailable.
    }
  }, [markAssignmentsRead]);

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
