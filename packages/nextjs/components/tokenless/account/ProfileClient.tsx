"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Profile = {
  principalAddress: string;
  displayName: string | null;
  profileDisplayName: string | null;
  providerDisplayName: string | null;
  updatedAt: string | null;
};

type Session = {
  authenticated: boolean;
  address?: string;
  authProvider?: string;
  email?: string | null;
  displayName?: string | null;
  expiresAt?: string;
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    const [profileBody, sessionBody] = await Promise.all([
      readJson(await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" })),
      readJson(await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })),
    ]);
    const nextProfile = profileBody as unknown as Profile;
    setProfile(nextProfile);
    setDisplayName(nextProfile.profileDisplayName ?? "");
    setSession(sessionBody as unknown as Session);
  }, []);

  useEffect(() => {
    void refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Unable to load your account."));
  }, [refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = await readJson(
        await fetch("/api/account/profile", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        }),
      );
      const nextProfile = body as unknown as Profile;
      setProfile(nextProfile);
      setDisplayName(nextProfile.profileDisplayName ?? "");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Profile</p>
        <h2 className="mt-2 text-xl font-semibold">How RateLoop addresses you</h2>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={save}>
          <label className="grow text-sm text-base-content/60">
            Display name
            <input
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              maxLength={80}
              placeholder={profile?.providerDisplayName ?? "Your private name"}
            />
          </label>
          <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
        {saved ? <p className="mt-3 text-sm text-emerald-100">Profile saved.</p> : null}
        <details className="mt-6 border-t border-white/10 pt-5 text-sm">
          <summary className="cursor-pointer font-medium text-base-content/70">Sign-in details</summary>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-base-content/45">Provider</dt>
              <dd className="mt-1 text-base-content/80">{session?.authProvider ?? "Checking…"}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Email</dt>
              <dd className="mt-1 break-all text-base-content/80">{session?.email ?? "Not provided"}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Account ID</dt>
              <dd className="mt-1 break-all font-mono text-xs text-base-content/65">
                {session?.address ?? "Checking…"}
              </dd>
            </div>
          </dl>
        </details>
        {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      </section>
    </div>
  );
}
