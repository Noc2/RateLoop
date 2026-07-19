"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { normalizeSignInReturnPath } from "./signInReturnPath";
import { betterAuthClient, exchangeBetterAuthSession, readBrowserAuthConfiguration } from "~~/lib/auth/client";

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
  } catch (cause) {
    setError(cause instanceof Error ? cause.message : fallbackMessage);
  } finally {
    setBusy(false);
  }
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
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof readBrowserAuthConfiguration>> | null>(
    null,
  );
  const [configurationError, setConfigurationError] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
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

  const finishSignIn = useCallback(async () => {
    await perform(async () => {
      await exchangeBetterAuthSession();
      await betterAuthClient.signOut().catch(() => undefined);
      window.location.assign(safeReturnPath());
    }, "Unable to finish sign-in.");
  }, [perform]);

  useEffect(() => {
    void loadConfiguration();
    if (new URL(window.location.href).searchParams.get("exchange") === "1") {
      void finishSignIn();
    }
  }, [finishSignIn, loadConfiguration]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const result = await betterAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) setError(result.error.message || "Unable to send the sign-in code.");
      else setOtpSent(true);
    }, "Unable to send the sign-in code.");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    await perform(async () => {
      const result = await betterAuthClient.signIn.emailOtp({ email, otp });
      if (result.error) setError(result.error.message || "The sign-in code is invalid or expired.");
      else setVerified(true);
    }, "Unable to verify the sign-in code.");
  }

  async function signInWithPasskey() {
    await perform(async () => {
      const result = await betterAuthClient.signIn.passkey();
      if (result.error) setError(result.error.message || "Passkey sign-in failed.");
      else {
        await exchangeBetterAuthSession();
        await betterAuthClient.signOut().catch(() => undefined);
        window.location.assign(safeReturnPath());
      }
    }, "Passkey sign-in failed.");
  }

  async function signInWithSso() {
    const callbackURL = `${window.location.origin}/sign-in?exchange=1&returnTo=${encodeURIComponent(safeReturnPath())}`;
    await perform(async () => {
      const result = await betterAuthClient.signIn.sso({ email, callbackURL });
      if (result.error) setError(result.error.message || "Company SSO is not available for this email domain.");
    }, "Company SSO sign-in failed.");
  }

  async function addPasskey() {
    await perform(async () => {
      const result = await betterAuthClient.passkey.addPasskey({ name: "RateLoop passkey" });
      if (result.error) setError(result.error.message || "Unable to add this passkey.");
      else {
        await exchangeBetterAuthSession();
        await betterAuthClient.signOut().catch(() => undefined);
        window.location.assign(safeReturnPath());
      }
    }, "Unable to add this passkey.");
  }

  async function social(provider: "apple" | "google") {
    const callbackURL = `${window.location.origin}/sign-in?exchange=1&returnTo=${encodeURIComponent(safeReturnPath())}`;
    await perform(async () => {
      const result = await betterAuthClient.signIn.social({ provider, callbackURL });
      if (result.error) setError(result.error.message || `Unable to sign in with ${provider}.`);
    }, `Unable to sign in with ${provider}.`);
  }

  if (configurationError) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-error" role="alert">
          Sign-in options could not be loaded.
        </p>
        <button className="btn btn-outline min-h-11 w-full" type="button" onClick={() => void loadConfiguration()}>
          Try again
        </button>
      </div>
    );
  }
  if (!configuration) {
    return <p className="text-sm text-base-content/60">Checking sign-in configuration…</p>;
  }
  if (!configuration.configured) {
    return (
      <p className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-base-content/70">
        Account sign-in is not configured for this deployment yet.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {verified ? (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-base-content/70">
            Email verified. Finish now, or add a passkey first for passwordless sign-in next time.
          </p>
          <button
            className="rateloop-gradient-action min-h-11 w-full px-4"
            disabled={busy}
            onClick={() => void finishSignIn()}
          >
            Finish sign-in
          </button>
          <button className="btn btn-outline min-h-11 w-full" disabled={busy} onClick={() => void addPasskey()}>
            Add a passkey and finish
          </button>
        </div>
      ) : otpSent ? (
        <form className="space-y-4" onSubmit={verifyCode}>
          <label className="block text-sm font-medium" htmlFor="rateloop-otp">
            Six-digit code
          </label>
          <input
            id="rateloop-otp"
            className="input input-bordered w-full font-mono tracking-[0.25em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={otp}
            onChange={event => setOtp(event.target.value.replace(/\D/g, ""))}
          />
          <button className="rateloop-gradient-action min-h-11 w-full px-4" disabled={busy || otp.length !== 6}>
            Verify code
          </button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={sendCode}>
          <label className="block text-sm font-medium" htmlFor="rateloop-email">
            Work email
          </label>
          <input
            id="rateloop-email"
            className="input input-bordered w-full"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          <button
            className="rateloop-gradient-action min-h-11 w-full px-4"
            disabled={busy || !configuration.methods.emailOtp}
          >
            Email me a code
          </button>
          {configuration.methods.sso ? (
            <button
              className="btn btn-outline min-h-11 w-full"
              disabled={busy || !email.includes("@")}
              onClick={() => void signInWithSso()}
              type="button"
            >
              Continue with company SSO
            </button>
          ) : null}
        </form>
      )}

      {!verified ? (
        <>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-base-content/35">
            <span className="h-px grow bg-base-content/10" />
            or
            <span className="h-px grow bg-base-content/10" />
          </div>
          <button
            className="btn btn-outline min-h-11 w-full"
            disabled={busy || !configuration.methods.passkey}
            onClick={() => void signInWithPasskey()}
          >
            Sign in with a passkey
          </button>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="btn rateloop-secondary-action gap-3"
              disabled={busy || !configuration.methods.google}
              onClick={() => void social("google")}
            >
              <GoogleIcon />
              Google
            </button>
            <button
              className="btn rateloop-secondary-action gap-3"
              disabled={busy || !configuration.methods.apple}
              onClick={() => void social("apple")}
            >
              <AppleIcon />
              Apple
            </button>
          </div>
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
