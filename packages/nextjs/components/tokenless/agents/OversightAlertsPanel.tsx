"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { Badge } from "~~/components/tokenless/ui/Badge";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";
import type { OversightInboxNotification, WorkspaceAlertPreferences } from "~~/lib/tokenless/oversightAlerts";

const POLL_INTERVAL_MS = 60_000;

type Inbox = { unreadCount: number; notifications: OversightInboxNotification[] };

const ALERT_EVENT_OPTIONS = [
  { key: "gateBlocked", labelKey: "alertGateBlocked", descriptionKey: "alertGateBlockedDescription" },
  { key: "reviewFailed", labelKey: "alertReviewFailed", descriptionKey: "alertReviewFailedDescription" },
  { key: "workspaceStop", labelKey: "alertWorkspaceStop", descriptionKey: "alertWorkspaceStopDescription" },
  { key: "coverageFloorHit", labelKey: "alertCoverageFloor", descriptionKey: "alertCoverageFloorDescription" },
] as const;

function belongsToWorkspace(notification: OversightInboxNotification, workspaceId: string) {
  if (notification.kind !== "oversightAlerts") return false;
  if (!notification.href) return false;
  try {
    const targetWorkspace = new URL(notification.href, "https://rateloop.local").searchParams.get("workspace");
    return targetWorkspace === workspaceId;
  } catch {
    return false;
  }
}

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
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
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
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadAlerts"));
        }
      }
    })();
    return () => controller.abort();
  }, [errors, workspaceId]);

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
    } catch {
      setPreferences(previous);
      setError(errors("saveAlerts"));
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
      <p className="mt-3 text-xs text-error" role="alert">
        {error}
      </p>
    ) : (
      <p className="mt-3 text-xs text-base-content/55">
        <AgentText id="loadingAlertSettings" />
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {ALERT_EVENT_OPTIONS.map(option => (
        <label
          key={option.key}
          className="flex items-start justify-between gap-4 rounded-xl border border-base-content/10 bg-base-content/[0.04] px-4 py-3"
          htmlFor={`oversight-alert-${option.key}`}
        >
          <span>
            <span className="block text-sm font-semibold">{ui(option.labelKey)}</span>
            <span className="mt-1 block text-xs leading-5 text-base-content/55">{ui(option.descriptionKey)}</span>
          </span>
          <ChoiceInput
            id={`oversight-alert-${option.key}`}
            type="checkbox"
            aria-label={ui(option.labelKey)}
            className="toggle toggle-sm toggle-primary mt-1"
            checked={preferences[option.key]}
            disabled={saving}
            onChange={event => void save({ ...preferences, [option.key]: event.target.checked })}
          />
        </label>
      ))}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-base-content/10 bg-base-content/[0.04] px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">
            <AgentText id="disagreementThreshold" />
          </span>
          <span className="mt-1 block text-xs leading-5 text-base-content/55">
            <AgentText id="translated212" />
          </span>
        </span>
        <Field
          containerClassName="w-24 shrink-0"
          label={<AgentText id="attribute032" />}
          labelClassName="sr-only"
          type="number"
          className="input-sm border-base-content/10 bg-[var(--rateloop-field)] text-right"
          min={0.01}
          max={100}
          step={0.01}
          value={preferences.disagreementSpikeBps === null ? "" : preferences.disagreementSpikeBps / 100}
          disabled={saving}
          onChange={event => {
            const raw = event.target.value.trim();
            const bps = raw === "" ? null : Math.round(Number(raw) * 100);
            if (bps !== null && (!Number.isSafeInteger(bps) || bps < 1 || bps > 10_000)) return;
            void save({ ...preferences, disagreementSpikeBps: bps });
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-content/10 bg-base-content/[0.04] px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">
            <AgentText id="browserNotifications" />
          </span>
          <span className="mt-1 block text-xs leading-5 text-base-content/55">
            {browserPermission === "unsupported" ? (
              <AgentText id="dynamic057" />
            ) : browserPermission === "denied" ? (
              <AgentText id="dynamic052" />
            ) : preferences.browserEnabled && browserPermission === "granted" ? (
              <AgentText id="dynamic055" />
            ) : (
              <AgentText id="dynamic056" />
            )}
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
            <AgentText id="translated213" />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving || !preferences.browserEnabled}
            onClick={() => void save({ ...preferences, browserEnabled: false })}
          >
            <AgentText id="translated214" />
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function OversightAlertsPanel({ workspaceId }: { workspaceId: string }) {
  const format = useAgentFormatter();
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const seenIds = useRef<Set<string> | null>(null);

  const loadInbox = useCallback(
    async (signal?: AbortSignal) => {
      const body = await readJson<Inbox>(
        await fetch("/api/notifications/inbox?limit=50", {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }),
      );
      const notifications = body.notifications.filter(notification => belongsToWorkspace(notification, workspaceId));
      const nextInbox = {
        notifications,
        unreadCount: notifications.filter(notification => !notification.readAt).length,
      };
      const fresh =
        seenIds.current === null
          ? []
          : notifications.filter(notification => !seenIds.current!.has(notification.notificationId));
      seenIds.current = new Set(notifications.map(notification => notification.notificationId));
      setInbox(nextInbox);
      return fresh;
    },
    [workspaceId],
  );

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
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadNotifications"));
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
  }, [browserEnabled, errors, loadInbox]);

  async function markAllRead() {
    const notificationIds = inbox?.notifications
      .filter(notification => !notification.readAt)
      .map(notification => notification.notificationId);
    if (!notificationIds?.length) return;
    setMarking(true);
    try {
      await readJson(
        await fetch("/api/notifications/inbox", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationIds }),
        }),
      );
      await loadInbox();
    } catch {
      setError(errors("markNotifications"));
    } finally {
      setMarking(false);
    }
  }

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="oversight-alerts-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="oversight-alerts-heading" className="text-xl font-semibold">
            <AgentText id="translated215" />
            {inbox && inbox.unreadCount > 0 ? (
              <span role="status" className="ml-2 align-middle">
                <Badge variant="info" className="text-xs">
                  {inbox.unreadCount} <AgentText id="translated216" />
                </Badge>
              </span>
            ) : null}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {inbox && inbox.unreadCount > 0 ? (
            <Button type="button" size="sm" variant="secondary" disabled={marking} onClick={() => void markAllRead()}>
              <AgentText id="translated217" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-controls="oversight-alert-settings"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(current => !current)}
          >
            {settingsOpen ? <AgentText id="dynamic054" /> : <AgentText id="dynamic053" />}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}

      {inbox && inbox.notifications.length === 0 ? (
        <p className="mt-3 text-sm text-base-content/55">
          <AgentText id="noAlerts" />
        </p>
      ) : null}

      {inbox && inbox.notifications.length > 0 ? (
        <ol className="mt-4 space-y-2">
          {inbox.notifications.map(notification => (
            <li
              key={notification.notificationId}
              className={`rounded-xl border border-base-content/10 px-4 py-3 ${
                notification.readAt ? "bg-base-content/[0.03]" : "bg-base-content/[0.04]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {notification.readAt ? null : (
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--rateloop-pink)]" aria-hidden />
                  )}
                  {notification.title}
                </p>
                <time dateTime={notification.createdAt} className="text-xs text-base-content/55">
                  {format.dateTime(new Date(notification.createdAt), { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
              <p className="mt-1 text-xs leading-5 text-base-content/60">{notification.body}</p>
              {notification.href ? (
                <a href={notification.href} className="mt-1 inline-block text-xs text-[var(--rateloop-blue)]">
                  <AgentText id="translated218" />
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {settingsOpen ? (
        <section
          id="oversight-alert-settings"
          className="mt-5 border-t border-base-content/10 pt-4"
          aria-label={ui("alertSettingsLabel")}
        >
          <AlertSettings workspaceId={workspaceId} />
        </section>
      ) : null}
    </Card>
  );
}
