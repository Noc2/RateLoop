"use client";

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type NotificationKind = "success" | "info" | "warning" | "error";

type Notification = Readonly<{
  id: number;
  kind: NotificationKind;
  message: string;
}>;

type NotificationApi = Readonly<{
  success: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}>;

const DEFAULT_DURATION_MS = 3_000;
const NotificationContext = createContext<NotificationApi | null>(null);

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  if (kind === "success") {
    return (
      <svg aria-hidden="true" className="h-7 w-7 text-success" viewBox="0 0 24 24" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M2.25 12a9.75 9.75 0 1 1 19.5 0 9.75 9.75 0 0 1-19.5 0Zm13.36-2.79a.75.75 0 0 0-1.22-.87l-3.61 5.05-1.67-1.67a.75.75 0 1 0-1.06 1.06l2.3 2.3a.75.75 0 0 0 1.14-.09l4.12-5.78Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (kind === "error") {
    return (
      <svg aria-hidden="true" className="h-7 w-7 text-error" viewBox="0 0 24 24" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5ZM9.97 8.91a.75.75 0 0 0-1.06 1.06L10.94 12l-2.03 2.03a.75.75 0 1 0 1.06 1.06L12 13.06l2.03 2.03a.75.75 0 0 0 1.06-1.06L13.06 12l2.03-2.03a.75.75 0 0 0-1.06-1.06L12 10.94 9.97 8.91Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (kind === "warning") {
    return (
      <svg aria-hidden="true" className="h-7 w-7 text-warning" viewBox="0 0 24 24" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10.79 3.39a1.4 1.4 0 0 1 2.42 0l8.08 14a1.4 1.4 0 0 1-1.21 2.1H3.92a1.4 1.4 0 0 1-1.21-2.1l8.08-14ZM12 8.25a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" className="h-7 w-7 text-info" viewBox="0 0 24 24" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5Zm0 8a.75.75 0 0 1 .75.75v5a.75.75 0 0 1-1.5 0v-5a.75.75 0 0 1 .75-.75Zm0-3.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function RateLoopNotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
    setNotifications(current => current.filter(notification => notification.id !== id));
  }, []);

  const show = useCallback(
    (kind: NotificationKind, message: string) => {
      const id = ++nextId.current;
      setNotifications(current => [...current, { id, kind, message }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DEFAULT_DURATION_MS),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const api = useMemo<NotificationApi>(
    () => ({
      success: message => show("success", message),
      info: message => show("info", message),
      warning: message => show("warning", message),
      error: message => show("error", message),
    }),
    [show],
  );

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-3 px-4 sm:top-6"
        aria-live="polite"
        aria-relevant="additions"
      >
        {notifications.map(notification => (
          <div
            key={notification.id}
            className="rateloop-gradient-notification pointer-events-auto relative flex w-full max-w-sm items-start justify-between gap-3 overflow-hidden rounded-xl p-4 text-sm text-base-content"
            data-motion="intro"
            role={notification.kind === "error" ? "alert" : "status"}
            aria-atomic="true"
          >
            <div className="shrink-0 self-center leading-none">
              <NotificationIcon kind={notification.kind} />
            </div>
            <p className="min-w-0 flex-1 break-words leading-6 whitespace-pre-line">{notification.message}</p>
            <button
              type="button"
              className="-m-1 shrink-0 rounded-md p-1 text-base-content/65 transition hover:text-base-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Dismiss notification"
              onClick={() => dismiss(notification.id)}
            >
              <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useRateLoopNotifications() {
  const notifications = useContext(NotificationContext);
  if (!notifications) throw new Error("useRateLoopNotifications must be used inside RateLoopNotificationProvider.");
  return notifications;
}
