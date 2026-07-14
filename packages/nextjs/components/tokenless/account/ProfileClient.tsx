"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { InvitationRedemption } from "~~/components/tokenless/account/InvitationRedemption";

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

type MembershipResponse = {
  memberships: Array<{
    projectName: string | null;
    cohortName: string | null;
    source: string | null;
    status: string | null;
    assignmentCount: number;
    activeAssignmentCount: number;
  }>;
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
  const [memberships, setMemberships] = useState<MembershipResponse["memberships"]>([]);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    const [profileBody, sessionBody, membershipBody] = await Promise.all([
      readJson(await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin" })),
      readJson(await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })),
      readJson(
        await fetch("/api/account/assurance/reviewer-invitations", { cache: "no-store", credentials: "same-origin" }),
      ),
    ]);
    const nextProfile = profileBody as unknown as Profile;
    setProfile(nextProfile);
    setDisplayName(nextProfile.profileDisplayName ?? "");
    setSession(sessionBody as unknown as Session);
    setMemberships((membershipBody.memberships ?? []) as MembershipResponse["memberships"]);
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
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Private profile</p>
        <h2 className="mt-2 text-xl font-semibold">How RateLoop addresses you</h2>
        <p className="mt-3 text-sm leading-6 text-base-content/60">
          This preference is private to your account. It does not replace verified sign-in information or change
          eligibility, payout, or workspace permissions.
        </p>
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
        <dl className="mt-6 grid gap-4 border-t border-white/10 pt-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-base-content/45">Sign-in provider</dt>
            <dd className="mt-1 text-base-content/80">{session?.authProvider ?? "Checking…"}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Email</dt>
            <dd className="mt-1 break-all text-base-content/80">{session?.email ?? "Not provided"}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Principal</dt>
            <dd className="mt-1 break-all font-mono text-xs text-base-content/65">{session?.address ?? "Checking…"}</dd>
          </div>
        </dl>
        {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      </section>

      <InvitationRedemption onRedeemed={() => void refresh()} />

      <section className="surface-card rounded-2xl p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">Customer cohorts</p>
        <h2 className="mt-2 text-xl font-semibold">Your reviewer memberships</h2>
        {memberships.length ? (
          <div className="mt-5 space-y-3">
            {memberships.map((membership, index) => (
              <article
                key={`${membership.projectName}-${membership.cohortName}-${index}`}
                className="rounded-lg border border-white/10 bg-black/20 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{membership.cohortName ?? "Customer cohort"}</h3>
                    <p className="mt-1 text-xs text-base-content/50">{membership.projectName ?? "Private project"}</p>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-base-content/60">
                    {membership.status ?? "active"}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-base-content/55">
                  {membership.activeAssignmentCount} active assignment
                  {membership.activeAssignmentCount === 1 ? "" : "s"} · {membership.assignmentCount} total ·{" "}
                  {membership.source?.replaceAll("_", " ")}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-white/[0.04] p-4 text-sm leading-6 text-base-content/50">
            No customer cohort memberships yet. Redeemed invitations appear here after the customer accepts the
            membership.
          </p>
        )}
      </section>
    </div>
  );
}
