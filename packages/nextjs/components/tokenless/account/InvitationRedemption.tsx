"use client";

import { FormEvent, useState } from "react";

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function InvitationRedemption({ onRedeemed }: { onRedeemed: () => void }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch("/api/account/assurance/reviewer-invitations/redeem", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        }),
      );
      setToken("");
      setStatus(`Invitation accepted for cohort ${String(body.cohortId ?? "your customer cohort")}.`);
      onRedeemed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to redeem the invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Invitations</p>
          <h2 className="mt-2 text-xl font-semibold">Redeem a one-time invitation</h2>
        </div>
        <span className="rounded-md bg-white/[0.05] px-3 py-1.5 text-xs text-base-content/55">Account bound</span>
      </div>
      <p className="mt-5 text-sm leading-6 text-base-content/60">
        Paste the token directly instead of putting it in a URL. It is single-use, stored only as a hash, and can be
        redeemed only by the intended signed-in account.
      </p>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row" onSubmit={redeem}>
        <label className="grow text-sm text-base-content/60">
          Invitation token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={event => setToken(event.target.value)}
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
            placeholder="rli_…"
            required
          />
        </label>
        <button
          type="submit"
          className="rateloop-gradient-action self-end px-5 sm:mb-0"
          disabled={busy || !token.trim()}
        >
          {busy ? "Redeeming…" : "Redeem invitation"}
        </button>
      </form>
      {status ? <p className="mt-4 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">{status}</p> : null}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
