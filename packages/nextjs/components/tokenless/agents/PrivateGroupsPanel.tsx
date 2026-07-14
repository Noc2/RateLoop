"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Workspace = { workspaceId: string; name: string; role: string };
type GroupPolicy = {
  defaultCompensation?: "unpaid" | "paid";
  worldIdRequired?: boolean;
  retentionDays?: number;
  exportAllowed?: boolean;
  notificationDefaults?: { assignmentAvailable?: boolean };
};
type PrivateGroup = {
  groupId: string;
  name: string;
  purpose: string;
  status: string;
  memberCount: number;
  currentPolicyVersion: number;
  policy: GroupPolicy;
  policyHash: string;
};
type PrivateGroupMember = {
  principalAddress: string;
  role: string;
  status: string;
  membershipExpiresAt: string | null;
  joinedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
};
type PrivateGroupDetail = PrivateGroup & { members: PrivateGroupMember[] };
type PrivateGroupInvitation = {
  invitationId: string;
  tokenPrefix: string;
  hasAccountBinding: boolean;
  hasEmailBinding: boolean;
  intendedEmailDomain: string | null;
  expiresAt: string | null;
  membershipExpiresAt: string | null;
  maximumRedemptions: number;
  redemptionCount: number;
  revokedAt: string | null;
};
type IssuedInvitation = {
  invitationId: string;
  token: string;
  expiresAt: string;
  membershipExpiresAt: string | null;
  maximumRedemptions: number;
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

function shortAddress(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function invitationStatus(invitation: PrivateGroupInvitation) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt && new Date(invitation.expiresAt) <= new Date()) return "expired";
  if (invitation.redemptionCount >= invitation.maximumRedemptions) return "used";
  return "active";
}

export function PrivateGroupsPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [groups, setGroups] = useState<PrivateGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [group, setGroup] = useState<PrivateGroupDetail | null>(null);
  const [invitations, setInvitations] = useState<PrivateGroupInvitation[]>([]);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showIssueInvitation, setShowIssueInvitation] = useState(false);
  const [issuedInvitation, setIssuedInvitation] = useState<IssuedInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [compensation, setCompensation] = useState<"unpaid" | "paid">("unpaid");
  const [worldIdRequired, setWorldIdRequired] = useState(false);
  const [retentionDays, setRetentionDays] = useState("30");
  const [exportAllowed, setExportAllowed] = useState(false);
  const [assignmentNotifications, setAssignmentNotifications] = useState(true);

  const [inviteTtlDays, setInviteTtlDays] = useState("7");
  const [maximumRedemptions, setMaximumRedemptions] = useState("1");
  const [membershipExpiresAt, setMembershipExpiresAt] = useState("");
  const [intendedAccountAddress, setIntendedAccountAddress] = useState("");
  const [intendedEmail, setIntendedEmail] = useState("");
  const [intendedEmailDomain, setIntendedEmailDomain] = useState("");

  const loadGroup = useCallback(async (selectedWorkspaceId: string, selectedGroupId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId || !selectedGroupId) {
      setGroup(null);
      setInvitations([]);
      return;
    }
    const base = `/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/private-groups/${encodeURIComponent(selectedGroupId)}`;
    const [groupBody, invitationsBody] = await Promise.all([
      readJson(await fetch(base, { cache: "no-store", credentials: "same-origin", signal })),
      readJson(await fetch(`${base}/invitations`, { cache: "no-store", credentials: "same-origin", signal })),
    ]);
    if (signal?.aborted) return;
    setGroup(groupBody.group as PrivateGroupDetail);
    setInvitations((invitationsBody.invitations ?? []) as PrivateGroupInvitation[]);
  }, []);

  const loadGroups = useCallback(
    async (selectedWorkspaceId: string, preferredGroupId?: string, signal?: AbortSignal) => {
      if (!selectedWorkspaceId) {
        setGroups([]);
        setGroupId("");
        setGroup(null);
        setInvitations([]);
        return;
      }
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/private-groups`, {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }),
      );
      if (signal?.aborted) return;
      const nextGroups = (body.groups ?? []) as PrivateGroup[];
      const nextGroupId = nextGroups.some(candidate => candidate.groupId === preferredGroupId)
        ? preferredGroupId!
        : (nextGroups[0]?.groupId ?? "");
      setGroups(nextGroups);
      setGroupId(nextGroupId);
      await loadGroup(selectedWorkspaceId, nextGroupId, signal);
    },
    [loadGroup],
  );

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      try {
        const body = await readJson(
          await fetch("/api/account/workspaces", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        const manageable = ((body.workspaces ?? []) as Workspace[]).filter(workspace =>
          ["owner", "admin"].includes(workspace.role),
        );
        if (controller.signal.aborted) return;
        setWorkspaces(manageable);
        const firstWorkspaceId = manageable[0]?.workspaceId ?? "";
        setWorkspaceId(firstWorkspaceId);
        await loadGroups(firstWorkspaceId, undefined, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load private groups.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [loadGroups]);

  async function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setIssuedInvitation(null);
    setShowIssueInvitation(false);
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await loadGroups(nextWorkspaceId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load private groups.");
    } finally {
      setLoading(false);
    }
  }

  async function selectGroup(nextGroupId: string) {
    setGroupId(nextGroupId);
    setGroup(null);
    setIssuedInvitation(null);
    setShowIssueInvitation(false);
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await loadGroup(workspaceId, nextGroupId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the private group.");
    } finally {
      setLoading(false);
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            purpose,
            policy: {
              defaultCompensation: compensation,
              worldIdRequired,
              retentionDays: Number(retentionDays),
              exportAllowed,
              assignmentNotifications,
            },
          }),
        }),
      );
      const created = body.group as PrivateGroup;
      setName("");
      setPurpose("");
      setShowCreateGroup(false);
      await loadGroups(workspaceId, created.groupId);
      setStatus("Private group created with an immutable policy version.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the private group.");
    } finally {
      setBusy(false);
    }
  }

  async function issueInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    setIssuedInvitation(null);
    try {
      const ttlDays = Number(inviteTtlDays);
      const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
      const body = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(groupId)}/invitations`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expiresAt,
              maximumRedemptions: Number(maximumRedemptions),
              membershipExpiresAt: membershipExpiresAt ? new Date(membershipExpiresAt).toISOString() : null,
              intendedAccountAddress: intendedAccountAddress.trim() || null,
              intendedEmail: intendedEmail.trim() || null,
              intendedEmailDomain: intendedEmailDomain.trim() || null,
            }),
          },
        ),
      );
      setIssuedInvitation(body.invitation as IssuedInvitation);
      setIntendedAccountAddress("");
      setIntendedEmail("");
      setIntendedEmailDomain("");
      await loadGroup(workspaceId, groupId);
      setStatus("Invitation issued. Copy its secret before leaving this page.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to issue the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitation: PrivateGroupInvitation) {
    if (!window.confirm(`Revoke invitation ${invitation.tokenPrefix}? It cannot be used again.`)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(groupId)}/invitations/${encodeURIComponent(invitation.invitationId)}`,
          { method: "DELETE", credentials: "same-origin" },
        ),
      );
      await loadGroup(workspaceId, groupId);
      setStatus("Invitation revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to revoke the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: PrivateGroupMember) {
    if (!window.confirm(`Remove ${shortAddress(member.principalAddress)} from this private group?`)) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.principalAddress)}`,
          {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "removed_by_workspace_manager" }),
          },
        ),
      );
      await loadGroups(workspaceId, groupId);
      setStatus("Member removed. Their prior audit history remains intact.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to remove the group member.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvitationToken() {
    if (!issuedInvitation) return;
    try {
      await navigator.clipboard.writeText(issuedInvitation.token);
      setStatus("Invitation token copied. Send it through an approved private channel.");
    } catch {
      setError("Clipboard access was unavailable. Select and copy the token manually.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6" aria-labelledby="private-groups-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private groups</p>
            <h2 id="private-groups-heading" className="mt-2 text-2xl font-semibold">
              Invite the right humans without publishing the question
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              Membership is durable, workspace-scoped, and server enforced. Private work may be unpaid; public work
              always follows the paid eligibility path.
            </p>
          </div>
          <label className="min-w-56 text-sm text-base-content/60">
            Managed workspace
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceId}
              onChange={event => void selectWorkspace(event.target.value)}
              disabled={loading}
            >
              {workspaces.map(workspace => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {workspaces.length ? (
          <button
            type="button"
            className="rateloop-gradient-action mt-5 px-5"
            onClick={() => setShowCreateGroup(current => !current)}
          >
            {showCreateGroup ? "Close group form" : "Create private group"}
          </button>
        ) : null}
      </section>

      {showCreateGroup ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="create-private-group-heading">
          <h2 id="create-private-group-heading" className="text-xl font-semibold">
            Create a private group
          </h2>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={createGroup}>
            <label className="text-sm text-base-content/60">
              Group name
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={name}
                onChange={event => setName(event.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="text-sm text-base-content/60">
              Default compensation
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={compensation}
                onChange={event => setCompensation(event.target.value as "unpaid" | "paid")}
              >
                <option value="unpaid">Unpaid internal review</option>
                <option value="paid">Paid private review</option>
              </select>
            </label>
            <label className="text-sm text-base-content/60 sm:col-span-2">
              Purpose shown before a human joins
              <textarea
                className="textarea mt-2 min-h-24 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={purpose}
                onChange={event => setPurpose(event.target.value)}
                maxLength={500}
                required
              />
            </label>
            <label className="text-sm text-base-content/60">
              Retention period (days)
              <input
                type="number"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={event => setRetentionDays(event.target.value)}
                required
              />
            </label>
            <fieldset className="space-y-3 rounded-lg border border-white/10 p-4 text-sm text-base-content/65">
              <legend className="px-1 font-semibold text-base-content/80">Policy defaults</legend>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={worldIdRequired}
                  onChange={event => setWorldIdRequired(event.target.checked)}
                />
                Require World ID assurance
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={assignmentNotifications}
                  onChange={event => setAssignmentNotifications(event.target.checked)}
                />
                Notify members about assignments
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={exportAllowed}
                  onChange={event => setExportAllowed(event.target.checked)}
                />
                Allow workspace exports
              </label>
            </fieldset>
            <button
              type="submit"
              className="rateloop-gradient-action px-5 sm:col-span-2 sm:justify-self-start"
              disabled={busy}
            >
              {busy ? "Creating…" : "Create group"}
            </button>
          </form>
        </section>
      ) : null}

      {loading ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
          <span className="loading loading-spinner loading-sm mr-2" /> Loading authorized groups…
        </div>
      ) : null}
      {!loading && workspaces.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          You need an owner or admin role in a workspace before you can manage private groups.
        </div>
      ) : null}
      {!loading && workspaces.length > 0 && groups.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          This workspace has no private groups yet.
        </div>
      ) : null}

      {groups.length ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="selected-private-group-heading">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <label className="grow text-sm text-base-content/60">
              Private group
              <select
                className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={groupId}
                onChange={event => void selectGroup(event.target.value)}
              >
                {groups.map(candidate => (
                  <option key={candidate.groupId} value={candidate.groupId}>
                    {candidate.name} · {candidate.memberCount} member{candidate.memberCount === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn border-0 bg-white/[0.08]"
              onClick={() => {
                setShowIssueInvitation(current => !current);
                setIssuedInvitation(null);
              }}
            >
              {showIssueInvitation ? "Close invitation form" : "Issue invitation"}
            </button>
          </div>
          {group ? (
            <div className="mt-6 border-t border-white/10 pt-5">
              <h2 id="selected-private-group-heading" className="text-xl font-semibold">
                {group.name}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">{group.purpose}</p>
              <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-base-content/45">Compensation</dt>
                  <dd className="mt-1 capitalize">{group.policy.defaultCompensation ?? "unpaid"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">World ID</dt>
                  <dd className="mt-1">{group.policy.worldIdRequired ? "Required" : "Optional"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Retention</dt>
                  <dd className="mt-1">{group.policy.retentionDays ?? 30} days</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Policy version</dt>
                  <dd className="mt-1 font-mono">v{group.currentPolicyVersion}</dd>
                </div>
              </dl>
              <code className="mt-4 block break-all text-[11px] text-base-content/35">{group.policyHash}</code>
            </div>
          ) : null}
        </section>
      ) : null}

      {showIssueInvitation && group ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="issue-invitation-heading">
          <h2 id="issue-invitation-heading" className="text-xl font-semibold">
            Issue a scoped invitation
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/55">
            Add an account, verified email, or email-domain binding for sensitive groups. Unbound multi-use tokens
            should be reserved for controlled onboarding.
          </p>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={issueInvitation}>
            <label className="text-sm text-base-content/60">
              Token lifetime (days)
              <input
                type="number"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                min={1}
                max={30}
                value={inviteTtlDays}
                onChange={event => setInviteTtlDays(event.target.value)}
                required
              />
            </label>
            <label className="text-sm text-base-content/60">
              Maximum redemptions
              <input
                type="number"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                min={1}
                max={1000}
                value={maximumRedemptions}
                onChange={event => setMaximumRedemptions(event.target.value)}
                required
              />
            </label>
            <label className="text-sm text-base-content/60">
              Membership expiry (optional)
              <input
                type="datetime-local"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={membershipExpiresAt}
                onChange={event => setMembershipExpiresAt(event.target.value)}
              />
            </label>
            <label className="text-sm text-base-content/60">
              Intended account (optional)
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-xs"
                value={intendedAccountAddress}
                onChange={event => setIntendedAccountAddress(event.target.value)}
                placeholder="0x…"
              />
            </label>
            <label className="text-sm text-base-content/60">
              Intended verified email (optional)
              <input
                type="email"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={intendedEmail}
                onChange={event => setIntendedEmail(event.target.value)}
                placeholder="person@company.com"
              />
            </label>
            <label className="text-sm text-base-content/60">
              Verified email domain (optional)
              <input
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={intendedEmailDomain}
                onChange={event => setIntendedEmailDomain(event.target.value)}
                placeholder="company.com"
              />
            </label>
            <button
              type="submit"
              className="rateloop-gradient-action px-5 sm:col-span-2 sm:justify-self-start"
              disabled={busy}
            >
              {busy ? "Issuing…" : "Issue invitation token"}
            </button>
          </form>
          {issuedInvitation ? (
            <div className="mt-6 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-4" role="status">
              <p className="font-semibold text-amber-50">Copy this secret now. RateLoop will not show it again.</p>
              <code className="mt-3 block select-all break-all rounded-lg bg-black/30 p-3 text-xs text-amber-50">
                {issuedInvitation.token}
              </code>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-sm border-0 bg-white/[0.09]" onClick={copyInvitationToken}>
                  Copy token
                </button>
                <span className="text-xs text-base-content/50">Expires {formatDate(issuedInvitation.expiresAt)}</span>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {group ? (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="surface-card rounded-2xl p-6" aria-labelledby="group-members-heading">
            <h2 id="group-members-heading" className="text-xl font-semibold">
              Members
            </h2>
            {group.members.length ? (
              <ul className="mt-5 space-y-3">
                {group.members.map(member => (
                  <li key={member.principalAddress} className="surface-card-nested rounded-lg p-4 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs" title={member.principalAddress}>
                          {shortAddress(member.principalAddress)}
                        </p>
                        <p className="mt-2 text-xs text-base-content/50">
                          {member.role} · {member.status} · expires {formatDate(member.membershipExpiresAt)}
                        </p>
                      </div>
                      {member.status === "active" ? (
                        <button
                          type="button"
                          className="btn btn-sm border border-red-300/20 bg-red-300/[0.06] text-red-100"
                          disabled={busy}
                          onClick={() => void removeMember(member)}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-base-content/50">No one has joined this group yet.</p>
            )}
          </section>

          <section className="surface-card rounded-2xl p-6" aria-labelledby="group-invitations-heading">
            <h2 id="group-invitations-heading" className="text-xl font-semibold">
              Invitations
            </h2>
            {invitations.length ? (
              <ul className="mt-5 space-y-3">
                {invitations.map(invitation => {
                  const currentStatus = invitationStatus(invitation);
                  return (
                    <li key={invitation.invitationId} className="surface-card-nested rounded-lg p-4 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs">rlgi_{invitation.tokenPrefix}_…</p>
                          <p className="mt-2 text-xs text-base-content/50">
                            {invitation.redemptionCount}/{invitation.maximumRedemptions} redeemed · expires{" "}
                            {formatDate(invitation.expiresAt)}
                          </p>
                          <p className="mt-1 text-xs text-base-content/45">
                            {invitation.hasAccountBinding
                              ? "Account bound"
                              : invitation.hasEmailBinding
                                ? "Email bound"
                                : invitation.intendedEmailDomain
                                  ? `Domain: ${invitation.intendedEmailDomain}`
                                  : "Unbound"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs capitalize text-base-content/60">
                            {currentStatus}
                          </span>
                          {currentStatus === "active" ? (
                            <button
                              type="button"
                              className="btn btn-sm border border-red-300/20 bg-red-300/[0.06] text-red-100"
                              disabled={busy}
                              onClick={() => void revokeInvitation(invitation)}
                            >
                              Revoke
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-base-content/50">No invitation tokens have been issued.</p>
            )}
          </section>
        </div>
      ) : null}

      {status ? (
        <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </div>
  );
}
