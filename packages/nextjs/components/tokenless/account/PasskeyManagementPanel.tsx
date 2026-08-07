"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { betterAuthClient, readBrowserAuthConfiguration } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";

type PasskeySummary = {
  backedUp: boolean;
  createdAt: string | null;
  deviceType: string | null;
  id: string;
  name: string;
};

type PendingAction = { kind: "add" } | { id: string; kind: "remove" };

async function jsonRequest<T>(url: string, fallbackMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  return readJson<T>(response, { fallbackMessage });
}

class PasskeyFieldError extends Error {
  field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "PasskeyFieldError";
    this.field = field;
  }
}

export function PasskeyManagementPanel() {
  const t = useTranslations("account.passkeys");
  const format = useFormatter();
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [canRemoveLast, setCanRemoveLast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof readBrowserAuthConfiguration>> | null>(
    null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const refresh = useCallback(async () => {
    const result = await jsonRequest<{ canRemoveLast: boolean; passkeys: PasskeySummary[] }>(
      "/api/account/passkeys",
      t("updateFailed"),
    );
    setPasskeys(result.passkeys);
    setCanRemoveLast(result.canRemoveLast);
    setLoadError(null);
  }, [t]);

  useEffect(() => {
    void refresh()
      .catch(() => setLoadError(t("loadFailed")))
      .finally(() => setLoading(false));
  }, [refresh, t]);

  function resetVerification() {
    setPending(null);
    setConfiguration(null);
    setEmail("");
    setOtp("");
    setOtpSent(false);
    clear();
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    clear();
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      capture(cause, fallback);
    } finally {
      setBusy(false);
    }
  }

  async function start(action: PendingAction) {
    setPending(action);
    await run(async () => {
      await betterAuthClient.signOut().catch(() => undefined);
      setConfiguration(await readBrowserAuthConfiguration());
    }, t("verificationOptionsFailed"));
  }

  async function finish() {
    if (!pending) return;
    if (pending.kind === "add") {
      const authorized = await jsonRequest<{ expiresAt: string; proof: string }>(
        "/api/account/passkeys",
        t("updateFailed"),
        {
          body: JSON.stringify({ action: "passkey_add" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const result = await betterAuthClient.passkey.addPasskey({
        fetchOptions: { headers: { "x-rateloop-passkey-action-proof": authorized.proof } },
        name: name.trim() || t("defaultName"),
      });
      if (result.error) {
        throw new PasskeyFieldError(t("addFailed"), "name");
      }
      setName("");
      setNotice(t("addedNotice"));
    } else {
      await jsonRequest<{ removed: true }>(
        `/api/account/passkeys/${encodeURIComponent(pending.id)}`,
        t("updateFailed"),
        { method: "DELETE" },
      );
      setNotice(t("removedNotice"));
    }
    await betterAuthClient.signOut().catch(() => undefined);
    resetVerification();
    await refresh();
  }

  async function verifyWithPasskey() {
    await run(async () => {
      const result = await betterAuthClient.signIn.passkey();
      if (result.error) throw new Error(t("verificationFailed"));
      await finish();
    }, t("verificationFailed"));
    await betterAuthClient.signOut().catch(() => undefined);
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await betterAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) {
        throw new PasskeyFieldError(t("sendFailed"), "email");
      }
      setOtpSent(true);
    }, t("sendFailed"));
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await betterAuthClient.signIn.emailOtp({ email, otp });
      if (result.error) {
        throw new PasskeyFieldError(t("invalidCode"), "otp");
      }
      await finish();
    }, t("verifyCodeFailed"));
    await betterAuthClient.signOut().catch(() => undefined);
  }

  const removingOnlyPasskey = pending?.kind === "remove" && passkeys.length === 1;

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="passkeys-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 id="passkeys-heading" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Button variant="secondary" size="sm" disabled={busy} type="button" onClick={() => void start({ kind: "add" })}>
          {t("add")}
        </Button>
      </div>

      <AsyncSection
        className="mt-5"
        loading={loading}
        loadingLabel={t("loading")}
        error={loadError}
        empty={passkeys.length === 0}
        emptyTitle={t("empty")}
      >
        <ul className="mt-5 space-y-3" aria-label={t("listLabel")}>
          {passkeys.map(passkey => {
            const isOnly = passkeys.length === 1;
            const removalBlocked = isOnly && !canRemoveLast;
            return (
              <li
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-base-content/10 p-4"
              >
                <div>
                  <p className="font-medium">{passkey.name}</p>
                  <p className="mt-1 text-xs text-base-content/55">
                    {passkey.createdAt
                      ? t("added", { date: format.dateTime(new Date(passkey.createdAt), { dateStyle: "medium" }) })
                      : t("addedUnavailable")}
                    {passkey.backedUp ? ` · ${t("synced")}` : ""}
                  </p>
                  {removalBlocked ? <p className="mt-1 text-xs text-base-content/60">{t("lastBlocked")}</p> : null}
                </div>
                <button
                  className="btn btn-ghost btn-sm text-error"
                  disabled={busy || removalBlocked}
                  type="button"
                  onClick={() => void start({ id: passkey.id, kind: "remove" })}
                >
                  {t("remove", { name: passkey.name })}
                </button>
              </li>
            );
          })}
        </ul>
      </AsyncSection>

      {pending && configuration ? (
        <div
          className="mt-5 rounded-xl border border-base-content/10 bg-base-content/[0.03] p-4"
          aria-labelledby="passkey-verify-heading"
        >
          <h3 id="passkey-verify-heading" className="font-semibold">
            {t("verifyBefore", { action: pending.kind === "add" ? t("adding") : t("removing") })}
          </h3>
          {pending.kind === "add" ? (
            <div className="mt-4 max-w-md">
              <Field
                id="new-passkey-name"
                className="input mt-2 w-full"
                label={t("name")}
                maxLength={80}
                placeholder={t("devicePlaceholder")}
                value={name}
                error={fieldErrors.name}
                onChange={event => {
                  setName(event.target.value);
                  clear("name");
                }}
              />
            </div>
          ) : null}
          {removingOnlyPasskey ? (
            <p className="mt-2 text-sm leading-6 text-base-content/60">{t("onlyDescription")}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {configuration.methods.passkey && passkeys.length > 0 ? (
              <button
                className="btn btn-outline btn-sm"
                disabled={busy}
                type="button"
                onClick={() => void verifyWithPasskey()}
              >
                {t("verifyPasskey")}
              </button>
            ) : null}
            <button className="btn btn-ghost btn-sm" disabled={busy} type="button" onClick={resetVerification}>
              {t("cancel")}
            </button>
          </div>
          {configuration.methods.emailOtp ? (
            otpSent ? (
              <form className="mt-4 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => void verifyCode(event)}>
                <div className="grow">
                  <Field
                    id="passkey-verification-code"
                    className="input mt-2 w-full"
                    label={t("code")}
                    format="oneTimeCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    error={fieldErrors.otp}
                    onChange={event => {
                      setOtp(event.target.value.replace(/\D/g, ""));
                      clear("otp");
                    }}
                    required
                  />
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
                  {t("verify")}
                </button>
              </form>
            ) : (
              <form className="mt-4 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => void sendCode(event)}>
                <div className="grow">
                  <Field
                    id="passkey-verification-email"
                    className="input mt-2 w-full"
                    label={t("email")}
                    type="email"
                    autoComplete="email"
                    value={email}
                    error={fieldErrors.email}
                    onChange={event => {
                      setEmail(event.target.value);
                      clear("email");
                    }}
                    required
                  />
                </div>
                <button className="btn btn-outline btn-sm" disabled={busy} type="submit">
                  {t("sendCode")}
                </button>
              </form>
            )
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p className="mt-4 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
