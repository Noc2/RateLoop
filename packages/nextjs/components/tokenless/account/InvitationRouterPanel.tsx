"use client";

import { FormEvent, useState } from "react";

type ReviewerInvitationPreview = {
  workspaceName: string;
  maxPrivateSensitivity: "internal" | "confidential" | "restricted" | "regulated";
  accessExpiresAt: string | null;
  expiresAt: string | null;
};

export type InvitationKind = "reviewer" | "workspace";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No expiry";
}

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function InvitationRouterPanel({ onAccepted }: { onAccepted?: (kind: InvitationKind) => void }) {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<ReviewerInvitationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = token.trim();
    setBusy(true);
    setStatus(null);
    setError(null);
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
        setStatus("Workspace invitation accepted.");
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
        setStatus("Invitation accepted.");
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
      throw new Error("Enter a valid RateLoop invitation code.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to check the invitation.");
    } finally {
      setBusy(false);
    }
  }

  async function acceptReviewerInvitation() {
    if (!preview) return;
    setBusy(true);
    setStatus(null);
    setError(null);
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
      setStatus("Reviewer invitation accepted.");
      onAccepted?.("reviewer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to accept the invitation.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-card rounded-2xl p-6">
      <h2 className="text-2xl font-semibold">Add invitation</h2>
      <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={checkInvitation}>
        <div className="grow">
          <input
            aria-label="Invitation code"
            type="password"
            autoComplete="off"
            value={token}
            onChange={event => {
              setToken(event.target.value);
              setPreview(null);
              setStatus(null);
              setError(null);
            }}
            className="input w-full border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
            placeholder="Paste invitation code"
            required
          />
        </div>
        <button type="submit" className="rateloop-gradient-action px-5" disabled={busy || !token.trim()}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>

      {preview ? (
        <div className="surface-card-nested mt-5 rounded-xl p-5">
          <p className="text-sm text-base-content/55">{preview.workspaceName}</p>
          <h3 className="mt-1 text-lg font-semibold">Reviewer invitation</h3>
          <p className="mt-2 text-sm text-base-content/60">
            Review assigned private work without joining the workspace.
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-base-content/45">Private material limit</dt>
              <dd className="mt-1 capitalize">{preview.maxPrivateSensitivity}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Invitation expires</dt>
              <dd className="mt-1">{formatDate(preview.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-base-content/45">Reviewer access expires</dt>
              <dd className="mt-1">{formatDate(preview.accessExpiresAt)}</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="rateloop-gradient-action px-5"
              disabled={busy}
              onClick={acceptReviewerInvitation}
            >
              {busy ? "Accepting…" : "Accept invitation"}
            </button>
            <button type="button" className="btn rateloop-secondary-action" onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {status ? (
        <p role="status" className="mt-5 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">
          {status}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-5 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
          {error}
        </p>
      ) : null}
    </section>
  );
}
