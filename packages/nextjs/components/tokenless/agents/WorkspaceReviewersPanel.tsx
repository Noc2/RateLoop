"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { ChoiceInput, Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { readJson } from "~~/lib/tokenless/http";
import { WorkspaceRequestScope } from "~~/lib/tokenless/workspaceRequestScope";

type WorkspaceReviewer = {
  principalAddress: string;
  displayName: string | null;
  email: string | null;
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

type ExactExpertiseDefinition = {
  definitionId: string;
  definitionVersion: number;
  definitionHash: string;
  label: string;
};

function invitedExpertiseContext(
  ownerView: Record<string, unknown>,
  definitionsBody: Record<string, unknown>,
): { groupId: string; definitions: ExactExpertiseDefinition[] } | null {
  const configuration = ownerView.configuration;
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return null;
  const requestProfile = (configuration as Record<string, unknown>).requestProfile;
  if (!requestProfile || typeof requestProfile !== "object" || Array.isArray(requestProfile)) return null;
  const value = (requestProfile as Record<string, unknown>).value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (typeof profile.privateGroupId !== "string" || !profile.privateGroupId) return null;
  const requirements = Array.isArray(profile.expertiseRequirements) ? profile.expertiseRequirements : [];
  const definitions = Array.isArray(definitionsBody.definitions) ? definitionsBody.definitions : [];
  const labels = new Map(
    definitions.flatMap(definition => {
      if (!definition || typeof definition !== "object" || Array.isArray(definition)) return [];
      const candidate = definition as Record<string, unknown>;
      return typeof candidate.definitionId === "string" && typeof candidate.label === "string"
        ? [[candidate.definitionId, candidate.label] as const]
        : [];
    }),
  );
  return {
    groupId: profile.privateGroupId,
    definitions: requirements.flatMap(requirement => {
      if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) return [];
      const candidate = requirement as Record<string, unknown>;
      if (
        candidate.sourceScope === "rateloop_network" ||
        typeof candidate.definitionId !== "string" ||
        !Number.isSafeInteger(candidate.definitionVersion) ||
        typeof candidate.definitionHash !== "string"
      ) {
        return [];
      }
      return [
        {
          definitionId: candidate.definitionId,
          definitionVersion: Number(candidate.definitionVersion),
          definitionHash: candidate.definitionHash,
          label: labels.get(candidate.definitionId) ?? candidate.definitionId,
        },
      ];
    }),
  };
}

function shortPrincipal(value: string) {
  return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function reviewerLabel(reviewer: WorkspaceReviewer) {
  return reviewer.displayName || reviewer.email || shortPrincipal(reviewer.principalAddress);
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
  agentId,
  canManage = true,
  workspaceId,
}: {
  agentId: string;
  canManage?: boolean;
  workspaceId: string;
}) {
  const [reviewers, setReviewers] = useState<WorkspaceReviewer[]>([]);
  const [invitations, setInvitations] = useState<ReviewerInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [maxPrivateSensitivity, setMaxPrivateSensitivity] = useState<
    "internal" | "confidential" | "restricted" | "regulated"
  >("confidential");
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [paidAdulthoodAttested, setPaidAdulthoodAttested] = useState(false);
  const [expertiseContext, setExpertiseContext] = useState<{
    groupId: string;
    definitions: ExactExpertiseDefinition[];
  } | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workspaceRequests] = useState(() => new WorkspaceRequestScope());
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const load = useCallback(async () => {
    if (!workspaceId || !canManage) return;
    const request = workspaceRequests.begin(workspaceId, "reviewers:load");
    setLoading(true);
    try {
      const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
      const [reviewersBody, invitationsBody, ownerView, definitionsBody] = await Promise.all([
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
        readJson(
          await fetch(`${base}/agents/${encodeURIComponent(agentId)}/human-review`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        ),
        readJson(
          await fetch(`${base}/reviewer-expertise/definitions`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: request.signal,
          }),
        ),
      ]);
      if (!request.isCurrent()) return;
      setReviewers((reviewersBody.reviewers ?? []) as WorkspaceReviewer[]);
      setInvitations((invitationsBody.invitations ?? []) as ReviewerInvitation[]);
      setExpertiseContext(
        invitedExpertiseContext(ownerView as Record<string, unknown>, definitionsBody as Record<string, unknown>),
      );
      setError(null);
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [agentId, canManage, workspaceId, workspaceRequests]);

  useEffect(() => {
    workspaceRequests.selectWorkspace(workspaceId);
    setReviewers([]);
    setInvitations([]);
    setIssuedUrl(null);
    setExpertiseContext(null);
    setError(null);
    setNotice(null);
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
    clear();
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/reviewer-invitations`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId,
            intendedEmail: email.trim() || null,
            maxPrivateSensitivity,
            paidAdulthoodAttested,
          }),
          signal: request.signal,
        }),
      );
      if (!request.isCurrent()) return;
      const invitation = body.invitation as Record<string, unknown> | undefined;
      if (typeof invitation?.destinationUrl !== "string") throw new Error("Invitation link was unavailable.");
      setIssuedUrl(invitation.destinationUrl);
      setEmail("");
      await load();
    } catch (cause) {
      if (request.isCurrent()) capture(cause, "Unable to invite the reviewer.");
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function removeReviewer(reviewer: WorkspaceReviewer) {
    if (!window.confirm(`Remove ${reviewerLabel(reviewer)} from this workspace's reviewers?`)) return;
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

  async function confirmReviewerExpertise(reviewer: WorkspaceReviewer) {
    if (!expertiseContext?.definitions.length) return;
    const request = workspaceRequests.begin(workspaceId, "reviewers:action");
    setBusyTarget(reviewer.principalAddress);
    setError(null);
    setNotice(null);
    const activeExpiryTimes = reviewer.grants
      .filter(grant => grant.status === "active" && grant.validUntil)
      .map(grant => new Date(grant.validUntil!).getTime())
      .filter(value => Number.isFinite(value) && value > Date.now());
    const expiresAt = new Date(
      activeExpiryTimes.length ? Math.min(...activeExpiryTimes) : Date.now() + 365 * 86_400_000,
    ).toISOString();
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/private-groups/${encodeURIComponent(
            expertiseContext.groupId,
          )}/members/${encodeURIComponent(reviewer.principalAddress)}/expertise`,
          {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              definitions: expertiseContext.definitions.map(({ definitionId, definitionVersion, definitionHash }) => ({
                definitionId,
                definitionVersion,
                definitionHash,
              })),
              expiresAt,
            }),
            signal: request.signal,
          },
        ),
      );
      if (request.isCurrent()) {
        setNotice(`Specialist areas confirmed for ${reviewerLabel(reviewer)}.`);
        await load();
      }
    } catch (cause) {
      if (request.isCurrent())
        setError(cause instanceof Error ? cause.message : "Unable to confirm this reviewer's specialist areas.");
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
        <div className="min-w-0 flex-1">
          <Field
            id="workspace-reviewer-email"
            label="Email (optional)"
            className="input mt-1.5 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
            type="email"
            autoComplete="email"
            value={email}
            onChange={event => {
              setEmail(event.target.value);
              clear("intendedEmail");
            }}
            placeholder="name@company.com"
            error={fieldErrors.intendedEmail}
          />
        </div>
        <SelectField
          className="rounded-lg border-white/10 bg-[var(--rateloop-field)]"
          label="Private material limit"
          labelClassName="text-xs text-base-content/55"
          error={fieldErrors.maxPrivateSensitivity}
          value={maxPrivateSensitivity}
          onChange={event => {
            setMaxPrivateSensitivity(event.target.value as "internal" | "confidential" | "restricted" | "regulated");
            clear("maxPrivateSensitivity");
          }}
        >
          <option value="internal">Internal</option>
          <option value="confidential">Confidential</option>
          <option value="restricted">Restricted</option>
          <option value="regulated">Regulated</option>
        </SelectField>
        <button className="rateloop-gradient-action min-h-12 px-5" disabled={busyTarget === "invite"}>
          {busyTarget === "invite" ? "Creating…" : "Invite reviewer"}
        </button>
        <label
          className="flex items-start gap-2 text-xs leading-5 text-base-content/65 sm:col-span-3"
          htmlFor="workspace-reviewer-paid-adulthood"
        >
          <ChoiceInput
            id="workspace-reviewer-paid-adulthood"
            type="checkbox"
            className="checkbox checkbox-sm mt-0.5"
            checked={paidAdulthoodAttested}
            onChange={event => setPaidAdulthoodAttested(event.target.checked)}
          />
          <span>
            Permit paid assignments: our workspace warrants this invitee is at least 18. This is a customer attestation,
            not verified age, and sanctions screening still adds a manual review delay.
          </span>
        </label>
      </form>

      {issuedUrl ? (
        <OneTimeSecretNotice label="reviewer invitation link" value={issuedUrl} onDismiss={() => setIssuedUrl(null)} />
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100" role="alert">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg bg-emerald-400/10 p-3 text-sm text-emerald-100" role="status">
          {notice}
        </p>
      ) : null}

      <div className="mt-6 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold">Active reviewers</h3>
        {loading ? (
          <p className="mt-3 text-sm text-base-content/55" role="status">
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
                  <p className="truncate text-sm font-semibold">{reviewerLabel(reviewer)}</p>
                  {reviewer.displayName && reviewer.email ? (
                    <p className="mt-1 truncate text-xs text-base-content/60">{reviewer.email}</p>
                  ) : null}
                  {reviewer.displayName || reviewer.email ? (
                    <p className="mt-1 truncate font-mono text-xs text-base-content/55">
                      {shortPrincipal(reviewer.principalAddress)}
                    </p>
                  ) : null}
                  {reviewer.grants
                    .filter(grant => grant.status === "active")
                    .map(grant => (
                      <p className="mt-1 text-xs text-base-content/55" key={grant.grantId}>
                        Up to {grant.maxPrivateSensitivity} material · access expires {dateLabel(grant.validUntil)}
                      </p>
                    ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {expertiseContext?.definitions.length ? (
                    <button
                      className="btn btn-sm border-white/10 bg-white/[0.04]"
                      type="button"
                      disabled={busyTarget === reviewer.principalAddress}
                      onClick={() => void confirmReviewerExpertise(reviewer)}
                      title={`Attest: ${expertiseContext.definitions.map(definition => definition.label).join(", ")}`}
                    >
                      {busyTarget === reviewer.principalAddress ? "Confirming…" : "Confirm specialist areas"}
                    </button>
                  ) : null}
                  <button
                    className="btn btn-sm border-red-300/20 bg-red-300/[0.06] text-red-100"
                    type="button"
                    disabled={busyTarget === reviewer.principalAddress}
                    onClick={() => void removeReviewer(reviewer)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-base-content/55">No reviewers yet.</p>
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
