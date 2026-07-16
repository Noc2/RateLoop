"use client";

import { FormEvent, useEffect, useState } from "react";
import { betterAuthClient, exchangeBetterAuthSession, readBrowserAuthConfiguration } from "~~/lib/auth/client";

function safeReturnPath() {
  const value = new URL(window.location.href).searchParams.get("returnTo");
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/agents";
}

export function BetterAuthSignIn() {
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof readBrowserAuthConfiguration>> | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readBrowserAuthConfiguration()
      .then(setConfiguration)
      .catch(() => setConfiguration(null));
    if (new URL(window.location.href).searchParams.get("exchange") === "1") {
      void finishSignIn();
    }
  }, []);

  async function finishSignIn() {
    setBusy(true);
    setError(null);
    try {
      await exchangeBetterAuthSession();
      await betterAuthClient.signOut().catch(() => undefined);
      window.location.assign(safeReturnPath());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finish sign-in.");
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await betterAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
    if (result.error) setError(result.error.message || "Unable to send the sign-in code.");
    else setOtpSent(true);
    setBusy(false);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await betterAuthClient.signIn.emailOtp({ email, otp });
    if (result.error) {
      setError(result.error.message || "The sign-in code is invalid or expired.");
      setBusy(false);
      return;
    }
    setVerified(true);
    setBusy(false);
  }

  async function signInWithPasskey() {
    setBusy(true);
    setError(null);
    const result = await betterAuthClient.signIn.passkey();
    if (result.error) {
      setError(result.error.message || "Passkey sign-in failed.");
      setBusy(false);
      return;
    }
    await finishSignIn();
  }

  async function addPasskey() {
    setBusy(true);
    setError(null);
    const result = await betterAuthClient.passkey.addPasskey({ name: "RateLoop passkey" });
    if (result.error) setError(result.error.message || "Unable to add this passkey.");
    else await finishSignIn();
    setBusy(false);
  }

  async function social(provider: "apple" | "google") {
    setBusy(true);
    setError(null);
    const callbackURL = `${window.location.origin}/sign-in?exchange=1&returnTo=${encodeURIComponent(safeReturnPath())}`;
    const result = await betterAuthClient.signIn.social({ provider, callbackURL });
    if (result.error) {
      setError(result.error.message || `Unable to sign in with ${provider}.`);
      setBusy(false);
    }
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
              className="btn rateloop-secondary-action"
              disabled={busy || !configuration.methods.google}
              onClick={() => void social("google")}
            >
              Continue with Google
            </button>
            <button
              className="btn rateloop-secondary-action"
              disabled={busy || !configuration.methods.apple}
              onClick={() => void social("apple")}
            >
              Continue with Apple
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
