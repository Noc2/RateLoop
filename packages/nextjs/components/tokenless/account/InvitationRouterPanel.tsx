"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Card } from "~~/components/tokenless/ui/Card";
import { readJson } from "~~/lib/tokenless/http";

type ReviewerInvitationPreview = {
  workspaceName: string;
  maxPrivateSensitivity: "internal" | "confidential" | "restricted" | "regulated";
  accessExpiresAt: string | null;
  expiresAt: string | null;
};

type ReviewerInvitationPreviewState = {
  invitation: ReviewerInvitationPreview;
  token: string;
};

export type InvitationKind = "reviewer" | "workspace";

export function InvitationRouterPanel({ onAccepted }: { onAccepted?: (kind: InvitationKind) => void }) {
  const t = useTranslations("account.invitation");
  const format = useFormatter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<ReviewerInvitationPreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fragmentLoaded = useRef(false);
  const inspectControllerRef = useRef<AbortController | null>(null);
  const inspectGenerationRef = useRef(0);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

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
          await readJson(
            await fetch("/api/account/workspace-invitations/redeem", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: normalized }),
              signal: controller.signal,
            }),
          );
          if (!isCurrent()) return;
          setToken("");
          setStatus(t("workspaceAccepted"));
          onAccepted?.("workspace");
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
          setPreview({ invitation: body.invitation as ReviewerInvitationPreview, token: normalized });
          return;
        }
        if (!isCurrent()) return;
        capture({ field: "token", message: t("invalid") }, t("checkFailed"));
      } catch (cause) {
        if (!isCurrent() || controller.signal.aborted) return;
        capture(cause, t("checkFailed"));
      } finally {
        if (isCurrent()) {
          inspectControllerRef.current = null;
          setBusy(false);
        }
      }
    },
    [capture, clear, onAccepted, t],
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

  async function acceptReviewerInvitation() {
    if (!preview) return;
    const acceptedToken = preview.token;
    setBusy(true);
    setStatus(null);
    clear();
    try {
      await readJson(
        await fetch("/api/account/reviewer-invitations/redeem", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: acceptedToken }),
        }),
      );
      setPreview(null);
      setToken("");
      setStatus(t("reviewerAccepted"));
      onAccepted?.("reviewer");
    } catch (cause) {
      capture(cause, t("acceptFailed"));
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
        <button type="submit" className="rateloop-gradient-action px-5" disabled={busy || !token.trim()}>
          {busy ? t("checking") : t("continue")}
        </button>
      </form>

      {preview ? (
        <Card as="div" variant="nested" className="mt-5 rounded-xl p-5">
          <p className="text-sm text-base-content/55">{preview.invitation.workspaceName}</p>
          <h3 className="mt-1 text-lg font-semibold">{t("reviewerTitle")}</h3>
          <p className="mt-2 text-sm text-base-content/60">{t("description")}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-base-content/55">{t("materialLimit")}</dt>
              <dd className="mt-1 capitalize">{preview.invitation.maxPrivateSensitivity}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">{t("invitationExpires")}</dt>
              <dd className="mt-1">
                {preview.invitation.expiresAt
                  ? format.dateTime(new Date(preview.invitation.expiresAt), { dateStyle: "medium", timeStyle: "short" })
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
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="rateloop-gradient-action px-5"
              disabled={busy}
              onClick={acceptReviewerInvitation}
            >
              {busy ? t("accepting") : t("accept")}
            </button>
            <button type="button" className="btn rateloop-secondary-action" onClick={() => setPreview(null)}>
              {t("cancel")}
            </button>
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
