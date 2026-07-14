"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type InvitationPreview = {
  invitationId: string;
  groupId: string;
  groupName: string;
  groupPurpose: string;
  workspaceName: string;
  role: string;
  expiresAt: string | null;
  membershipExpiresAt: string | null;
  remainingRedemptions: number;
};

type PrivateGroupMembership = {
  groupId: string;
  groupName: string;
  groupPurpose: string;
  workspaceName: string;
  role: string;
  status: string;
  membershipExpiresAt: string | null;
  joinedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  policy: {
    defaultCompensation?: "unpaid" | "paid";
    worldIdRequired?: boolean;
    retentionDays?: number;
  };
};

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No expiry";
}

export function PrivateGroupMembershipsPanel() {
  const [memberships, setMemberships] = useState<PrivateGroupMembership[]>([]);
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const loadMemberships = useCallback(async () => {
    const body = await readJson(
      await fetch("/api/account/private-groups", { cache: "no-store", credentials: "same-origin" }),
    );
    setMemberships((body.memberships ?? []) as PrivateGroupMembership[]);
  }, []);

  useEffect(() => {
    let active = true;
    void loadMemberships()
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load private-group memberships.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadMemberships]);

  async function previewInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    setPreview(null);
    try {
      const body = await readJson(
        await fetch("/api/account/private-groups/invitations/preview", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        }),
      );
      setPreview(body.invitation as InvitationPreview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to preview the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function redeemInvitation() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch("/api/account/private-groups/invitations/redeem", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
        }),
      );
      setToken("");
      setPreview(null);
      await loadMemberships();
      setStatus("Private-group invitation accepted. Your durable membership is now active.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to redeem the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function leaveMembership(membership: PrivateGroupMembership) {
    if (!window.confirm(`Leave ${membership.groupName}? You will stop receiving new questions for this group.`)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(`/api/account/private-groups/${encodeURIComponent(membership.groupId)}/membership`, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "left_by_member" }),
        }),
      );
      await loadMemberships();
      setStatus(`You left ${membership.groupName}. Prior review records remain in the audit trail.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to leave the private group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="private-memberships-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private groups</p>
          <h2 id="private-memberships-heading" className="mt-2 text-xl font-semibold">
            Invitations and memberships
          </h2>
        </div>
        <span className="rounded-md bg-white/[0.05] px-3 py-1.5 text-xs text-base-content/55">Profile bound</span>
      </div>
      <p className="mt-5 text-sm leading-6 text-base-content/60">
        Paste a token here, review exactly which workspace and group it grants, then explicitly accept. Tokens are never
        read from a URL and are stored by RateLoop only as one-way hashes.
      </p>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={previewInvitation}>
        <label className="grow text-sm text-base-content/60">
          Private-group invitation token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={event => {
              setToken(event.target.value);
              setPreview(null);
              setStatus(null);
            }}
            className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
            placeholder="rlgi_…"
            required
          />
        </label>
        <button type="submit" className="rateloop-gradient-action px-5" disabled={busy || !token.trim()}>
          {busy ? "Checking…" : "Preview invitation"}
        </button>
      </form>

      {preview ? (
        <div className="mt-5 rounded-xl border border-[color:var(--rateloop-blue)]/20 bg-white/[0.03] p-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Confirm membership</p>
          <h3 className="mt-2 text-lg font-semibold">{preview.groupName}</h3>
          <p className="mt-1 text-sm text-base-content/50">{preview.workspaceName}</p>
          <p className="mt-3 text-sm leading-6 text-base-content/65">{preview.groupPurpose}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-base-content/45">Role</dt>
              <dd className="mt-1 capitalize">{preview.role}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Token expires</dt>
              <dd className="mt-1">{formatDate(preview.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Membership expires</dt>
              <dd className="mt-1">{formatDate(preview.membershipExpiresAt)}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" className="rateloop-gradient-action px-5" disabled={busy} onClick={redeemInvitation}>
              {busy ? "Joining…" : "Accept and join group"}
            </button>
            <button
              type="button"
              className="btn border-0 bg-white/[0.08]"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setToken("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-7 border-t border-white/10 pt-5">
        <h3 className="text-lg font-semibold">Your private memberships</h3>
        {loading ? (
          <p className="mt-4 text-sm text-base-content/50" role="status">
            <span className="loading loading-spinner loading-sm mr-2" /> Loading memberships…
          </p>
        ) : memberships.length ? (
          <div className="mt-4 space-y-3">
            {memberships.map(membership => (
              <article key={membership.groupId} className="surface-card-nested rounded-lg p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold">{membership.groupName}</h4>
                      <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs capitalize text-base-content/60">
                        {membership.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-base-content/50">{membership.workspaceName}</p>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-base-content/60">{membership.groupPurpose}</p>
                    <p className="mt-3 text-xs text-base-content/45">
                      {membership.policy.defaultCompensation === "paid" ? "Paid review" : "Unpaid internal review"} ·
                      World ID {membership.policy.worldIdRequired ? "required" : "optional"} · membership expires{" "}
                      {formatDate(membership.membershipExpiresAt)}
                    </p>
                  </div>
                  {membership.status === "active" ? (
                    <button
                      type="button"
                      className="btn btn-sm border border-red-300/20 bg-red-300/[0.06] text-red-100"
                      disabled={busy}
                      onClick={() => void leaveMembership(membership)}
                    >
                      Leave group
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-white/[0.04] p-4 text-sm leading-6 text-base-content/50">
            You have not joined any private groups. After you accept an invitation, the membership appears here and can
            be bound to private assurance runs by the workspace.
          </p>
        )}
      </div>

      {status ? (
        <p role="status" className="mt-5 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
