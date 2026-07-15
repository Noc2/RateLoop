"use client";

import { useCallback, useEffect, useState } from "react";

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

export function PrivateGroupMembershipsPanel({ refreshKey }: { refreshKey: number }) {
  const [memberships, setMemberships] = useState<PrivateGroupMembership[]>([]);
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
  }, [loadMemberships, refreshKey]);

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
    <section
      id="private-groups"
      className="surface-card scroll-mt-24 rounded-2xl p-6"
      aria-labelledby="private-memberships-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private groups</p>
          <h2 id="private-memberships-heading" className="mt-2 text-xl font-semibold">
            Your memberships
          </h2>
        </div>
        <span className="rounded-md bg-white/[0.05] px-3 py-1.5 text-xs text-base-content/55">Profile bound</span>
      </div>
      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-base-content/50" role="status">
            <span className="loading loading-spinner loading-sm mr-2" /> Loading memberships…
          </p>
        ) : memberships.length ? (
          <div className="space-y-3">
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
          <p className="rounded-lg bg-white/[0.04] p-4 text-sm leading-6 text-base-content/50">
            No private-group memberships yet. Paste an invitation above to join one.
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
