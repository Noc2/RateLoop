"use client";

import { useEffect, useMemo, useState } from "react";

const notificationOptions = [
  {
    key: "assignmentAvailable",
    label: "Assignment available",
    description: "Know when a new human-assurance assignment is ready for you.",
  },
  {
    key: "assignmentCompleted",
    label: "Assignment completed",
    description: "See when a submitted review reaches its accepted or closed state.",
  },
  {
    key: "paymentUpdates",
    label: "Payment updates",
    description: "Receive updates about voucher, reserve, and settlement progress.",
  },
  {
    key: "askResults",
    label: "Ask results",
    description: "Know when an ask has a result or needs another panel step.",
  },
  {
    key: "accountSecurity",
    label: "Account and security",
    description: "Required for important sign-in and account changes.",
  },
] as const;

type NotificationKey = (typeof notificationOptions)[number]["key"];
type Preferences = Record<NotificationKey, boolean>;
type EmailSettings = Preferences & {
  email: string;
  verified: boolean;
  deliveryConfigured: boolean;
};

const defaultPreferences: Preferences = {
  assignmentAvailable: true,
  assignmentCompleted: true,
  paymentUpdates: true,
  askResults: true,
  accountSecurity: true,
};

const defaultEmailSettings: EmailSettings = {
  ...defaultPreferences,
  email: "",
  verified: false,
  deliveryConfigured: false,
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Notification request failed.");
  }
  return body;
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
    <label className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
      <span>
        <span className="block text-sm font-semibold text-base-content">{option.label}</span>
        <span className="mt-1 block text-xs leading-5 text-base-content/55">{option.description}</span>
      </span>
      <input
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
  const [emailDraft, setEmailDraft] = useState("");
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">("default");
  const [loading, setLoading] = useState(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    ])
      .then(([preferenceBody, emailBody]) => {
        if (cancelled) return;
        const nextPreferences = { ...defaultPreferences, ...(preferenceBody as Partial<Preferences>) };
        const nextEmail = { ...defaultEmailSettings, ...(emailBody as Partial<EmailSettings>) };
        setPreferences(nextPreferences);
        setEmailSettings(nextEmail);
        setEmailDraft(nextEmail.email);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load notification settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      setError(cause instanceof Error ? cause.message : "Unable to update email notification settings.");
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
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Notifications</p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Stay close to your RateLoop work</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
              Choose the assignment, ask, payment, and account updates you want to see. Email delivery is sent through
              your configured Resend account after you verify the address.
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
        {loading ? <p className="mt-5 text-sm text-base-content/50">Loading notification settings…</p> : null}
        {!loading ? (
          <>
            <div className="mt-5 space-y-3">
              {notificationOptions.map(option => (
                <PreferenceToggle
                  key={option.key}
                  option={option}
                  checked={option.key === "accountSecurity" ? true : preferences[option.key]}
                  disabled={savingPreferences || option.key === "accountSecurity"}
                  onChange={value => void updatePreference(option.key, value)}
                />
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
          </>
        ) : null}
      </section>

      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Email delivery</p>
            <h2 className="mt-2 text-xl font-semibold">Notification email</h2>
            <p className="mt-2 text-sm leading-6 text-base-content/60">
              Add an email address for verified RateLoop notifications. Clearing it disables email delivery.
            </p>
          </div>
          <span className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-base-content/60">
            {!emailSettings.deliveryConfigured
              ? "Resend not configured"
              : !emailSettings.email
                ? "No email added"
                : emailSettings.verified
                  ? "Email verified"
                  : "Verification required"}
          </span>
        </div>
        <label className="mt-5 block text-sm text-base-content/70" htmlFor="tokenless-notification-email">
          Delivery email
          <input
            id="tokenless-notification-email"
            type="email"
            value={emailDraft}
            onChange={event => setEmailDraft(event.target.value)}
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <button
          type="button"
          className="rateloop-gradient-action mt-4 px-5"
          disabled={savingEmail || !emailDirty || (Boolean(emailDraft.trim()) && !emailSettings.deliveryConfigured)}
          onClick={() => void saveEmailSettings()}
        >
          {savingEmail
            ? "Saving…"
            : emailSettings.email && !emailDirty
              ? "Email settings saved"
              : "Save email settings"}
        </button>
      </section>

      {status ? <p className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">{status}</p> : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
