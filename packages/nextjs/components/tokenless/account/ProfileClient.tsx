"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Profile = {
  principalAddress: string;
  displayName: string | null;
  profileDisplayName: string | null;
  providerDisplayName: string | null;
  updatedAt: string | null;
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
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    const profileBody = await readJson(
      await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" }),
    );
    const nextProfile = profileBody as unknown as Profile;
    setProfile(nextProfile);
    setDisplayName(nextProfile.profileDisplayName ?? "");
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
        <h2 id="profile-display-name-heading" className="mt-2 text-xl font-semibold">
          Display name
        </h2>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={save}>
          <div className="grow">
            <input
              aria-labelledby="profile-display-name-heading"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              className="input w-full border-white/10 bg-[var(--rateloop-field)]"
              maxLength={80}
              placeholder={profile?.providerDisplayName ?? "Your private name"}
            />
          </div>
          <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
        {saved ? <p className="mt-3 text-sm text-emerald-100">Profile saved.</p> : null}
        {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      </section>
    </div>
  );
}
