"use client";

import { useEffect, useMemo, useState } from "react";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";

const notificationOptions = [
  {
    key: "assignmentAvailable",
    group: "Review work",
    label: "New review",
    description: "When review work is ready for you.",
  },
  {
    key: "assignmentCompleted",
    group: "Review work",
    label: "Review outcome",
    description: "When a submitted review is accepted or closed.",
  },
  {
    key: "paymentUpdates",
    group: "Payments",
    label: "Payment updates",
    description: "When money from paid review work is ready or needs action.",
  },
  {
    key: "askResults",
    group: "Workspace",
    label: "Workspace results",
    description: "When a workspace review has a result or needs another step.",
  },
  {
    key: "accountSecurity",
    group: "Account",
    label: "Account security",
    description: "Always on for important sign-in and account changes.",
  },
  {
    key: "oversightAlerts",
    group: "Workspace",
    label: "Workspace alerts",
    description: "When review work is blocked, fails, expires, or is stopped.",
  },
] as const;

type NotificationKey = (typeof notificationOptions)[number]["key"];
type NotificationGroup = (typeof notificationOptions)[number]["group"];
type Preferences = Record<NotificationKey, boolean>;
type EmailSettings = Preferences & {
  email: string;
  verified: boolean;
  deliveryConfigured: boolean;
};
type NotificationCapabilities = {
  hasPaidActivity: boolean;
  hasWorkspace: boolean;
};

const defaultPreferences: Preferences = {
  assignmentAvailable: true,
  assignmentCompleted: true,
  paymentUpdates: true,
  askResults: true,
  accountSecurity: true,
  oversightAlerts: false,
};

const defaultEmailSettings: EmailSettings = {
  ...defaultPreferences,
  email: "",
  verified: false,
  deliveryConfigured: false,
};

const defaultCapabilities: NotificationCapabilities = {
  hasPaidActivity: false,
  hasWorkspace: false,
};

async function loadNotificationCapabilities(): Promise<NotificationCapabilities> {
  const [workspacesResult, earningsResult] = await Promise.allSettled([
    fetch("/api/account/workspaces", { credentials: "same-origin", cache: "no-store" }).then(response =>
      readJson<{ workspaces?: unknown[] }>(response),
    ),
    fetch("/api/rater/earnings", { credentials: "same-origin", cache: "no-store" }).then(response =>
      readJson<{ items?: unknown[]; totals?: Record<string, unknown> }>(response),
    ),
  ]);
  const workspaces = workspacesResult.status === "fulfilled" ? workspacesResult.value.workspaces : [];
  const earnings = earningsResult.status === "fulfilled" ? earningsResult.value : null;
  const hasPaidTotal = Object.values(earnings?.totals ?? {}).some(
    value => typeof value === "string" && !/^0+$/u.test(value),
  );
  return {
    hasPaidActivity: Boolean(earnings?.items?.length) || hasPaidTotal,
    hasWorkspace: Boolean(workspaces?.length),
  };
}

function PreferenceToggle({
  option,
  checked,
  disabled,
  onChange,
}: {
  option: (typeof notificationOptions)[number];
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
      htmlFor={`notification-${option.key}`}
    >
      <span>
        <span className="block text-sm font-semibold text-base-content">{option.label}</span>
        <span className="mt-1 block text-xs leading-5 text-base-content/55">{option.description}</span>
      </span>
      <ChoiceInput
        id={`notification-${option.key}`}
        type="checkbox"
        aria-label={option.label}
        className="toggle toggle-sm toggle-primary mt-1"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
      />
    </label>
  );
}

export function NotificationSettingsPanel() {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [emailSettings, setEmailSettings] = useState<EmailSettings>(defaultEmailSettings);
  const [capabilities, setCapabilities] = useState<NotificationCapabilities>(defaultCapabilities);
  const [emailDraft, setEmailDraft] = useState("");
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">("default");
  const [loading, setLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) {
      setBrowserPermission("unsupported");
    } else {
      setBrowserPermission(window.Notification.permission);
    }
    const result = new URLSearchParams(window.location.search).get("email");
    if (result === "verified") setStatus("Email verified. RateLoop can now send notifications to that address.");
    if (result === "unsubscribed") setStatus("Email notifications unsubscribed.");
    if (result === "invalid" || result === "invalid_unsubscribe") setError("That email link is invalid or expired.");
    if (window.location.hash === "#notifications") {
      window.requestAnimationFrame(() => document.getElementById("notifications")?.scrollIntoView({ block: "start" }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/notifications/preferences", { credentials: "same-origin", cache: "no-store" }).then(readJson),
      fetch("/api/notifications/email", { credentials: "same-origin", cache: "no-store" }).then(readJson),
      loadNotificationCapabilities(),
    ])
      .then(([preferenceBody, emailBody, nextCapabilities]) => {
        if (cancelled) return;
        const nextPreferences = { ...defaultPreferences, ...(preferenceBody as Partial<Preferences>) };
        const nextEmail = { ...defaultEmailSettings, ...(emailBody as Partial<EmailSettings>) };
        setPreferences(nextPreferences);
        setEmailSettings(nextEmail);
        setCapabilities(nextCapabilities);
        setEmailDraft(nextEmail.email);
        setLoadError(null);
      })
      .catch(cause => {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : "Unable to load notification settings.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const notificationGroups = useMemo(() => {
    const visibleOptions = notificationOptions.filter(
      option =>
        (option.group !== "Payments" || capabilities.hasPaidActivity) &&
        (option.group !== "Workspace" || capabilities.hasWorkspace),
    );
    return (["Review work", "Payments", "Workspace", "Account"] as const)
      .map(group => ({ group, options: visibleOptions.filter(option => option.group === group) }))
      .filter((entry): entry is { group: NotificationGroup; options: typeof visibleOptions } =>
        Boolean(entry.options.length),
      );
  }, [capabilities]);

  const emailDirty = useMemo(
    () =>
      emailDraft.trim().toLowerCase() !== emailSettings.email ||
      notificationOptions.some(option => preferences[option.key] !== emailSettings[option.key]),
    [emailDraft, emailSettings, preferences],
  );

  async function updatePreference(key: NotificationKey, value: boolean) {
    if (key === "accountSecurity") return;
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    setSavingPreferences(true);
    setError(null);
    try {
      await readJson(
        await fetch("/api/notifications/preferences", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences: next }),
        }),
      );
      setStatus("Notification settings updated.");
    } catch (cause) {
      setPreferences(preferences);
      setError(cause instanceof Error ? cause.message : "Unable to update notification settings.");
    } finally {
      setSavingPreferences(false);
    }
  }

  async function saveEmailSettings() {
    setSavingEmail(true);
    setError(null);
    clear();
    setStatus(null);
    try {
      const body = await readJson(
        await fetch("/api/notifications/email", {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailDraft, preferences }),
        }),
      );
      const nextEmail = { ...defaultEmailSettings, ...(body.settings as Partial<EmailSettings>) };
      setEmailSettings(nextEmail);
      setEmailDraft(nextEmail.email);
      setStatus(
        body.verificationSent ? "Check your inbox to verify this notification email." : "Email settings updated.",
      );
    } catch (cause) {
      capture(
        cause instanceof HttpJsonError && cause.status === 503
          ? { field: cause.field, message: "Email notifications are unavailable right now." }
          : cause,
        "Unable to update email notification settings.",
      );
    } finally {
      setSavingEmail(false);
    }
  }

  async function requestBrowserPermission() {
    if (!("Notification" in window)) {
      setBrowserPermission("unsupported");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setBrowserPermission(permission);
    setStatus(permission === "granted" ? "Browser notifications enabled." : "Browser notifications remain blocked.");
  }

  return (
    <section id="notifications" className="scroll-mt-24 space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Choose your notifications</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
              Choose which updates you receive. Account security notifications stay on.
            </p>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-base-content/60">
            {browserPermission === "granted"
              ? "Browser alerts enabled"
              : browserPermission === "denied"
                ? "Browser alerts blocked"
                : browserPermission === "unsupported"
                  ? "Browser alerts unavailable"
                  : "Browser alerts need permission"}
          </div>
        </div>
        <AsyncSection
          className="mt-5"
          loading={loading}
          loadingLabel="Loading notification settings"
          error={loadError}
          empty={notificationGroups.length === 0}
          emptyTitle="No notification choices available."
        >
          <div className="mt-5 space-y-5">
            {notificationGroups.map(entry => (
              <section key={entry.group} aria-labelledby={`notification-group-${entry.group.replaceAll(" ", "-")}`}>
                <h3
                  id={`notification-group-${entry.group.replaceAll(" ", "-")}`}
                  className="mb-2 text-sm font-semibold"
                >
                  {entry.group}
                </h3>
                <div className="space-y-2">
                  {entry.options.map(option => (
                    <PreferenceToggle
                      key={option.key}
                      option={option}
                      checked={option.key === "accountSecurity" ? true : preferences[option.key]}
                      disabled={savingPreferences || option.key === "accountSecurity"}
                      onChange={value => void updatePreference(option.key, value)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
          {browserPermission === "default" ? (
            <button
              type="button"
              className="btn rateloop-secondary-action mt-4"
              onClick={() => void requestBrowserPermission()}
            >
              Enable browser notifications
            </button>
          ) : null}
        </AsyncSection>
      </section>

      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Notification email</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/60">
              Add an email address for verified RateLoop notifications. Clearing it disables email delivery.
            </p>
          </div>
          <span className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-base-content/60">
            {!emailSettings.deliveryConfigured
              ? "Email notifications unavailable"
              : !emailSettings.email
                ? "No email added"
                : emailSettings.verified
                  ? "Email verified"
                  : "Verification required"}
          </span>
        </div>
        {emailSettings.deliveryConfigured ? (
          <>
            <div className="mt-5">
              <Field
                id="tokenless-notification-email"
                label="Delivery email"
                type="email"
                value={emailDraft}
                onChange={event => {
                  setEmailDraft(event.target.value);
                  clear("email");
                }}
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                placeholder="you@example.com"
                autoComplete="email"
                error={fieldErrors.email}
              />
            </div>
            <button
              type="button"
              className="rateloop-gradient-action mt-4 px-5"
              disabled={savingEmail || !emailDirty}
              onClick={() => void saveEmailSettings()}
            >
              {savingEmail
                ? "Saving…"
                : emailSettings.email && !emailDirty
                  ? "Email settings saved"
                  : "Save email settings"}
            </button>
          </>
        ) : (
          <p className="mt-5 text-sm text-base-content/60">
            Email notifications are unavailable right now. Browser notifications still use the choices above.
          </p>
        )}
      </section>

      {status ? (
        <p className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {formError}
        </p>
      ) : null}
    </section>
  );
}
