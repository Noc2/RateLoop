"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { WorkspaceRequestScope } from "~~/lib/tokenless/workspaceRequestScope";

type WorkspaceAccessRole = "owner" | "admin" | "member" | "billing";

type WorkspaceMember = {
  principalId: string;
  displayName: string | null;
  email: string | null;
  accessRole: WorkspaceAccessRole;
  managedBy: "sso" | "scim" | null;
  joinedAt: string | null;
};

type WorkspaceInvitation = {
  inviteId: string;
  tokenPrefix: string | null;
  accessRole: Exclude<WorkspaceAccessRole, "owner">;
  hasAccountBinding: boolean;
  hasEmailBinding: boolean;
  status: "pending" | "redeemed" | "expired" | "revoked";
  expiresAt: string | null;
};

type MembersResponse = {
  viewerPrincipalId: string;
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
};

class RequestFailure extends Error {}

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new RequestFailure(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function shortPrincipal(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function roleLabel(value: WorkspaceAccessRole) {
  return value[0]!.toUpperCase() + value.slice(1);
}

function dateLabel(value: string | null) {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No expiry" : date.toLocaleDateString();
}

export function WorkspaceMembersPanel({ canManage, workspaceId }: { canManage: boolean; workspaceId: string }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [viewerPrincipalId, setViewerPrincipalId] = useState("");
  const [email, setEmail] = useState("");
  const [accessRole, setAccessRole] = useState<Exclude<WorkspaceAccessRole, "owner">>("member");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());

  const loadMembers = useCallback(async () => {
    if (!workspaceId || !canManage) return;
    const request = workspaceRequests.begin(workspaceId, "members:load");
    setLoading(true);
    try {
      const body = (await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/members`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        }),
      )) as MembersResponse;
      if (!request.isCurrent()) return;
      setMembers(body.members);
      setInvitations(body.invitations);
      setViewerPrincipalId(body.viewerPrincipalId);
      setError(null);
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [canManage, workspaceId, workspaceRequests]);

  useEffect(() => {
    workspaceRequests.selectWorkspace(workspaceId);
    setMembers([]);
    setInvitations([]);
    setViewerPrincipalId("");
    setIssuedToken(null);
    setError(null);
    if (!canManage) return;
    void loadMembers().catch(cause => {
      if (!workspaceRequests.isWorkspaceCurrent(workspaceId)) return;
      setLoading(false);
      setError(cause instanceof Error ? cause.message : "Unable to load workspace members.");
    });
  }, [canManage, loadMembers, workspaceId, workspaceRequests]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget("invite");
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/members`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intendedEmail: email, accessRole }),
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      const invitation = body.invitation as Record<string, unknown>;
      if (typeof invitation.token !== "string") throw new Error("Invitation code was unavailable.");
      setIssuedToken(invitation.token);
      setEmail("");
      await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to create the invitation.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function updateRole(member: WorkspaceMember, nextRole: Exclude<WorkspaceAccessRole, "owner">) {
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(member.principalId);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.principalId)}`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessRole: nextRole }),
            signal: request.signal,
          },
        ),
      );
      if (request.isCurrent()) await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to change the member role.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function removeMember(member: WorkspaceMember) {
    const label = member.displayName ?? member.email ?? shortPrincipal(member.principalId);
    if (!window.confirm(`Remove ${label} from this workspace?`)) return;
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(member.principalId);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.principalId)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to remove the member.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function revokeInvitation(invitation: WorkspaceInvitation) {
    if (!window.confirm("Revoke this workspace invitation?")) return;
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(invitation.inviteId);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/member-invitations/${encodeURIComponent(invitation.inviteId)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) setError(cause instanceof Error ? cause.message : "Unable to revoke the invitation.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  if (!canManage) return null;
  const pendingInvitations = invitations.filter(invitation => invitation.status === "pending");

  return (
    <section className="rounded-xl border border-white/10 p-5" aria-labelledby="workspace-members-heading">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Workspace access</p>
        <h2 id="workspace-members-heading" className="mt-2 text-xl font-semibold">
          Members
        </h2>
      </div>

      <h3 className="mt-5 text-sm font-semibold">Invite member</h3>
      <p className="mt-1 text-xs leading-5 text-base-content/45">
        Create a one-time code bound to their verified email, then send it to them privately.
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
        onSubmit={createInvitation}
      >
        <label className="text-xs text-base-content/55">
          Email
          <input
            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="name@company.com"
            required
          />
        </label>
        <label className="text-xs text-base-content/55">
          Role
          <select
            className="select mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            value={accessRole}
            onChange={event => setAccessRole(event.target.value as Exclude<WorkspaceAccessRole, "owner">)}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="billing">Billing</option>
          </select>
        </label>
        <button className="rateloop-gradient-action min-h-12 px-5" disabled={busyTarget === "invite"}>
          {busyTarget === "invite" ? "Creating…" : "Create invitation"}
        </button>
      </form>

      {issuedToken ? (
        <OneTimeSecretNotice
          label="workspace invitation code"
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
        <h3 className="text-sm font-semibold">People with workspace access</h3>
        {loading ? (
          <p className="mt-3 text-sm text-base-content/50" role="status">
            Loading members…
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {members.map(member => {
              const immutable =
                member.accessRole === "owner" || member.managedBy !== null || member.principalId === viewerPrincipalId;
              return (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3"
                  key={member.principalId}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {member.displayName ?? member.email ?? shortPrincipal(member.principalId)}
                    </p>
                    <p className="mt-1 text-xs text-base-content/45">
                      {member.displayName && member.email ? `${member.email} · ` : ""}
                      {member.managedBy
                        ? `Managed by ${member.managedBy.toUpperCase()}`
                        : shortPrincipal(member.principalId)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.accessRole === "owner" ? (
                      <span className="rounded-full bg-base-content/[0.08] px-3 py-1.5 text-xs font-semibold">
                        Owner
                      </span>
                    ) : (
                      <label>
                        <span className="sr-only">
                          Role for {member.displayName ?? member.email ?? member.principalId}
                        </span>
                        <select
                          className="select select-sm rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                          value={member.accessRole}
                          disabled={immutable || busyTarget === member.principalId}
                          onChange={event =>
                            void updateRole(member, event.target.value as Exclude<WorkspaceAccessRole, "owner">)
                          }
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                          <option value="billing">Billing</option>
                        </select>
                      </label>
                    )}
                    {!immutable ? (
                      <button
                        className="btn btn-sm border-red-300/20 bg-red-300/[0.06] text-red-100"
                        type="button"
                        disabled={busyTarget === member.principalId}
                        onClick={() => void removeMember(member)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingInvitations.length ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <h3 className="text-sm font-semibold">Pending invitations</h3>
          <ul className="mt-3 space-y-2">
            {pendingInvitations.map(invitation => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3 text-sm"
                key={invitation.inviteId}
              >
                <span>
                  {roleLabel(invitation.accessRole)} · expires {dateLabel(invitation.expiresAt)}
                </span>
                <button
                  className="text-xs text-red-200 underline underline-offset-4"
                  type="button"
                  disabled={busyTarget === invitation.inviteId}
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
