"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { LocalizedSharedContent, UntranslatedContent } from "~~/components/tokenless/LocalizedSharedContent";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
import { readJson } from "~~/lib/tokenless/http";
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

type MemberConfirmation =
  | { kind: "remove-member"; member: WorkspaceMember; label: string }
  | { kind: "revoke-invitation"; invitation: WorkspaceInvitation };

function shortPrincipal(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function roleLabel(value: WorkspaceAccessRole) {
  return value[0]!.toUpperCase() + value.slice(1);
}

function dateLabel(value: string | null, locale: string) {
  if (!value) return "No expiry";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No expiry" : date.toLocaleDateString(locale);
}

export function WorkspaceMembersPanel({ canManage, workspaceId }: { canManage: boolean; workspaceId: string }) {
  const locale = useLocale();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [viewerPrincipalId, setViewerPrincipalId] = useState("");
  const [email, setEmail] = useState("");
  const [accessRole, setAccessRole] = useState<Exclude<WorkspaceAccessRole, "owner">>("member");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<MemberConfirmation | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const loadMembers = useCallback(async () => {
    if (!workspaceId || !canManage) return;
    const request = workspaceRequests.begin(workspaceId, "members:load");
    setLoading(true);
    try {
      const body = await readJson<MembersResponse>(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/members`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      setMembers(body.members);
      setInvitations(body.invitations);
      setViewerPrincipalId(body.viewerPrincipalId);
      setLoadError(null);
      clear();
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [canManage, clear, workspaceId, workspaceRequests]);

  useEffect(() => {
    workspaceRequests.selectWorkspace(workspaceId);
    setMembers([]);
    setInvitations([]);
    setViewerPrincipalId("");
    setIssuedToken(null);
    setConfirmation(null);
    setLoadError(null);
    clear();
    if (!canManage) return;
    void loadMembers().catch(() => {
      if (!workspaceRequests.isWorkspaceCurrent(workspaceId)) return;
      setLoading(false);
      setLoadError("Unable to load workspace members.");
    });
  }, [canManage, clear, loadMembers, workspaceId, workspaceRequests]);

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget("invite");
    clear();
    try {
      const body = await readJson<{ invitation: { token?: unknown } }>(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/members`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intendedEmail: email, accessRole }),
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      const invitation = body.invitation;
      if (typeof invitation.token !== "string") throw new Error("Invitation code was unavailable.");
      setIssuedToken(invitation.token);
      setEmail("");
      await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) capture(cause, "Unable to create the invitation.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function updateRole(member: WorkspaceMember, nextRole: Exclude<WorkspaceAccessRole, "owner">) {
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(member.principalId);
    clear();
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
      if (request.isCurrent()) capture(cause, "Unable to change the member role.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function removeMember(member: WorkspaceMember) {
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(member.principalId);
    clear();
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(member.principalId)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) capture(cause, "Unable to remove the member.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function revokeInvitation(invitation: WorkspaceInvitation) {
    const request = workspaceRequests.begin(workspaceId, "members:action");
    setBusyTarget(invitation.inviteId);
    clear();
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/member-invitations/${encodeURIComponent(invitation.inviteId)}`,
          { method: "DELETE", credentials: "same-origin", signal: request.signal },
        ),
      );
      if (request.isCurrent()) await loadMembers();
    } catch (cause) {
      if (request.isCurrent()) capture(cause, "Unable to revoke the invitation.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function confirmDestructiveAction() {
    const pending = confirmation;
    if (!pending) return;
    if (pending.kind === "remove-member") await removeMember(pending.member);
    else await revokeInvitation(pending.invitation);
    setConfirmation(current => (current === pending ? null : current));
  }

  if (!canManage) return null;
  const pendingInvitations = invitations.filter(invitation => invitation.status === "pending");

  return (
    <LocalizedSharedContent>
      <section className="rounded-xl border border-base-content/10 p-5" aria-labelledby="workspace-members-heading">
        <div>
          <h2 id="workspace-members-heading" className="text-xl font-semibold">
            Members
          </h2>
        </div>

        <h3 className="mt-5 text-sm font-semibold">Invite member</h3>
        <p className="mt-1 text-xs leading-5 text-base-content/55">
          Create a one-time code bound to their verified email, then send it to them privately.
        </p>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
          onSubmit={createInvitation}
        >
          <Field
            label="Email"
            className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
            type="email"
            autoComplete="email"
            value={email}
            error={fieldErrors.intendedEmail}
            onChange={event => {
              clear("intendedEmail");
              setEmail(event.target.value);
            }}
            placeholder="name@company.com"
            required
          />
          <SelectField
            label="Role"
            className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
            value={accessRole}
            error={fieldErrors.accessRole}
            onChange={event => {
              clear("accessRole");
              setAccessRole(event.target.value as Exclude<WorkspaceAccessRole, "owner">);
            }}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            <option value="billing">Billing</option>
          </SelectField>
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
        {formError ? (
          <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}

        <AsyncSection
          className="mt-6"
          loading={loading}
          loadingLabel="Loading workspace members"
          error={loadError}
          empty={members.length === 0 && pendingInvitations.length === 0}
          emptyTitle="No workspace members found."
        >
          <div className="mt-6 border-t border-base-content/10 pt-5">
            <h3 className="text-sm font-semibold">People with workspace access</h3>
            {members.length ? (
              <ul className="mt-3 space-y-2">
                {members.map(member => {
                  const immutable =
                    member.accessRole === "owner" ||
                    member.managedBy !== null ||
                    member.principalId === viewerPrincipalId;
                  return (
                    <li
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3"
                      key={member.principalId}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          <UntranslatedContent>
                            {member.displayName ?? member.email ?? shortPrincipal(member.principalId)}
                          </UntranslatedContent>
                        </p>
                        <p className="mt-1 text-xs text-base-content/55">
                          {member.displayName && member.email ? (
                            <UntranslatedContent>{member.email} · </UntranslatedContent>
                          ) : null}
                          {member.managedBy ? (
                            <>
                              Managed by <UntranslatedContent>{member.managedBy.toUpperCase()}</UntranslatedContent>
                            </>
                          ) : (
                            <UntranslatedContent>{shortPrincipal(member.principalId)}</UntranslatedContent>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {member.accessRole === "owner" ? (
                          <span className="rounded-full bg-base-content/[0.08] px-3 py-1.5 text-xs font-semibold">
                            Owner
                          </span>
                        ) : (
                          <SelectField
                            className="select-sm rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
                            label={
                              <>
                                Role for{" "}
                                <UntranslatedContent>
                                  {member.displayName ?? member.email ?? member.principalId}
                                </UntranslatedContent>
                              </>
                            }
                            labelClassName="sr-only"
                            value={member.accessRole}
                            disabled={immutable || busyTarget === member.principalId}
                            onChange={event =>
                              void updateRole(member, event.target.value as Exclude<WorkspaceAccessRole, "owner">)
                            }
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                            <option value="billing">Billing</option>
                          </SelectField>
                        )}
                        {!immutable ? (
                          <button
                            className="btn btn-sm border-error/20 bg-error/[0.06] text-error"
                            type="button"
                            disabled={busyTarget === member.principalId}
                            onClick={() =>
                              setConfirmation({
                                kind: "remove-member",
                                member,
                                label: member.displayName ?? member.email ?? shortPrincipal(member.principalId),
                              })
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-base-content/55">No one has workspace access yet.</p>
            )}
          </div>

          {pendingInvitations.length ? (
            <div className="mt-6 border-t border-base-content/10 pt-5">
              <h3 className="text-sm font-semibold">Pending invitations</h3>
              <ul className="mt-3 space-y-2">
                {pendingInvitations.map(invitation => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3 text-sm"
                    key={invitation.inviteId}
                  >
                    <span>
                      {roleLabel(invitation.accessRole)} · expires{" "}
                      <UntranslatedContent>{dateLabel(invitation.expiresAt, locale)}</UntranslatedContent>
                    </span>
                    <button
                      className="text-xs text-error underline underline-offset-4"
                      type="button"
                      disabled={busyTarget === invitation.inviteId}
                      onClick={() => setConfirmation({ kind: "revoke-invitation", invitation })}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </AsyncSection>
        <ConfirmDialog
          open={confirmation !== null}
          title={
            confirmation?.kind === "remove-member" ? (
              <>
                Remove <UntranslatedContent>{confirmation.label}</UntranslatedContent> from this workspace?
              </>
            ) : (
              "Revoke this workspace invitation?"
            )
          }
          description={
            confirmation?.kind === "remove-member"
              ? "They will lose workspace access immediately."
              : "The invitation code will stop working."
          }
          confirmLabel={confirmation?.kind === "remove-member" ? "Remove member" : "Revoke invitation"}
          busy={
            confirmation?.kind === "remove-member"
              ? busyTarget === confirmation.member.principalId
              : confirmation?.kind === "revoke-invitation"
                ? busyTarget === confirmation.invitation.inviteId
                : false
          }
          onCancel={() => setConfirmation(null)}
          onConfirm={() => void confirmDestructiveAction()}
        />
      </section>
    </LocalizedSharedContent>
  );
}
