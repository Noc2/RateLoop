"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { notifyBrowserAuthSessionChanged } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";

type Profile = {
  principalAddress: string;
  displayName: string | null;
  profileDisplayName: string | null;
  providerDisplayName: string | null;
  updatedAt: string | null;
};

export function ProfileClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const refresh = useCallback(async () => {
    const profileBody = await readJson<Profile>(
      await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" }),
      { fallbackMessage: "Unable to load your account." },
    );
    const nextProfile = profileBody;
    setProfile(nextProfile);
    setDisplayName(nextProfile.profileDisplayName ?? "");
  }, []);

  useEffect(() => {
    void refresh().catch(cause => capture(cause, "Unable to load your account."));
  }, [capture, refresh]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    clear();
    setSaved(false);
    try {
      const body = await readJson<Profile>(
        await fetch("/api/account/profile", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        }),
        { fallbackMessage: "Unable to save your profile." },
      );
      const nextProfile = body;
      setProfile(nextProfile);
      setDisplayName(nextProfile.profileDisplayName ?? "");
      notifyBrowserAuthSessionChanged();
      setSaved(true);
    } catch (cause) {
      capture(cause, "Unable to save your profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="profile-display-name-heading" className="text-xl font-semibold">
              Display name
            </h2>
          </div>
          <Link href="/settings/wallets" className="btn btn-sm rateloop-secondary-action px-3">
            Wallet settings
          </Link>
        </div>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={save}>
          <div className="grow">
            <Field
              id="profile-display-name"
              label="Display name"
              value={displayName}
              onChange={event => {
                setDisplayName(event.target.value);
                clear("displayName");
              }}
              className="input w-full border-white/10 bg-[var(--rateloop-field)]"
              maxLength={80}
              placeholder={profile?.providerDisplayName ?? "Your private name"}
              error={fieldErrors.displayName}
            />
          </div>
          <button type="submit" className="rateloop-gradient-action px-5" disabled={busy}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
        {saved ? <p className="mt-3 text-sm text-emerald-100">Profile saved.</p> : null}
        {formError ? (
          <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
            {formError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
