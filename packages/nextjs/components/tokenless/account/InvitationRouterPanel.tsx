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

export type InvitationKind = "reviewer" | "workspace";

export function InvitationRouterPanel({ onAccepted }: { onAccepted?: (kind: InvitationKind) => void }) {
  const t = useTranslations("account.invitation");
  const format = useFormatter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<ReviewerInvitationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const fragmentLoaded = useRef(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const inspectInvitation = useCallback(
    async (normalized: string) => {
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
            }),
          );
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
            }),
          );
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
            }),
          );
          setPreview(body.invitation as ReviewerInvitationPreview);
          return;
        }
        capture({ field: "token", message: t("invalid") }, t("checkFailed"));
      } catch (cause) {
        capture(cause, t("checkFailed"));
      } finally {
        setBusy(false);
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

  function checkInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = token.trim();
    setBusy(true);
    void inspectInvitation(normalized);
  }

  async function acceptReviewerInvitation() {
    if (!preview) return;
    setBusy(true);
    setStatus(null);
    clear();
    try {
      await readJson(
        await fetch("/api/account/reviewer-invitations/redeem", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.trim() }),
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
              setToken(event.target.value);
              setPreview(null);
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
          <p className="text-sm text-base-content/55">{preview.workspaceName}</p>
          <h3 className="mt-1 text-lg font-semibold">{t("reviewerTitle")}</h3>
          <p className="mt-2 text-sm text-base-content/60">{t("description")}</p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-base-content/55">{t("materialLimit")}</dt>
              <dd className="mt-1 capitalize">{preview.maxPrivateSensitivity}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">{t("invitationExpires")}</dt>
              <dd className="mt-1">
                {preview.expiresAt
                  ? format.dateTime(new Date(preview.expiresAt), { dateStyle: "medium", timeStyle: "short" })
                  : t("noExpiry")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/55">{t("accessExpires")}</dt>
              <dd className="mt-1">
                {preview.accessExpiresAt
                  ? format.dateTime(new Date(preview.accessExpiresAt), { dateStyle: "medium", timeStyle: "short" })
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
