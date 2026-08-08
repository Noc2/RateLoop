"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { BETTER_AUTH_SIGN_IN_TEST_IDS } from "./browserSelectors";
import { normalizeSignInReturnPath } from "./signInReturnPath";
import { useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { Button } from "~~/components/tokenless/ui/Button";
import {
  type BrowserSessionResponse,
  betterAuthClient,
  exchangeBetterAuthSession,
  logoutBrowserSession,
  readBrowserAuthConfiguration,
  readBrowserSession,
} from "~~/lib/auth/client";

const RESEND_COOLDOWN_SECONDS = 30;

export async function runBetterAuthAction({
  action,
  fallbackMessage,
  setBusy,
  setError,
}: {
  action: () => Promise<void>;
  fallbackMessage: string;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}) {
  setBusy(true);
  setError(null);
  try {
    await action();
  } catch {
    setError(fallbackMessage);
  } finally {
    setBusy(false);
  }
}

export function maskedEmailDestination(value: string, fallback = "your email address") {
  const separator = value.lastIndexOf("@");
  if (separator <= 0 || separator === value.length - 1) return fallback;
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const visible = local.length === 1 ? "•" : `${local[0]}${"•".repeat(Math.min(4, local.length - 1))}`;
  return `${visible}@${domain}`;
}

export function visibleSignInMethods(methods: {
  emailOtp: boolean;
  passkey: boolean;
  google: boolean;
  apple: boolean;
  sso: boolean;
}) {
  return {
    emailForm: methods.emailOtp || methods.sso,
    emailCode: methods.emailOtp,
    passkey: methods.passkey,
    google: methods.google,
    apple: methods.apple,
    sso: methods.sso,
  };
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.89h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.39l-3.24-2.53c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.05v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.91A6.02 6.02 0 0 1 6.08 12c0-.66.11-1.3.31-1.91v-2.6H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.51l3.34-2.6Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.95 5.49l3.34 2.6C7.18 7.72 9.39 5.96 12 5.96Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.02-2.37 1.94-3.52 2.03-3.58a4.36 4.36 0 0 0-3.43-1.86c-1.44-.15-2.84.86-3.57.86-.75 0-1.88-.84-3.1-.82a4.56 4.56 0 0 0-3.84 2.34c-1.66 2.87-.42 7.1 1.17 9.42.8 1.14 1.73 2.42 2.95 2.37 1.2-.05 1.64-.76 3.08-.76 1.42 0 1.84.76 3.09.73 1.28-.02 2.09-1.14 2.86-2.3a9.35 9.35 0 0 0 1.31-2.68 4.1 4.1 0 0 1-2.55-3.72ZM14.7 5.57A4.18 4.18 0 0 0 15.66 2a4.26 4.26 0 0 0-2.75 1.7 3.98 3.98 0 0 0-.99 3.46 3.53 3.53 0 0 0 2.78-1.59Z" />
    </svg>
  );
}

function safeReturnPath() {
  const value = new URL(window.location.href).searchParams.get("returnTo");
  return normalizeSignInReturnPath(value, window.location.origin);
}

export function BetterAuthSignIn() {
  const t = useTranslations("auth.signIn");
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof readBrowserAuthConfiguration>> | null>(
    null,
  );
  const [session, setSession] = useState<BrowserSessionResponse | null | undefined>(undefined);
  const [configurationError, setConfigurationError] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verified, setVerified] = useState(false);
  const [completingExchange, setCompletingExchange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfiguration = useCallback(async () => {
    setConfigurationError(false);
    try {
      setConfiguration(await readBrowserAuthConfiguration());
    } catch {
      setConfiguration(null);
      setConfigurationError(true);
    }
  }, []);

  const perform = useCallback(
    (action: () => Promise<void>, fallbackMessage: string) =>
      runBetterAuthAction({ action, fallbackMessage, setBusy, setError }),
    [],
  );

  const loadSession = useCallback(async () => {
    try {
      setSession(await readBrowserSession());
    } catch {
      setSession(null);
    }
  }, []);

  const finishSignIn = useCallback(async () => {
    await perform(async () => {
      await exchangeBetterAuthSession();
      await betterAuthClient.signOut().catch(() => undefined);
      window.location.assign(safeReturnPath());
    }, t("errors.finish"));
  }, [perform, t]);

  useEffect(() => {
    if (new URL(window.location.href).searchParams.get("exchange") === "1") {
      setCompletingExchange(true);
      void finishSignIn().then(() => {
        setCompletingExchange(false);
        void loadConfiguration();
        void loadSession();
      });
      return;
    }
    void loadConfiguration();
    void loadSession();
  }, [finishSignIn, loadConfiguration, loadSession]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timeout = window.setTimeout(() => setResendCooldown(value => Math.max(0, value - 1)), 1_000);
    return () => window.clearTimeout(timeout);
  }, [resendCooldown]);

  async function requestCode() {
    await perform(async () => {
      const result = await betterAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) throw new Error("send failed");
      setOtp("");
      setOtpSent(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    }, t("errors.sendCode"));
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    await requestCode();
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const result = await betterAuthClient.signIn.emailOtp({ email, otp });
      if (result.error) throw new Error("verification failed");
      else setVerified(true);
    }, t("errors.invalidCode"));
  }

  async function signInWithPasskey() {
    await perform(async () => {
      const result = await betterAuthClient.signIn.passkey();
      if (result.error) throw new Error("passkey failed");
      else {
        await exchangeBetterAuthSession();
        await betterAuthClient.signOut().catch(() => undefined);
        window.location.assign(safeReturnPath());
      }
    }, t("errors.passkey"));
  }

  async function signInWithSso() {
    const callbackURL = `${window.location.origin}/sign-in?exchange=1&returnTo=${encodeURIComponent(safeReturnPath())}`;
    await perform(async () => {
      const result = await betterAuthClient.signIn.sso({ email, callbackURL });
      if (result.error) throw new Error("SSO failed");
    }, t("errors.sso"));
  }

  async function addPasskey() {
    await perform(async () => {
      const result = await betterAuthClient.passkey.addPasskey({ name: "RateLoop passkey" });
      if (result.error) throw new Error("passkey registration failed");
      else {
        await exchangeBetterAuthSession();
        await betterAuthClient.signOut().catch(() => undefined);
        window.location.assign(safeReturnPath());
      }
    }, t("errors.addPasskey"));
  }

  async function social(provider: "apple" | "google") {
    const callbackURL = `${window.location.origin}/sign-in?exchange=1&returnTo=${encodeURIComponent(safeReturnPath())}`;
    await perform(
      async () => {
        const result = await betterAuthClient.signIn.social({ provider, callbackURL });
        if (result.error) throw new Error(`${provider} failed`);
      },
      t("errors.social", { provider: provider === "google" ? "Google" : "Apple" }),
    );
  }

  async function switchAccount() {
    await perform(async () => {
      await logoutBrowserSession();
      setSession(null);
      setEmail("");
      setOtp("");
      setOtpSent(false);
      setVerified(false);
      setResendCooldown(0);
    }, t("errors.signOut"));
  }

  if (completingExchange || session === undefined) {
    return (
      <p className="text-sm text-base-content/60" role="status">
        {t("checkingAccount")}
      </p>
    );
  }
  if (session) {
    const accountLabel = session.displayName?.trim() || t("yourAccount");
    return (
      <section className="space-y-4" aria-labelledby="active-account-heading">
        <h2 id="active-account-heading" className="text-lg font-semibold text-base-content">
          {t("alreadySignedIn")}
        </h2>
        <Button
          variant="primary"
          size="none"
          block
          disabled={busy}
          onClick={() => window.location.assign(safeReturnPath())}
          type="button"
        >
          {t("continueAs", { account: accountLabel })}
        </Button>
        <button
          className="btn btn-outline min-h-11 w-full"
          disabled={busy}
          onClick={() => void switchAccount()}
          type="button"
        >
          {t("anotherAccount")}
        </button>
        {error ? (
          <p className="text-sm leading-6 text-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  if (configurationError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-error" role="alert">
          {t("errors.configuration")}
        </p>
        <button className="btn btn-outline min-h-11 w-full" type="button" onClick={() => void loadConfiguration()}>
          {t("tryAgain")}
        </button>
      </div>
    );
  }
  if (!configuration) {
    return <p className="text-sm text-base-content/60">{t("checkingConfiguration")}</p>;
  }
  if (!configuration.configured) {
    return (
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-base-content/70">
        {t("notConfigured")}
      </p>
    );
  }

  const visibleMethods = visibleSignInMethods(configuration.methods);
  const hasAlternativeSignIn = visibleMethods.passkey || visibleMethods.google || visibleMethods.apple;

  return (
    <div className="space-y-5">
      {verified ? (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-base-content/70">{t("verified")}</p>
          <Button variant="primary" size="none" block type="button" disabled={busy} onClick={() => void finishSignIn()}>
            {t("finish")}
          </Button>
          <button className="btn btn-outline min-h-11 w-full" disabled={busy} onClick={() => void addPasskey()}>
            {t("addPasskey")}
          </button>
        </div>
      ) : otpSent && visibleMethods.emailCode ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-base-content/65" role="status">
            {t("sentCode", { email: maskedEmailDestination(email, t("maskedEmailFallback")) })}
          </p>
          <form className="space-y-4" onSubmit={verifyCode}>
            <Field
              id="rateloop-otp"
              label={t("sixDigitCode")}
              className="font-mono tracking-[0.25em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              value={otp}
              onChange={event => {
                setError(null);
                setOtp(event.target.value.replace(/\D/g, ""));
              }}
            />
            <Button variant="primary" size="none" block type="submit" disabled={busy || otp.length !== 6}>
              {t("verifyCode")}
            </Button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="btn btn-outline min-h-11 w-full"
              disabled={busy}
              onClick={() => {
                setError(null);
                setOtp("");
                setOtpSent(false);
                setResendCooldown(0);
              }}
              type="button"
            >
              {t("changeEmail")}
            </button>
            <button
              className="btn btn-outline min-h-11 w-full"
              disabled={busy || resendCooldown > 0}
              onClick={() => void requestCode()}
              type="button"
            >
              {resendCooldown > 0 ? t("resendIn", { seconds: resendCooldown }) : t("resendCode")}
            </button>
          </div>
        </div>
      ) : visibleMethods.emailForm ? (
        <form className="space-y-4" onSubmit={sendCode}>
          <Field
            id="rateloop-email"
            data-testid={BETTER_AUTH_SIGN_IN_TEST_IDS.emailInput}
            label={t("emailAddress")}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={event => {
              setError(null);
              setEmail(event.target.value);
            }}
          />
          {visibleMethods.emailCode ? (
            <Button variant="primary" size="none" block type="submit" disabled={busy}>
              {t("emailCode")}
            </Button>
          ) : null}
          {visibleMethods.sso ? (
            <button
              className="btn btn-outline min-h-11 w-full"
              disabled={busy || !email.includes("@")}
              onClick={() => void signInWithSso()}
              type="button"
            >
              {t("companySso")}
            </button>
          ) : null}
        </form>
      ) : null}

      {!verified && hasAlternativeSignIn ? (
        <>
          {visibleMethods.emailForm ? (
            <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-base-content/35">
              <span className="h-px grow bg-base-content/10" />
              {t("or")}
              <span className="h-px grow bg-base-content/10" />
            </div>
          ) : null}
          {visibleMethods.passkey ? (
            <button
              className="btn btn-outline min-h-11 w-full"
              disabled={busy}
              onClick={() => void signInWithPasskey()}
            >
              {t("passkey")}
            </button>
          ) : null}
          {visibleMethods.google || visibleMethods.apple ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {visibleMethods.google ? (
                <Button
                  variant="secondary"
                  size="none"
                  className="gap-3"
                  type="button"
                  disabled={busy}
                  onClick={() => void social("google")}
                >
                  <GoogleIcon />
                  {t("google")}
                </Button>
              ) : null}
              {visibleMethods.apple ? (
                <Button
                  variant="secondary"
                  size="none"
                  className="gap-3"
                  type="button"
                  disabled={busy}
                  onClick={() => void social("apple")}
                >
                  <AppleIcon />
                  {t("apple")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="text-sm leading-6 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
