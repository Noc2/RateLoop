"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";

type ReviewerInvitationPreview = {
  workspaceName: string;
  maxPrivateSensitivity: "internal" | "confidential" | "restricted" | "regulated";
  accessExpiresAt: string | null;
  expiresAt: string | null;
};

type WorkspaceInvitationPreview = {
  workspaceName: string;
  clientName: string | null;
  invitedAccessRole: "admin" | "member" | "billing";
  governanceRole: "consultant" | "end_client" | "decision_owner" | "billing" | null;
  expiresAt: string;
  currentAccessRole: "owner" | "admin" | "member" | "billing" | null;
  effectiveAccessRole: "owner" | "admin" | "member" | "billing";
  upgradesExistingMembership: boolean;
};

type InvitationPreviewState =
  | { invitation: ReviewerInvitationPreview; kind: "reviewer"; token: string }
  | { invitation: WorkspaceInvitationPreview; kind: "workspace"; token: string };

export type InvitationKind = "reviewer" | "workspace";

export function invitationErrorTranslationKey(code: string | null) {
  switch (code) {
    case "invite_not_found":
    case "reviewer_invitation_not_found":
      return "errors.notFound" as const;
    case "invite_unavailable":
    case "reviewer_invitation_unavailable":
      return "errors.unavailable" as const;
    case "invite_account_mismatch":
    case "reviewer_invitation_account_mismatch":
      return "errors.accountMismatch" as const;
    case "invite_email_mismatch":
    case "reviewer_invitation_email_mismatch":
      return "errors.emailMismatch" as const;
    case "membership_role_conflict":
      return "errors.roleConflict" as const;
    case "invalid_invite":
    case "invalid_workspace_reviewer":
      return "invalid" as const;
    default:
      return null;
  }
}

export function InvitationRouterPanel({ onAccepted }: { onAccepted?: (kind: InvitationKind) => void }) {
  const t = useTranslations("account.invitation");
  const format = useFormatter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<InvitationPreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fragmentLoaded = useRef(false);
  const inspectControllerRef = useRef<AbortController | null>(null);
  const inspectGenerationRef = useRef(0);
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  const captureInvitationError = useCallback(
    (cause: unknown, fallback: string) => {
      if (cause instanceof HttpJsonError) {
        const key = invitationErrorTranslationKey(cause.code);
        if (key) return capture({ field: cause.field, message: t(key) }, fallback);
      }
      return capture(cause, fallback);
    },
    [capture, t],
  );

  const inspectInvitation = useCallback(
    async (normalized: string) => {
      inspectControllerRef.current?.abort();
      const controller = new AbortController();
      inspectControllerRef.current = controller;
      const generation = ++inspectGenerationRef.current;
      const isCurrent = () =>
        inspectGenerationRef.current === generation && inspectControllerRef.current === controller;
      setBusy(true);
      setStatus(null);
      clear();
      setPreview(null);
      try {
        if (normalized.startsWith("rlwi_")) {
          const body = await readJson(
            await fetch("/api/account/workspace-invitations/preview", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: normalized }),
              signal: controller.signal,
            }),
          );
          if (!isCurrent()) return;
          setPreview({
            invitation: body.invitation as WorkspaceInvitationPreview,
            kind: "workspace",
            token: normalized,
          });
          return;
        }
        if (normalized.startsWith("rli_")) {
          await readJson(
            await fetch("/api/account/assurance/reviewer-invitations/redeem", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: normalized }),
              signal: controller.signal,
            }),
          );
          if (!isCurrent()) return;
          setToken("");
          setStatus(t("accepted"));
          onAccepted?.("reviewer");
          return;
        }
        if (normalized.startsWith("rlri_")) {
          const body = await readJson(
            await fetch("/api/account/reviewer-invitations/preview", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: normalized }),
              signal: controller.signal,
            }),
          );
          if (!isCurrent()) return;
          setPreview({ invitation: body.invitation as ReviewerInvitationPreview, kind: "reviewer", token: normalized });
          return;
        }
        if (!isCurrent()) return;
        capture({ field: "token", message: t("invalid") }, t("checkFailed"));
      } catch (cause) {
        if (!isCurrent() || controller.signal.aborted) return;
        captureInvitationError(cause, t("checkFailed"));
      } finally {
        if (isCurrent()) {
          inspectControllerRef.current = null;
          setBusy(false);
        }
      }
    },
    [capture, captureInvitationError, clear, onAccepted, t],
  );

  useEffect(() => {
    if (fragmentLoaded.current) return;
    fragmentLoaded.current = true;
    const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("invite")?.trim();
    if (!fragmentToken?.startsWith("rlri_")) return;
    setToken(fragmentToken);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    void inspectInvitation(fragmentToken);
  }, [inspectInvitation]);

  useEffect(
    () => () => {
      inspectGenerationRef.current += 1;
      inspectControllerRef.current?.abort();
      inspectControllerRef.current = null;
    },
    [],
  );

  function checkInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = token.trim();
    void inspectInvitation(normalized);
  }

  async function acceptInvitation() {
    if (!preview) return;
    const acceptedPreview = preview;
    setBusy(true);
    setStatus(null);
    clear();
    try {
      await readJson(
        await fetch(
          acceptedPreview.kind === "workspace"
            ? "/api/account/workspace-invitations/redeem"
            : "/api/account/reviewer-invitations/redeem",
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: acceptedPreview.token }),
          },
        ),
      );
      setPreview(null);
      setToken("");
      setStatus(t(acceptedPreview.kind === "workspace" ? "workspaceAccepted" : "reviewerAccepted"));
      onAccepted?.(acceptedPreview.kind);
    } catch (cause) {
      captureInvitationError(cause, t("acceptFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className="rounded-2xl p-6">
      <h2 className="text-2xl font-semibold">{t("title")}</h2>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={checkInvitation}>
        <div className="grow">
          <Field
            id="invitation-code"
            label={t("code")}
            type="password"
            autoComplete="off"
            value={token}
            onChange={event => {
              inspectGenerationRef.current += 1;
              inspectControllerRef.current?.abort();
              inspectControllerRef.current = null;
              setToken(event.target.value);
              setPreview(null);
              setBusy(false);
              setStatus(null);
              clear("token");
            }}
            className="input w-full border-base-content/10 bg-[var(--rateloop-field)] font-mono text-sm"
            placeholder={t("placeholder")}
            error={fieldErrors.token}
            required
          />
        </div>
        <Button variant="primary" type="submit" disabled={busy || !token.trim()}>
          {busy ? t("checking") : t("continue")}
        </Button>
      </form>

      {preview ? (
        <Card as="div" variant="nested" className="mt-5 rounded-xl p-5">
          <p className="text-sm text-base-content/55">{preview.invitation.workspaceName}</p>
          <h3 className="mt-1 text-lg font-semibold">
            {t(preview.kind === "workspace" ? "workspaceTitle" : "reviewerTitle")}
          </h3>
          <p className="mt-2 text-sm text-base-content/60">
            {t(preview.kind === "workspace" ? "workspaceDescription" : "description")}
          </p>
          {preview.kind === "workspace" ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-base-content/55">{t("workspaceRole")}</dt>
                <dd className="mt-1">{t(`accessRoles.${preview.invitation.effectiveAccessRole}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">{t("invitationExpires")}</dt>
                <dd className="mt-1">
                  {format.dateTime(new Date(preview.invitation.expiresAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              {preview.invitation.clientName ? (
                <div>
                  <dt className="text-xs text-base-content/55">{t("workspaceClient")}</dt>
                  <dd className="mt-1">{preview.invitation.clientName}</dd>
                </div>
              ) : null}
              {preview.invitation.governanceRole ? (
                <div>
                  <dt className="text-xs text-base-content/55">{t("workspaceGovernanceRole")}</dt>
                  <dd className="mt-1">{t(`governanceRoles.${preview.invitation.governanceRole}`)}</dd>
                </div>
              ) : null}
              {preview.invitation.upgradesExistingMembership && preview.invitation.currentAccessRole ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-base-content/55">{t("workspaceExistingRole")}</dt>
                  <dd className="mt-1">
                    {t("workspaceUpgrade", {
                      current: t(`accessRoles.${preview.invitation.currentAccessRole}`),
                      next: t(`accessRoles.${preview.invitation.effectiveAccessRole}`),
                    })}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-base-content/55">{t("materialLimit")}</dt>
                <dd className="mt-1">{t(`sensitivities.${preview.invitation.maxPrivateSensitivity}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">{t("invitationExpires")}</dt>
                <dd className="mt-1">
                  {preview.invitation.expiresAt
                    ? format.dateTime(new Date(preview.invitation.expiresAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : t("noExpiry")}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">{t("accessExpires")}</dt>
                <dd className="mt-1">
                  {preview.invitation.accessExpiresAt
                    ? format.dateTime(new Date(preview.invitation.accessExpiresAt), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : t("noExpiry")}
                </dd>
              </div>
            </dl>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" type="button" disabled={busy} onClick={acceptInvitation}>
              {busy ? t("accepting") : t("accept")}
            </Button>
            <Button variant="secondary" size="none" type="button" onClick={() => setPreview(null)}>
              {t("cancel")}
            </Button>
          </div>
        </Card>
      ) : null}

      {status ? (
        <p role="status" className="mt-5 rounded-lg bg-success/10 p-3 text-sm text-success">
          {status}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="mt-5 rounded-lg bg-error/10 p-3 text-sm text-error">
          {formError}
        </p>
      ) : null}
    </Card>
  );
}
