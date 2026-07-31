"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { OneTimeSecretNotice } from "~~/components/tokenless/agents/OneTimeSecretNotice";
import { ChoiceInput, Field, SelectField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { ConfirmDialog } from "~~/components/tokenless/ui/ConfirmDialog";
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

type ReviewerConfirmation =
  | { kind: "remove-reviewer"; reviewer: WorkspaceReviewer; label: string }
  | { kind: "revoke-invitation"; invitation: ReviewerInvitation };

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

function dateLabel(value: string | null, locale: string, noExpiry: string) {
  if (!value) return noExpiry;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? noExpiry : date.toLocaleDateString(locale);
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
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const copy = useAgentTranslations("reviewersPanel");
  const [reviewers, setReviewers] = useState<WorkspaceReviewer[]>([]);
  const [invitations, setInvitations] = useState<ReviewerInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [maxPrivateSensitivity, setMaxPrivateSensitivity] = useState<
    "internal" | "confidential" | "restricted" | "regulated"
  >("confidential");
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ReviewerConfirmation | null>(null);
  const [paidAdulthoodAttested, setPaidAdulthoodAttested] = useState(false);
  const [expertiseContext, setExpertiseContext] = useState<{
    groupId: string;
    definitions: ExactExpertiseDefinition[];
  } | null>(null);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
      setLoadError(null);
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
    setConfirmation(null);
    setExpertiseContext(null);
    setLoadError(null);
    setError(null);
    setNotice(null);
    if (!canManage) {
      setLoading(false);
      return;
    }
    void load().catch(() => {
      if (!workspaceRequests.isWorkspaceCurrent(workspaceId)) return;
      setLoading(false);
      setLoadError(errors("loadReviewers"));
    });
  }, [canManage, errors, load, workspaceId, workspaceRequests]);

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
    } catch {
      if (request.isCurrent()) capture(errors("inviteReviewer"), errors("inviteReviewer"));
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function removeReviewer(reviewer: WorkspaceReviewer) {
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
    } catch {
      if (request.isCurrent()) setError(errors("removeReviewer"));
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
        setNotice(copy("confirmed", { reviewer: reviewerLabel(reviewer) }));
        await load();
      }
    } catch {
      if (request.isCurrent()) setError(errors("confirmExpertise"));
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function revokeInvitation(invitation: ReviewerInvitation) {
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
    } catch {
      if (request.isCurrent()) setError(errors("revokeInvitation"));
    } finally {
      if (request.isCurrent()) setBusyTarget(null);
      request.finish();
    }
  }

  async function confirmDestructiveAction() {
    const pending = confirmation;
    if (!pending) return;
    if (pending.kind === "remove-reviewer") await removeReviewer(pending.reviewer);
    else await revokeInvitation(pending.invitation);
    setConfirmation(current => (current === pending ? null : current));
  }

  if (!canManage) return null;
  const activeReviewers = reviewers.filter(reviewer => reviewer.status === "active");
  const pendingInvitations = invitations.filter(invitation => invitationStatus(invitation) === "pending");

  return (
    <section className="rounded-xl border border-base-content/10 p-5" aria-labelledby="workspace-reviewers-heading">
      <div>
        <h2 id="workspace-reviewers-heading" className="text-xl font-semibold">
          <AgentText id="reviewers" />
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-base-content/55">
          <AgentText id="translated224" />
        </p>
      </div>

      <form className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end" onSubmit={inviteReviewer}>
        <div className="min-w-0 flex-1">
          <Field
            id="workspace-reviewer-email"
            label={<AgentText id="attribute034" />}
            className="input mt-1.5 w-full rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
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
          className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)]"
          label={<AgentText id="attribute035" />}
          labelClassName="text-xs text-base-content/55"
          error={fieldErrors.maxPrivateSensitivity}
          value={maxPrivateSensitivity}
          onChange={event => {
            setMaxPrivateSensitivity(event.target.value as "internal" | "confidential" | "restricted" | "regulated");
            clear("maxPrivateSensitivity");
          }}
        >
          <option value="internal">
            <AgentText id="translated225" />
          </option>
          <option value="confidential">
            <AgentText id="translated226" />
          </option>
          <option value="restricted">
            <AgentText id="translated227" />
          </option>
          <option value="regulated">
            <AgentText id="translated228" />
          </option>
        </SelectField>
        <button className="rateloop-gradient-action min-h-12 px-5" disabled={busyTarget === "invite"}>
          {busyTarget === "invite" ? copy("inviting") : copy("invite")}
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
            <AgentText id="translated229" />
          </span>
        </label>
      </form>

      {issuedUrl ? (
        <OneTimeSecretNotice
          label={ui("reviewerInvitationLink")}
          value={issuedUrl}
          onDismiss={() => setIssuedUrl(null)}
        />
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {formError ? (
        <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
          {formError}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg bg-success/10 p-3 text-sm text-success" role="status">
          {notice}
        </p>
      ) : null}

      <AsyncSection
        className="mt-6"
        loading={loading}
        loadingLabel={copy("loading")}
        error={loadError}
        empty={activeReviewers.length === 0 && pendingInvitations.length === 0}
        emptyTitle={copy("empty")}
      >
        <div className="mt-6 border-t border-base-content/10 pt-5">
          <h3 className="text-sm font-semibold">
            <AgentText id="activeReviewers" />
          </h3>
          {activeReviewers.length ? (
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
                          <AgentText id="translated230" />{" "}
                          {copy(
                            `sensitivity${grant.maxPrivateSensitivity[0]?.toUpperCase()}${grant.maxPrivateSensitivity.slice(1)}`,
                          )}{" "}
                          <AgentText id="translated231" /> {dateLabel(grant.validUntil, locale, copy("noExpiry"))}
                        </p>
                      ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {expertiseContext?.definitions.length ? (
                      <button
                        className="btn btn-sm border-base-content/10 bg-base-content/[0.04]"
                        type="button"
                        disabled={busyTarget === reviewer.principalAddress}
                        onClick={() => void confirmReviewerExpertise(reviewer)}
                        title={copy("attest", {
                          areas: expertiseContext.definitions.map(definition => definition.label).join(", "),
                        })}
                      >
                        {busyTarget === reviewer.principalAddress ? (
                          <AgentText id="dynamic036" />
                        ) : (
                          <AgentText id="dynamic061" />
                        )}
                      </button>
                    ) : null}
                    <button
                      className="btn btn-sm border-error/20 bg-error/[0.06] text-error"
                      type="button"
                      disabled={busyTarget === reviewer.principalAddress}
                      onClick={() =>
                        setConfirmation({
                          kind: "remove-reviewer",
                          reviewer,
                          label: reviewerLabel(reviewer),
                        })
                      }
                    >
                      <AgentText id="translated232" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-base-content/55">
              <AgentText id="noActiveReviewers" />
            </p>
          )}
        </div>

        {pendingInvitations.length ? (
          <div className="mt-6 border-t border-base-content/10 pt-5">
            <h3 className="text-sm font-semibold">
              <AgentText id="pendingInvitations" />
            </h3>
            <ul className="mt-3 space-y-2">
              {pendingInvitations.map(invitation => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-base-content/[0.035] p-3 text-sm"
                  key={invitation.invitationId}
                >
                  <span>
                    {invitation.hasEmailBinding ? <AgentText id="dynamic063" /> : <AgentText id="dynamic064" />}{" "}
                    <AgentText id="translated233" /> {dateLabel(invitation.expiresAt, locale, copy("noExpiry"))}
                  </span>
                  <button
                    className="text-xs text-error underline underline-offset-4"
                    type="button"
                    disabled={busyTarget === invitation.invitationId}
                    onClick={() => setConfirmation({ kind: "revoke-invitation", invitation })}
                  >
                    <AgentText id="translated132" />
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
          confirmation?.kind === "remove-reviewer"
            ? copy("removeTitle", { reviewer: confirmation.label })
            : copy("revokeTitle")
        }
        description={confirmation?.kind === "remove-reviewer" ? copy("removeDescription") : copy("revokeDescription")}
        confirmLabel={confirmation?.kind === "remove-reviewer" ? copy("removeReviewer") : copy("revokeInvitation")}
        busy={
          confirmation?.kind === "remove-reviewer"
            ? busyTarget === confirmation.reviewer.principalAddress
            : confirmation?.kind === "revoke-invitation"
              ? busyTarget === confirmation.invitation.invitationId
              : false
        }
        onCancel={() => setConfirmation(null)}
        onConfirm={() => void confirmDestructiveAction()}
      />
    </section>
  );
}
