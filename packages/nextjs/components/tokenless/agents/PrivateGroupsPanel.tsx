"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRateLoopNotifications } from "~~/components/tokenless/RateLoopNotificationProvider";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import type { ReviewerExpertiseDefinition } from "~~/lib/tokenless/reviewerExpertiseOptions";

type Workspace = { workspaceId: string; name: string; role: string };
type GroupPolicy = {
  defaultCompensation?: "unpaid" | "paid";
  worldIdRequired?: boolean;
  exportAllowed?: boolean;
  notificationDefaults?: { assignmentAvailable?: boolean };
};
type GroupPolicyDraft = {
  compensation: "unpaid" | "paid";
  worldIdRequired: boolean;
  exportAllowed: boolean;
  assignmentNotifications: boolean;
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
  sourceInvitationId: string | null;
  membershipExpiresAt: string | null;
  joinedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
};
type PrivateGroupDetail = PrivateGroup & { members: PrivateGroupMember[] };
type ExactExpertiseDefinition = {
  definitionId: string;
  definitionVersion: number;
  definitionHash: `sha256:${string}`;
};
type IntendedExpertiseDefinition = ExactExpertiseDefinition & {
  label: string | null;
  description: string | null;
  expiresAt: string | null;
  status: string | null;
};
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
  intendedExpertise: IntendedExpertiseDefinition[];
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

function exactExpertiseDefinition(definition: ReviewerExpertiseDefinition): ExactExpertiseDefinition {
  return {
    definitionId: definition.definitionId,
    definitionVersion: definition.version,
    definitionHash: definition.hash,
  };
}

function oneYearFromNow() {
  return new Date(Date.now() + 365 * 86_400_000);
}

function localDateTimeValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function defaultExpertiseExpiry(membershipExpiresAt: string | null) {
  const oneYear = oneYearFromNow();
  if (!membershipExpiresAt) return localDateTimeValue(oneYear);
  const membershipExpiry = new Date(membershipExpiresAt);
  return localDateTimeValue(membershipExpiry < oneYear ? membershipExpiry : oneYear);
}

function invitationStatus(invitation: PrivateGroupInvitation) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.expiresAt && new Date(invitation.expiresAt) <= new Date()) return "expired";
  if (invitation.redemptionCount >= invitation.maximumRedemptions) return "used";
  return "active";
}

export function PrivateGroupsPanel({
  initialWorkspaceId = "",
  showWorkspaceSelector = true,
}: {
  initialWorkspaceId?: string;
  showWorkspaceSelector?: boolean;
}) {
  const notifications = useRateLoopNotifications();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [groups, setGroups] = useState<PrivateGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [group, setGroup] = useState<PrivateGroupDetail | null>(null);
  const [invitations, setInvitations] = useState<PrivateGroupInvitation[]>([]);
  const [expertiseDefinitions, setExpertiseDefinitions] = useState<ReviewerExpertiseDefinition[]>([]);
  const [expertiseDefinitionsError, setExpertiseDefinitionsError] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [policyEditorSnapshot, setPolicyEditorSnapshot] = useState<GroupPolicyDraft | null>(null);
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
  const [exportAllowed, setExportAllowed] = useState(false);
  const [assignmentNotifications, setAssignmentNotifications] = useState(true);

  const [inviteTtlDays, setInviteTtlDays] = useState("7");
  const [maximumRedemptions, setMaximumRedemptions] = useState("1");
  const [membershipExpiresAt, setMembershipExpiresAt] = useState("");
  const [intendedAccountAddress, setIntendedAccountAddress] = useState("");
  const [intendedEmail, setIntendedEmail] = useState("");
  const [intendedEmailDomain, setIntendedEmailDomain] = useState("");
  const [invitationExpertiseIds, setInvitationExpertiseIds] = useState<string[]>([]);
  const [expertiseMemberAddress, setExpertiseMemberAddress] = useState("");
  const [memberExpertiseIds, setMemberExpertiseIds] = useState<string[]>([]);
  const [memberExpertiseExpiresAt, setMemberExpertiseExpiresAt] = useState("");

  const loadExpertiseDefinitions = useCallback(async (selectedWorkspaceId: string, signal?: AbortSignal) => {
    if (!selectedWorkspaceId) {
      setExpertiseDefinitions([]);
      setExpertiseDefinitionsError(null);
      return;
    }
    try {
      const body = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(selectedWorkspaceId)}/reviewer-expertise/definitions`,
          { cache: "no-store", credentials: "same-origin", signal },
        ),
      );
      if (signal?.aborted) return;
      setExpertiseDefinitions((body.definitions ?? []) as ReviewerExpertiseDefinition[]);
      setExpertiseDefinitionsError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setExpertiseDefinitions([]);
      setExpertiseDefinitionsError(cause instanceof Error ? cause.message : "Unable to load specialist areas.");
    }
  }, []);

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
        const selectedWorkspaceId = manageable.some(workspace => workspace.workspaceId === initialWorkspaceId)
          ? initialWorkspaceId
          : (manageable[0]?.workspaceId ?? "");
        setWorkspaceId(selectedWorkspaceId);
        await Promise.all([
          loadGroups(selectedWorkspaceId, undefined, controller.signal),
          loadExpertiseDefinitions(selectedWorkspaceId, controller.signal),
        ]);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load private groups.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialWorkspaceId, loadExpertiseDefinitions, loadGroups]);

  async function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setIssuedInvitation(null);
    setShowIssueInvitation(false);
    setInvitationExpertiseIds([]);
    setExpertiseMemberAddress("");
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await Promise.all([loadGroups(nextWorkspaceId), loadExpertiseDefinitions(nextWorkspaceId)]);
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
    setInvitationExpertiseIds([]);
    setExpertiseMemberAddress("");
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
            purpose: purpose.trim() || `Private reviews for ${name.trim()}.`,
            policy: {
              defaultCompensation: compensation,
              worldIdRequired,
              exportAllowed,
              assignmentNotifications,
            },
          }),
        }),
      );
      const created = body.group as PrivateGroup;
      setName("");
      setPurpose("");
      setPolicyEditorSnapshot(null);
      setShowCreateGroup(false);
      await loadGroups(workspaceId, created.groupId);
      setStatus("Group created.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the private group.");
    } finally {
      setBusy(false);
    }
  }

  async function issueInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invitationExpertiseIds.length > 0 && !intendedEmail.trim()) {
      setError("Enter the recipient email before choosing intended specialist areas.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    setIssuedInvitation(null);
    try {
      const ttlDays = Number(inviteTtlDays);
      const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
      const selectedExpertiseDefinitions = expertiseDefinitions
        .filter(definition => invitationExpertiseIds.includes(definition.definitionId))
        .map(exactExpertiseDefinition);
      const oneYearExpertiseExpiry = oneYearFromNow();
      const membershipExpiry = membershipExpiresAt ? new Date(membershipExpiresAt) : null;
      const expertiseExpiresAt = selectedExpertiseDefinitions.length
        ? membershipExpiry && membershipExpiry < oneYearExpertiseExpiry
          ? membershipExpiry
          : oneYearExpertiseExpiry
        : null;
      const body = await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(groupId)}/invitations`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expiresAt,
              maximumRedemptions: selectedExpertiseDefinitions.length > 0 ? 1 : Number(maximumRedemptions),
              membershipExpiresAt: membershipExpiresAt ? new Date(membershipExpiresAt).toISOString() : null,
              intendedAccountAddress: intendedAccountAddress.trim() || null,
              intendedEmail: intendedEmail.trim() || null,
              intendedEmailDomain: selectedExpertiseDefinitions.length > 0 ? null : intendedEmailDomain.trim() || null,
              expertiseDefinitions: selectedExpertiseDefinitions,
              expertiseExpiresAt: expertiseExpiresAt?.toISOString() ?? null,
            }),
          },
        ),
      );
      setIssuedInvitation(body.invitation as IssuedInvitation);
      setIntendedAccountAddress("");
      setIntendedEmail("");
      setIntendedEmailDomain("");
      setInvitationExpertiseIds([]);
      await loadGroup(workspaceId, groupId);
      setStatus("Invitation created. Copy it before leaving this page.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to issue the invitation.");
    } finally {
      setBusy(false);
    }
  }

  function openMemberExpertise(member: PrivateGroupMember) {
    const intended = invitations
      .find(invitation => invitation.invitationId === member.sourceInvitationId)
      ?.intendedExpertise?.filter(definition => definition.status === "pending");
    setExpertiseMemberAddress(member.principalAddress);
    setMemberExpertiseIds(
      (intended ?? [])
        .map(definition => definition.definitionId)
        .filter(definitionId => expertiseDefinitions.some(definition => definition.definitionId === definitionId)),
    );
    setMemberExpertiseExpiresAt(
      intended?.[0]?.expiresAt
        ? localDateTimeValue(new Date(intended[0].expiresAt))
        : defaultExpertiseExpiry(member.membershipExpiresAt),
    );
  }

  async function confirmMemberExpertise(event: FormEvent<HTMLFormElement>, member: PrivateGroupMember) {
    event.preventDefault();
    const definitions = expertiseDefinitions
      .filter(definition => memberExpertiseIds.includes(definition.definitionId))
      .map(exactExpertiseDefinition);
    if (definitions.length === 0) {
      setError("Choose at least one specialist area to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(member.principalAddress)}/expertise`,
          {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              definitions,
              expiresAt: new Date(memberExpertiseExpiresAt).toISOString(),
            }),
          },
        ),
      );
      await loadGroup(workspaceId, groupId);
      setExpertiseMemberAddress("");
      setMemberExpertiseIds([]);
      setMemberExpertiseExpiresAt("");
      setStatus(`Specialist knowledge confirmed for ${shortAddress(member.principalAddress)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to confirm specialist knowledge.");
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
      setStatus("Member removed.");
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
      setStatus("Invitation copied. Send it privately.");
      notifications.success("Invitation code copied to clipboard.");
    } catch {
      setError("Clipboard access was unavailable. Select and copy the token manually.");
      notifications.error("Clipboard access was blocked. Copy the invitation code manually.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6" aria-labelledby="private-groups-heading">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Private groups</p>
            <h2 id="private-groups-heading" className="mt-2 text-2xl font-semibold">
              Choose who can review private work
            </h2>
            <p className="mt-2 text-sm text-base-content/55">Create a group, then invite people by code or email.</p>
          </div>
          {showWorkspaceSelector && workspaces.length > 1 ? (
            <label className="min-w-56 text-sm text-base-content/60">
              Workspace
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
          ) : null}
        </div>
        {workspaces.length ? (
          <button
            type="button"
            className={`${showCreateGroup ? "btn rateloop-secondary-action" : "rateloop-gradient-action"} mt-5 px-5`}
            onClick={() => setShowCreateGroup(current => !current)}
          >
            {showCreateGroup ? "Cancel" : "Create group"}
          </button>
        ) : null}
      </section>

      {showCreateGroup ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="create-private-group-heading">
          <h2 id="create-private-group-heading" className="text-xl font-semibold">
            Create group
          </h2>
          <form className="mt-5 grid max-w-2xl gap-4" onSubmit={createGroup}>
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
              Purpose (optional)
              <textarea
                className="textarea mt-2 min-h-24 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={purpose}
                onChange={event => setPurpose(event.target.value)}
                maxLength={500}
              />
            </label>
            {!policyEditorSnapshot ? (
              <button
                type="button"
                className="btn rateloop-secondary-action justify-self-start"
                aria-controls="private-group-policy-editor"
                aria-expanded={false}
                onClick={() =>
                  setPolicyEditorSnapshot({
                    compensation,
                    worldIdRequired,
                    assignmentNotifications,
                    exportAllowed,
                  })
                }
              >
                Customize policy
              </button>
            ) : (
              <fieldset
                id="private-group-policy-editor"
                className="rounded-lg border border-white/10 p-4"
                aria-label="Group policy"
              >
                <div className="space-y-4">
                  <label className="block text-sm text-base-content/60">
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
                  <fieldset className="space-y-3 text-sm text-base-content/65">
                    <legend className="sr-only">Policy defaults</legend>
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
                </div>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="btn rateloop-secondary-action"
                    onClick={() => {
                      setCompensation(policyEditorSnapshot.compensation);
                      setWorldIdRequired(policyEditorSnapshot.worldIdRequired);
                      setAssignmentNotifications(policyEditorSnapshot.assignmentNotifications);
                      setExportAllowed(policyEditorSnapshot.exportAllowed);
                      setPolicyEditorSnapshot(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn rateloop-secondary-action"
                    onClick={() => setPolicyEditorSnapshot(null)}
                  >
                    Done
                  </button>
                </div>
              </fieldset>
            )}
            <button type="submit" className="rateloop-gradient-action justify-self-start px-5" disabled={busy}>
              {busy ? "Creating…" : "Create group"}
            </button>
          </form>
        </section>
      ) : null}

      <AsyncSection loading={loading} loadingLabel="Loading private groups">
        {null}
      </AsyncSection>
      {!loading && workspaces.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
          You need an owner or admin role in a workspace before you can manage private groups.
        </div>
      ) : null}
      {!loading && workspaces.length > 0 && groups.length === 0 && !showCreateGroup ? (
        <p className="text-sm text-base-content/50">No private groups yet.</p>
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
              className="btn rateloop-secondary-action"
              onClick={() => {
                setShowIssueInvitation(current => !current);
                setIssuedInvitation(null);
              }}
            >
              {showIssueInvitation ? "Cancel" : "Invite people"}
            </button>
          </div>
          {group ? (
            <div className="mt-6 border-t border-white/10 pt-5">
              <h2 id="selected-private-group-heading" className="text-xl font-semibold">
                {group.name}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-base-content/60">{group.purpose}</p>
              <dl className="mt-4 grid gap-4 rounded-lg border border-white/10 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-base-content/45">Compensation</dt>
                  <dd className="mt-1">
                    {group.policy.defaultCompensation === "paid" ? "Paid private review" : "Unpaid internal review"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Identity assurance</dt>
                  <dd className="mt-1">{group.policy.worldIdRequired ? "World ID required" : "World ID optional"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Assignment notifications</dt>
                  <dd className="mt-1">
                    {group.policy.notificationDefaults?.assignmentAvailable === false ? "Off" : "On"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-base-content/45">Workspace exports</dt>
                  <dd className="mt-1">{group.policy.exportAllowed ? "Allowed" : "Blocked"}</dd>
                </div>
              </dl>
              <details className="mt-3 text-xs text-base-content/45">
                <summary className="cursor-pointer">Policy record</summary>
                <dl className="mt-3">
                  <div>
                    <dt>Version</dt>
                    <dd className="mt-1 font-mono">v{group.currentPolicyVersion}</dd>
                  </div>
                </dl>
                <code className="mt-3 block break-all text-[11px] text-base-content/35">{group.policyHash}</code>
              </details>
            </div>
          ) : null}
        </section>
      ) : null}

      {showIssueInvitation && group ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="issue-invitation-heading">
          <h2 id="issue-invitation-heading" className="text-xl font-semibold">
            Invite someone
          </h2>
          <form className="mt-5 grid max-w-2xl gap-4" onSubmit={issueInvitation}>
            <label className="text-sm text-base-content/60">
              Recipient email (optional)
              <input
                type="email"
                className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                value={intendedEmail}
                onChange={event => setIntendedEmail(event.target.value)}
                placeholder="person@company.com"
                required={invitationExpertiseIds.length > 0}
              />
              <span className="mt-2 block text-xs text-base-content/45">
                Leave blank to create a one-use invitation code.
              </span>
            </label>
            <fieldset className="rounded-lg border border-white/10 p-4">
              <legend className="px-1 text-sm font-semibold text-base-content/75">
                Intended specialist areas (optional)
              </legend>
              <p className="mt-1 text-xs leading-5 text-base-content/45">
                These remain pending after redemption until you confirm the member&apos;s knowledge.
              </p>
              {expertiseDefinitions.length ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {expertiseDefinitions.map(definition => (
                    <label
                      key={definition.definitionId}
                      htmlFor={`invitation-expertise-${definition.definitionId}`}
                      aria-label={definition.label}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 p-3 text-sm text-base-content/70"
                    >
                      <input
                        id={`invitation-expertise-${definition.definitionId}`}
                        type="checkbox"
                        className="checkbox checkbox-sm mt-0.5"
                        checked={invitationExpertiseIds.includes(definition.definitionId)}
                        onChange={event => {
                          if (event.target.checked && invitationExpertiseIds.length >= 8) {
                            setError("Choose up to eight intended specialist areas.");
                            return;
                          }
                          setInvitationExpertiseIds(current =>
                            event.target.checked
                              ? [...current, definition.definitionId]
                              : current.filter(definitionId => definitionId !== definition.definitionId),
                          );
                          if (event.target.checked) {
                            setMaximumRedemptions("1");
                            setIntendedEmailDomain("");
                          }
                        }}
                      />
                      <span>
                        <span className="block font-medium text-base-content/80">{definition.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-base-content/45">
                          {definition.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : expertiseDefinitionsError ? (
                <p className="mt-3 text-xs text-red-100">{expertiseDefinitionsError}</p>
              ) : (
                <p className="mt-3 text-xs text-base-content/45">No specialist areas are available yet.</p>
              )}
              {invitationExpertiseIds.length > 0 ? (
                <p className="mt-3 text-xs text-base-content/50">
                  A recipient email is required. This invitation will be limited to one redemption.
                </p>
              ) : null}
            </fieldset>
            <details className="rounded-lg border border-white/10 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-base-content/75">
                Invitation restrictions
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
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
                    disabled={invitationExpertiseIds.length > 0}
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
                <label className="text-sm text-base-content/60 sm:col-span-2">
                  Verified email domain (optional)
                  <input
                    className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={intendedEmailDomain}
                    onChange={event => setIntendedEmailDomain(event.target.value)}
                    placeholder="company.com"
                    disabled={invitationExpertiseIds.length > 0}
                  />
                </label>
              </div>
            </details>
            <button type="submit" className="rateloop-gradient-action justify-self-start px-5" disabled={busy}>
              {busy ? "Creating…" : "Create invitation"}
            </button>
          </form>
          {issuedInvitation ? (
            <div className="mt-6 rounded-xl border border-amber-200/20 bg-amber-200/[0.06] p-4" role="status">
              <p className="font-semibold text-amber-50">Copy this invitation now. It will not be shown again.</p>
              <code className="mt-3 block select-all break-all rounded-lg bg-black/30 p-3 text-xs text-amber-50">
                {issuedInvitation.token}
              </code>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className="btn btn-sm rateloop-secondary-action" onClick={copyInvitationToken}>
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
                    {member.status === "active" && member.sourceInvitationId ? (
                      <details
                        className="mt-3 border-t border-white/10 pt-3"
                        data-disclosure-purpose="specialist-attestation"
                        open={expertiseMemberAddress === member.principalAddress}
                        onToggle={event => {
                          if (event.currentTarget.open) {
                            if (expertiseMemberAddress !== member.principalAddress) openMemberExpertise(member);
                          } else if (expertiseMemberAddress === member.principalAddress) {
                            setExpertiseMemberAddress("");
                          }
                        }}
                      >
                        <summary className="cursor-pointer text-xs font-semibold text-base-content/65">
                          Confirm specialist knowledge
                        </summary>
                        <form className="mt-4 space-y-4" onSubmit={event => void confirmMemberExpertise(event, member)}>
                          <p className="text-xs leading-5 text-base-content/45">
                            Confirm only areas you know this person can review. RateLoop has not independently verified
                            them. Saving replaces any current specialist confirmation.
                          </p>
                          {expertiseDefinitions.length ? (
                            <fieldset className="grid gap-2 sm:grid-cols-2">
                              <legend className="sr-only">Specialist areas to confirm</legend>
                              {expertiseDefinitions.map(definition => (
                                <label
                                  key={definition.definitionId}
                                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 p-3 text-xs text-base-content/65"
                                >
                                  <input
                                    type="checkbox"
                                    className="checkbox checkbox-xs mt-0.5"
                                    checked={memberExpertiseIds.includes(definition.definitionId)}
                                    onChange={event =>
                                      setMemberExpertiseIds(current =>
                                        event.target.checked
                                          ? [...current, definition.definitionId]
                                          : current.filter(definitionId => definitionId !== definition.definitionId),
                                      )
                                    }
                                  />
                                  <span>{definition.label}</span>
                                </label>
                              ))}
                            </fieldset>
                          ) : (
                            <p className="text-xs text-red-100">
                              {expertiseDefinitionsError ?? "No specialist areas are available yet."}
                            </p>
                          )}
                          <label className="block text-xs text-base-content/55">
                            Confirmation expires
                            <input
                              type="datetime-local"
                              className="input input-sm mt-2 w-full border-white/10 bg-[var(--rateloop-field)] sm:max-w-xs"
                              value={memberExpertiseExpiresAt}
                              onChange={event => setMemberExpertiseExpiresAt(event.target.value)}
                              min={localDateTimeValue(new Date(Date.now() + 60_000))}
                              max={
                                member.membershipExpiresAt
                                  ? localDateTimeValue(new Date(member.membershipExpiresAt))
                                  : undefined
                              }
                              required
                            />
                          </label>
                          <button
                            type="submit"
                            className="btn btn-sm rateloop-secondary-action"
                            disabled={busy || memberExpertiseIds.length === 0 || !memberExpertiseExpiresAt}
                          >
                            {busy ? "Saving…" : "Confirm selected areas"}
                          </button>
                        </form>
                      </details>
                    ) : null}
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
                  const pendingExpertise = (invitation.intendedExpertise ?? []).filter(
                    definition => definition.status === "pending",
                  );
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
                          {pendingExpertise.length ? (
                            <div className="mt-3">
                              <p className="text-xs font-medium text-amber-100/80">
                                Intended specialist areas · pending owner confirmation
                              </p>
                              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Pending intended specialist areas">
                                {pendingExpertise.map(definition => (
                                  <li
                                    key={`${definition.definitionId}:${definition.definitionVersion}:${definition.definitionHash}`}
                                    className="rounded-md bg-amber-200/[0.07] px-2 py-1 text-xs text-amber-50/75"
                                  >
                                    {definition.label ??
                                      expertiseDefinitions.find(
                                        candidate => candidate.definitionId === definition.definitionId,
                                      )?.label ??
                                      "Specialist area"}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
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
