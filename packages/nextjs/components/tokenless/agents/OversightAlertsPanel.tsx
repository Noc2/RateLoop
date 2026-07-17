"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";
import type { OversightInboxNotification, WorkspaceAlertPreferences } from "~~/lib/tokenless/oversightAlerts";

const POLL_INTERVAL_MS = 60_000;

type Inbox = { unreadCount: number; notifications: OversightInboxNotification[] };

const ALERT_EVENT_OPTIONS = [
  { key: "gateBlocked", label: "Output gate blocked", description: "An output was held undelivered by the gate." },
  {
    key: "reviewFailed",
    label: "Review failed or expired",
    description: "A review reached terminal failure or expired.",
  },
  { key: "workspaceStop", label: "Workspace stop engaged", description: "Someone engaged the workspace-wide stop." },
  {
    key: "coverageFloorHit",
    label: "Coverage floor reached",
    description: "Adaptive sampling dropped to the configured production floor.",
  },
] as const;

/**
 * Fires a browser notification for oversight alerts that arrive while the
 * dashboard is open. Permission is requested only from the explicit button in
 * the alert settings below — never automatically.
 */
function fireBrowserNotifications(fresh: OversightInboxNotification[], enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;
  for (const notification of fresh) {
    if (notification.kind !== "oversightAlerts") continue;
    new window.Notification(notification.title, { body: notification.body, tag: notification.notificationId });
  }
}

function AlertSettings({ workspaceId }: { workspaceId: string }) {
  const [preferences, setPreferences] = useState<WorkspaceAlertPreferences | null>(null);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">("default");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBrowserPermission("Notification" in window ? window.Notification.permission : "unsupported");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const body = await readJson<{ preferences: WorkspaceAlertPreferences }>(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/oversight/alert-preferences`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setPreferences(body.preferences);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load alert settings.");
        }
      }
    })();
    return () => controller.abort();
  }, [workspaceId]);

  async function save(next: WorkspaceAlertPreferences) {
    const previous = preferences;
    setPreferences(next);
    setSaving(true);
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/oversight/alert-preferences`, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            preferences: {
              gateBlocked: next.gateBlocked,
              reviewFailed: next.reviewFailed,
              workspaceStop: next.workspaceStop,
              coverageFloorHit: next.coverageFloorHit,
              disagreementSpikeBps: next.disagreementSpikeBps,
              browserEnabled: next.browserEnabled,
            },
          }),
        }),
      );
    } catch (cause) {
      setPreferences(previous);
      setError(cause instanceof Error ? cause.message : "Unable to save alert settings.");
    } finally {
      setSaving(false);
    }
  }

  async function enableBrowserNotifications() {
    if (!preferences) return;
    // Permission is requested only on this explicit user action.
    if (!("Notification" in window)) {
      setBrowserPermission("unsupported");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setBrowserPermission(permission);
    if (permission === "granted") await save({ ...preferences, browserEnabled: true });
  }

  if (!preferences) {
    return error ? (
      <p className="mt-3 text-xs text-red-100" role="alert">
        {error}
      </p>
    ) : (
      <p className="mt-3 text-xs text-base-content/45">Loading alert settings…</p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {ALERT_EVENT_OPTIONS.map(option => (
        <label
          key={option.key}
          className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
        >
          <span>
            <span className="block text-sm font-semibold">{option.label}</span>
            <span className="mt-1 block text-xs leading-5 text-base-content/55">{option.description}</span>
          </span>
          <input
            type="checkbox"
            aria-label={option.label}
            className="toggle toggle-sm toggle-primary mt-1"
            checked={preferences[option.key]}
            disabled={saving}
            onChange={event => void save({ ...preferences, [option.key]: event.target.checked })}
          />
        </label>
      ))}
      <label className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">Disagreement spike threshold</span>
          <span className="mt-1 block text-xs leading-5 text-base-content/55">
            Alert when 30-day reviewer disagreement reaches this share of comparable cases. Clear to disable.
          </span>
        </span>
        <input
          type="number"
          className="input input-sm w-24 border-white/10 bg-[var(--rateloop-field)] text-right"
          min={0.01}
          max={100}
          step={0.01}
          value={preferences.disagreementSpikeBps === null ? "" : preferences.disagreementSpikeBps / 100}
          disabled={saving}
          aria-label="Disagreement spike threshold percent"
          onChange={event => {
            const raw = event.target.value.trim();
            const bps = raw === "" ? null : Math.round(Number(raw) * 100);
            if (bps !== null && (!Number.isSafeInteger(bps) || bps < 1 || bps > 10_000)) return;
            void save({ ...preferences, disagreementSpikeBps: bps });
          }}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">Browser notifications</span>
          <span className="mt-1 block text-xs leading-5 text-base-content/55">
            {browserPermission === "unsupported"
              ? "This browser does not support notifications."
              : browserPermission === "denied"
                ? "Blocked in the browser settings."
                : preferences.browserEnabled && browserPermission === "granted"
                  ? "Enabled while the dashboard is open."
                  : "Off until you enable them explicitly."}
          </span>
        </span>
        {browserPermission !== "unsupported" && !(preferences.browserEnabled && browserPermission === "granted") ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving || browserPermission === "denied"}
            onClick={() => void enableBrowserNotifications()}
          >
            Enable browser notifications
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving || !preferences.browserEnabled}
            onClick={() => void save({ ...preferences, browserEnabled: false })}
          >
            Turn off
          </Button>
        )}
      </div>
      <p className="text-xs leading-5 text-base-content/45">
        Alerts always appear here. Email delivery is separate and opt-in: add and verify a notification email in your
        account settings, then enable oversight alert emails there.
      </p>
      {error ? (
        <p className="text-xs text-red-100" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OversightAlertsPanel({ workspaceId }: { workspaceId: string }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const seenIds = useRef<Set<string> | null>(null);

  const loadInbox = useCallback(async (signal?: AbortSignal) => {
    const body = await readJson<Inbox>(
      await fetch("/api/notifications/inbox?limit=50", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      }),
    );
    const fresh =
      seenIds.current === null
        ? []
        : body.notifications.filter(notification => !seenIds.current!.has(notification.notificationId));
    seenIds.current = new Set(body.notifications.map(notification => notification.notificationId));
    setInbox(body);
    return fresh;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        await readJson<{ preferences: WorkspaceAlertPreferences }>(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/oversight/alert-preferences`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        ).then(body => setBrowserEnabled(Boolean(body.preferences.browserEnabled)));
      } catch {
        // Alert settings stay hidden for members without management access.
      }
    })();
    return () => controller.abort();
  }, [workspaceId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | null = null;
    void (async () => {
      try {
        await loadInbox(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load notifications.");
        }
      }
      if (controller.signal.aborted) return;
      timer = setInterval(() => {
        void loadInbox(controller.signal)
          .then(fresh => fireBrowserNotifications(fresh, browserEnabled))
          .catch(() => undefined);
      }, POLL_INTERVAL_MS);
    })();
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [browserEnabled, loadInbox]);

  async function markAllRead() {
    setMarking(true);
    try {
      await readJson(
        await fetch("/api/notifications/inbox", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }),
      );
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to mark notifications as read.");
    } finally {
      setMarking(false);
    }
  }

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="oversight-alerts-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Monitoring</p>
          <h2 id="oversight-alerts-heading" className="mt-2 text-xl font-semibold">
            Oversight alerts
            {inbox && inbox.unreadCount > 0 ? (
              <span role="status" className="ml-2 align-middle">
                <Badge variant="info" className="text-xs">
                  {inbox.unreadCount} unread
                </Badge>
              </span>
            ) : null}
          </h2>
        </div>
        {inbox && inbox.unreadCount > 0 ? (
          <Button type="button" size="sm" variant="secondary" disabled={marking} onClick={() => void markAllRead()}>
            Mark all read
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}

      {inbox && inbox.notifications.length === 0 ? (
        <p className="mt-3 text-sm text-base-content/55">No alerts yet. Events appear here as they happen.</p>
      ) : null}

      {inbox && inbox.notifications.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {inbox.notifications.map(notification => (
            <li
              key={notification.notificationId}
              className={`rounded-xl border border-white/10 px-4 py-3 ${
                notification.readAt ? "bg-black/10" : "bg-white/[0.04]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {notification.readAt ? null : (
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--rateloop-pink)]" aria-hidden />
                  )}
                  {notification.title}
                </p>
                <time dateTime={notification.createdAt} className="text-xs text-base-content/45">
                  {new Date(notification.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 text-xs leading-5 text-base-content/60">{notification.body}</p>
              {notification.href ? (
                <a href={notification.href} className="mt-1 inline-block text-xs text-[var(--rateloop-blue)]">
                  Open
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <details className="mt-5 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/70">Alert settings</summary>
        <AlertSettings workspaceId={workspaceId} />
      </details>
    </Card>
  );
}
