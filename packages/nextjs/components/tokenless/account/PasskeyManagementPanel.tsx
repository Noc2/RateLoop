"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { betterAuthClient, readBrowserAuthConfiguration } from "~~/lib/auth/client";

type PasskeySummary = {
  backedUp: boolean;
  createdAt: string | null;
  deviceType: string | null;
  id: string;
  name: string;
};

type PendingAction = { kind: "add" } | { id: string; kind: "remove" };

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "Unable to update passkeys.",
    );
  }
  return body;
}

function addedLabel(createdAt: string | null) {
  if (!createdAt) return "Added date unavailable";
  return `Added ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(createdAt))}`;
}

export function PasskeyManagementPanel() {
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await jsonRequest<{ canRemoveLast: boolean; passkeys: PasskeySummary[] }>("/api/account/passkeys");
    setPasskeys(result.passkeys);
    setCanRemoveLast(result.canRemoveLast);
  }, []);

  useEffect(() => {
    void refresh()
      .catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load passkeys."))
      .finally(() => setLoading(false));
  }, [refresh]);

  function resetVerification() {
    setPending(null);
    setConfiguration(null);
    setEmail("");
    setOtp("");
    setOtpSent(false);
  }

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function start(action: PendingAction) {
    setPending(action);
    await run(async () => {
      await betterAuthClient.signOut().catch(() => undefined);
      setConfiguration(await readBrowserAuthConfiguration());
    }, "Unable to load verification options.");
  }

  async function finish() {
    if (!pending) return;
    if (pending.kind === "add") {
      const authorized = await jsonRequest<{ expiresAt: string; proof: string }>("/api/account/passkeys", {
        body: JSON.stringify({ action: "passkey_add" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await betterAuthClient.passkey.addPasskey({
        fetchOptions: { headers: { "x-rateloop-passkey-action-proof": authorized.proof } },
        name: name.trim() || "Passkey",
      });
      if (result.error) throw new Error(result.error.message || "Unable to add this passkey.");
      setName("");
      setNotice("Passkey added.");
    } else {
      await jsonRequest<{ removed: true }>(`/api/account/passkeys/${encodeURIComponent(pending.id)}`, {
        method: "DELETE",
      });
      setNotice("Passkey removed.");
    }
    await betterAuthClient.signOut().catch(() => undefined);
    resetVerification();
    await refresh();
  }

  async function verifyWithPasskey() {
    await run(async () => {
      const result = await betterAuthClient.signIn.passkey();
      if (result.error) throw new Error(result.error.message || "Passkey verification failed.");
      await finish();
    }, "Passkey verification failed.");
    await betterAuthClient.signOut().catch(() => undefined);
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await betterAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
      if (result.error) throw new Error(result.error.message || "Unable to send the sign-in code.");
      setOtpSent(true);
    }, "Unable to send the sign-in code.");
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const result = await betterAuthClient.signIn.emailOtp({ email, otp });
      if (result.error) throw new Error(result.error.message || "The sign-in code is invalid or expired.");
      await finish();
    }, "Unable to verify the sign-in code.");
    await betterAuthClient.signOut().catch(() => undefined);
  }

  const removingOnlyPasskey = pending?.kind === "remove" && passkeys.length === 1;

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="passkeys-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="passkeys-heading" className="text-lg font-semibold">
            Passkeys
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">Sign in with your device instead of a code.</p>
        </div>
        <button
          className="btn rateloop-secondary-action btn-sm"
          disabled={busy}
          type="button"
          onClick={() => void start({ kind: "add" })}
        >
          Add passkey
        </button>
      </div>

      {loading ? <p className="mt-5 text-sm text-base-content/50">Loading passkeys…</p> : null}
      {!loading && passkeys.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">No passkey added yet.</p>
      ) : null}
      {passkeys.length > 0 ? (
        <ul className="mt-5 space-y-3" aria-label="Your passkeys">
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
                  <p className="mt-1 text-xs text-base-content/50">
                    {addedLabel(passkey.createdAt)}
                    {passkey.backedUp ? " · Synced" : ""}
                  </p>
                  {removalBlocked ? (
                    <p className="mt-1 text-xs text-base-content/60">Add another passkey before removing this one.</p>
                  ) : null}
                </div>
                <button
                  className="btn btn-ghost btn-sm text-error"
                  disabled={busy || removalBlocked}
                  type="button"
                  onClick={() => void start({ id: passkey.id, kind: "remove" })}
                >
                  Remove {passkey.name}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {pending && configuration ? (
        <div
          className="mt-5 rounded-xl border border-base-content/10 bg-base-content/[0.03] p-4"
          aria-labelledby="passkey-verify-heading"
        >
          <h3 id="passkey-verify-heading" className="font-semibold">
            Verify before {pending.kind === "add" ? "adding" : "removing"}
          </h3>
          {pending.kind === "add" ? (
            <label className="mt-4 block max-w-md text-sm" htmlFor="new-passkey-name">
              Passkey name
              <input
                id="new-passkey-name"
                className="input mt-2 w-full"
                maxLength={80}
                placeholder="This device"
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </label>
          ) : null}
          {removingOnlyPasskey ? (
            <p className="mt-2 text-sm leading-6 text-base-content/60">
              Your verified email or another linked sign-in will remain available.
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-3">
            {configuration.methods.passkey && passkeys.length > 0 ? (
              <button
                className="btn btn-outline btn-sm"
                disabled={busy}
                type="button"
                onClick={() => void verifyWithPasskey()}
              >
                Verify with passkey
              </button>
            ) : null}
            <button className="btn btn-ghost btn-sm" disabled={busy} type="button" onClick={resetVerification}>
              Cancel
            </button>
          </div>
          {configuration.methods.emailOtp ? (
            otpSent ? (
              <form className="mt-4 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => void verifyCode(event)}>
                <label className="grow text-sm" htmlFor="passkey-verification-code">
                  Sign-in code
                  <input
                    id="passkey-verification-code"
                    className="input mt-2 w-full"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={event => setOtp(event.target.value)}
                    required
                  />
                </label>
                <button className="btn btn-primary btn-sm" disabled={busy} type="submit">
                  Verify
                </button>
              </form>
            ) : (
              <form className="mt-4 flex max-w-md flex-wrap items-end gap-3" onSubmit={event => void sendCode(event)}>
                <label className="grow text-sm" htmlFor="passkey-verification-email">
                  Account email
                  <input
                    id="passkey-verification-email"
                    className="input mt-2 w-full"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    required
                  />
                </label>
                <button className="btn btn-outline btn-sm" disabled={busy} type="submit">
                  Send code
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
      {error ? (
        <p className="mt-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
