"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import { ChoiceInput, Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";

const notificationOptions = [
  {
    key: "assignmentAvailable",
    group: "review",
  },
  {
    key: "assignmentCompleted",
    group: "review",
  },
  {
    key: "paymentUpdates",
    group: "payments",
  },
  {
    key: "askResults",
    group: "workspace",
  },
  {
    key: "accountSecurity",
    group: "account",
  },
  {
    key: "oversightAlerts",
    group: "workspace",
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
  const t = useTranslations("account.notifications");
  const label = t(`options.${option.key}.label`);
  return (
    <label
      className="flex items-center justify-between gap-4 rounded-xl border border-base-content/10 bg-base-content/[0.03] px-4 py-3"
      htmlFor={`notification-${option.key}`}
    >
      <span className="text-sm font-semibold text-base-content">{label}</span>
      <span className="flex items-center gap-3">
        {option.key === "accountSecurity" ? (
          <span className="text-xs font-medium text-base-content/60">{t("alwaysOn")}</span>
        ) : null}
        <ChoiceInput
          id={`notification-${option.key}`}
          type="checkbox"
          aria-label={label}
          className="toggle toggle-sm toggle-primary"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
        />
      </span>
    </label>
  );
}

export function NotificationSettingsPanel() {
  const t = useTranslations("account.notifications");
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
    if (result === "verified") setStatus(t("verified"));
    if (result === "unsubscribed") setStatus(t("unsubscribed"));
    if (result === "invalid" || result === "invalid_unsubscribe") setError(t("invalidLink"));
    if (window.location.hash === "#notifications") {
      window.requestAnimationFrame(() => document.getElementById("notifications")?.scrollIntoView({ block: "start" }));
    }
  }, [t]);

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
      .catch(() => {
        if (!cancelled) {
          setLoadError(t("loadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const notificationGroups = useMemo(() => {
    const visibleOptions = notificationOptions.filter(
      option =>
        (option.group !== "payments" || capabilities.hasPaidActivity) &&
        (option.group !== "workspace" || capabilities.hasWorkspace),
    );
    return (["review", "payments", "workspace", "account"] as const)
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
      setStatus(t("updated"));
    } catch {
      setPreferences(preferences);
      setError(t("updateFailed"));
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
      setStatus(body.verificationSent ? t("verificationSent") : t("emailUpdated"));
    } catch (cause) {
      capture(
        cause instanceof HttpJsonError && cause.status === 503
          ? { field: cause.field, message: t("emailUnavailable") }
          : cause,
        t("emailUpdateFailed"),
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
    setStatus(permission === "granted" ? t("browserEnabled") : t("browserBlocked"));
  }

  return (
    <section id="notifications" className="scroll-mt-24 space-y-5">
      <Card as="section" className="rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <div className="rounded-lg border border-base-content/10 bg-base-content/[0.03] px-3 py-2 text-xs text-base-content/60">
            {browserPermission === "granted"
              ? t("browserStatus.granted")
              : browserPermission === "denied"
                ? t("browserStatus.denied")
                : browserPermission === "unsupported"
                  ? t("browserStatus.unsupported")
                  : t("browserStatus.default")}
          </div>
        </div>
        <AsyncSection
          className="mt-5"
          loading={loading}
          loadingLabel={t("loading")}
          error={loadError}
          empty={notificationGroups.length === 0}
          emptyTitle={t("empty")}
        >
          <div className="mt-5 space-y-5">
            {notificationGroups.map(entry => (
              <section key={entry.group} aria-labelledby={`notification-group-${entry.group.replaceAll(" ", "-")}`}>
                <h3
                  id={`notification-group-${entry.group.replaceAll(" ", "-")}`}
                  className="mb-2 text-sm font-semibold"
                >
                  {t(`groups.${entry.group}`)}
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
            <Button
              variant="secondary"
              size="none"
              className="mt-4"
              type="button"
              onClick={() => void requestBrowserPermission()}
            >
              {t("enableBrowser")}
            </Button>
          ) : null}
        </AsyncSection>
      </Card>

      <Card as="section" className="rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">{t("emailTitle")}</h2>
            <InfoPopover label={t("aboutEmail")}>{t("emailDescription")}</InfoPopover>
          </div>
          <span className="rounded-lg border border-base-content/10 bg-base-content/[0.03] px-3 py-2 text-xs text-base-content/60">
            {!emailSettings.deliveryConfigured
              ? t("emailStatus.unavailable")
              : !emailSettings.email
                ? t("emailStatus.missing")
                : emailSettings.verified
                  ? t("emailStatus.verified")
                  : t("emailStatus.required")}
          </span>
        </div>
        {emailSettings.deliveryConfigured ? (
          <>
            <div className="mt-5">
              <Field
                id="tokenless-notification-email"
                label={t("deliveryEmail")}
                type="email"
                value={emailDraft}
                onChange={event => {
                  setEmailDraft(event.target.value);
                  clear("email");
                }}
                className="input mt-2 w-full border-base-content/10 bg-[var(--rateloop-field)]"
                placeholder="you@example.com"
                autoComplete="email"
                error={fieldErrors.email}
              />
            </div>
            <Button
              variant="primary"
              size="none"
              className="mt-4 px-5"
              type="button"
              disabled={savingEmail || !emailDirty}
              onClick={() => void saveEmailSettings()}
            >
              {savingEmail ? t("saving") : emailSettings.email && !emailDirty ? t("saved") : t("save")}
            </Button>
          </>
        ) : (
          <p className="mt-5 text-sm text-base-content/60">{t("unavailableDescription")}</p>
        )}
      </Card>

      {status ? (
        <p className="rounded-lg bg-success/10 p-3 text-sm text-success" role="status">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-lg bg-error/10 p-3 text-sm text-error">
          {formError}
        </p>
      ) : null}
    </section>
  );
}
