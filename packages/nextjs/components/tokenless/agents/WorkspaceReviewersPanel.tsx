"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { WorkspaceRequestScope } from "~~/lib/tokenless/workspaceRequestScope";

type WorkspaceReviewer = {
  principalAddress: string;
  status: "active" | "removed" | "left" | "expired";
  activatedAt: string | null;
  grants: Array<{
    grantId: string;
    maxPrivateSensitivity: "internal" | "confidential" | "restricted" | "regulated";
    validUntil: string | null;
    status: "active" | "expired" | "revoked";
  }>;
};

type ReviewerInvitation = {
  invitationId: string;
  tokenPrefix: string;
  hasAccountBinding: boolean;
  hasEmailBinding: boolean;
  intendedEmailDomain: string | null;
  accessExpiresAt: string | null;
  expiresAt: string | null;
  maximumRedemptions: number;
  redemptionCount: number;
  revokedAt: string | null;
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

function shortPrincipal(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function dateLabel(value: string | null) {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No expiry" : date.toLocaleDateString();
}

function invitationStatus(invitation: ReviewerInvitation) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt && new Date(invitation.expiresAt) <= new Date()) return "expired";
  if (invitation.redemptionCount >= invitation.maximumRedemptions) return "used";
  return "pending";
}

export function WorkspaceReviewersPanel({
  canManage = true,
  workspaceId,
}: {
  canManage?: boolean;
  workspaceId: string;
}) {
  const [reviewers, setReviewers] = useState<WorkspaceReviewer[]>([]);
  const [invitations, setInvitations] = useState<ReviewerInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [maxPrivateSensitivity, setMaxPrivateSensitivity] = useState<
    "internal" | "confidential" | "restricted" | "regulated"
  >("confidential");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());

  const load = useCallback(async () => {
    if (!workspaceId || !canManage) return;
    const request = workspaceRequests.begin(workspaceId, "reviewers:load");
    setLoading(true);
    try {
      const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
      const [reviewersBody, invitationsBody] = await Promise.all([
        readJson(
          await fetch(`${base}/reviewers`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        ),
        readJson(
          await fetch(`${base}/reviewer-invitations`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        ),
      ]);
      if (!request.isCurrent()) return;
      setReviewers((reviewersBody.reviewers ?? []) as WorkspaceReviewer[]);
      setInvitations((invitationsBody.invitations ?? []) as ReviewerInvitation[]);
      setError(null);
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [canManage, workspaceId, workspaceRequests]);

  useEffect(() => {
    workspaceRequests.selectWorkspace(workspaceId);
    setReviewers([]);
    setInvitations([]);
    setIssuedToken(null);
    setError(null);
    if (!canManage) {
      setLoading(false);
      return;
    }
    void load().catch(cause => {
      if (!workspaceRequests.isWorkspaceCurrent(workspaceId)) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "Unable to load reviewers.");
    });
  }, [canManage, load, workspaceId, workspaceRequests]);

  async function inviteReviewer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = workspaceRequests.begin(workspaceId, "reviewers:action");
    setBusyTarget("invite");
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/reviewer-invitations`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intendedEmail: email.trim() || null, maxPrivateSensitivity }),
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      const invitation = body.invitation as Record<string, unknown> | undefined;
      if (typeof invitation?.token !== "string") throw new Error("Invitation code was unavailable.");
      setIssuedToken(invitation.token);
      setEmail("");
      await load();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to invite the reviewer.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function removeReviewer(reviewer: WorkspaceReviewer) {
    if (!window.confirm(`Remove ${shortPrincipal(reviewer.principalAddress)} from this workspace's reviewers?`)) return;
    const request = workspaceRequests.begin(workspaceId, "reviewers:action");
    setBusyTarget(reviewer.principalAddress);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/reviewers/${encodeURIComponent(reviewer.principalAddress)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await load();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to remove the reviewer.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function revokeInvitation(invitation: ReviewerInvitation) {
    if (!window.confirm("Revoke this reviewer invitation?")) return;
    const request = workspaceRequests.begin(workspaceId, "reviewers:action");
    setBusyTarget(invitation.invitationId);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/reviewer-invitations/${encodeURIComponent(invitation.invitationId)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await load();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to revoke the invitation.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  if (!canManage) return null;
  const activeReviewers = reviewers.filter(reviewer => reviewer.status === "active");
  const pendingInvitations = invitations.filter(invitation => invitationStatus(invitation) === "pending");

  return (
    <section className="rounded-xl border border-white/10 p-5" aria-labelledby="workspace-reviewers-heading">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Reviewer access</p>
        <h2 id="workspace-reviewers-heading" className="mt-2 text-xl font-semibold">
          Reviewers
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-base-content/55">
          Reviewers can receive assigned private work. They do not get workspace access.
        </p>
      </div>

      <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" onSubmit={inviteReviewer}>
        <label className="min-w-0 flex-1 text-xs text-base-content/55">
          Email (optional)
          <input
            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="name@company.com"
          />
        </label>
        <label className="text-xs text-base-content/55">
          Private material limit
          <select
            className="select mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            value={maxPrivateSensitivity}
            onChange={event =>
              setMaxPrivateSensitivity(event.target.value as "internal" | "confidential" | "restricted" | "regulated")
            }
          >
            <option value="internal">Internal</option>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted</option>
            <option value="regulated">Regulated</option>
          </select>
        </label>
        <button className="rateloop-gradient-action min-h-12 px-5" disabled={busyTarget === "invite"}>
          {busyTarget === "invite" ? "Creating…" : "Invite reviewer"}
        </button>
      </form>

      {issuedToken ? (
        <OneTimeSecretNotice
          label="reviewer invitation code"
          value={issuedToken}
          onDismiss={() => setIssuedToken(null)}
        />
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold">Active reviewers</h3>
        {loading ? (
          <p className="mt-3 text-sm text-base-content/50" role="status">
            Loading reviewers…
          </p>
        ) : activeReviewers.length ? (
          <ul className="mt-3 space-y-2">
            {activeReviewers.map(reviewer => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3"
                key={reviewer.principalAddress}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{shortPrincipal(reviewer.principalAddress)}</p>
                  {reviewer.grants
                    .filter(grant => grant.status === "active")
                    .map(grant => (
                      <p className="mt-1 text-xs text-base-content/45" key={grant.grantId}>
                        Up to {grant.maxPrivateSensitivity} material · access expires {dateLabel(grant.validUntil)}
                      </p>
                    ))}
                </div>
                <button
                  className="btn btn-sm border-red-300/20 bg-red-300/[0.06] text-red-100"
                  type="button"
                  disabled={busyTarget === reviewer.principalAddress}
                  onClick={() => void removeReviewer(reviewer)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-base-content/50">No reviewers yet.</p>
        )}
      </div>

      {pendingInvitations.length ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <ul className="mt-3 space-y-2">
            {pendingInvitations.map(invitation => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3 text-sm"
                key={invitation.invitationId}
              >
                <span>
                  {invitation.hasEmailBinding ? "Email-bound" : "Invitation code"} · expires{" "}
                  {dateLabel(invitation.expiresAt)}
                </span>
                <button
                  className="text-xs text-red-200 underline underline-offset-4"
                  type="button"
                  disabled={busyTarget === invitation.invitationId}
                  onClick={() => void revokeInvitation(invitation)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
