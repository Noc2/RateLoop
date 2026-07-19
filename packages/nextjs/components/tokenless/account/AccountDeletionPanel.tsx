"use client";

import { useState } from "react";
import { betterAuthClient } from "~~/lib/auth/client";

type DeletionBlocker = {
  code: string;
  message: string;
};

type DeletionPreview = {
  blockers: DeletionBlocker[];
  impact: {
    ownedWorkspaces: number;
    sharedWorkspaces: number;
    acceptedAssignments: number;
    managedWallets: number;
    retainedRecords: string[];
  };
  warnings: string[];
};

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : "Unable to process account deletion.");
  }
  return body;
}

function itemCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function AccountDeletionPanel() {
  const [reviewing, setReviewing] = useState(false);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const body = await readJson<DeletionPreview>(
        await fetch("/api/account/deletion", { credentials: "same-origin", cache: "no-store" }),
      );
      setPreview(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load account deletion details.");
    } finally {
      setLoading(false);
    }
  }

  function startDeletionReview() {
    setReviewing(true);
    if (!preview && !loading) void loadPreview();
  }

  function cancelDeletionReview() {
    setReviewing(false);
    setConfirmation("");
    setError(null);
  }

  async function deleteAccount() {
    if (!preview || preview.blockers.length > 0 || confirmation !== "DELETE") return;
    setSubmitting(true);
    setError(null);
    try {
      await readJson<{ deleted: true }>(
        await fetch("/api/account/deletion", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "DELETE" }),
        }),
      );
      await betterAuthClient.signOut().catch(() => undefined);
      window.location.assign("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this account.");
      setSubmitting(false);
    }
  }

  const blocked = !preview || preview.blockers.length > 0;

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="account-deletion-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="account-deletion-heading" className="text-lg font-semibold text-error">
            Delete account
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Review what will be deleted and which records must remain.
          </p>
        </div>
        {!reviewing ? (
          <button
            type="button"
            className="btn rateloop-secondary-action btn-sm text-error"
            onClick={startDeletionReview}
          >
            Review account deletion
          </button>
        ) : null}
      </div>

      {reviewing ? (
        <div className="mt-5 border-t border-white/10 pt-5">
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            This permanently ends the current account. Signing in again, even with the same email address, creates a new
            account and a new RateLoop identity.
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">
            Eligible private data is erased. Public blockchain entries and records required for legal, tax, settlement,
            or security purposes may be retained only as required.
          </p>

          {loading ? <p className="mt-5 text-sm text-base-content/50">Checking what will be deleted…</p> : null}

          {preview ? (
            <div className="mt-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Account impact</h3>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-base-content/60">
                  <li>{itemCount(preview.impact.ownedWorkspaces, "owned workspace")}</li>
                  <li>{itemCount(preview.impact.sharedWorkspaces, "shared workspace")}</li>
                  <li>{itemCount(preview.impact.acceptedAssignments, "accepted assignment")}</li>
                  <li>{itemCount(preview.impact.managedWallets, "managed wallet")}</li>
                </ul>
              </div>

              {preview.impact.retainedRecords.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold">Records retained where required</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-base-content/60">
                    {preview.impact.retainedRecords.map(record => (
                      <li key={record}>{record}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.warnings.length > 0 ? (
                <ul className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-sm leading-6 text-amber-100">
                  {preview.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              {preview.blockers.length > 0 ? (
                <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3" role="alert">
                  <p className="text-sm font-semibold text-error">Resolve these items before deleting the account:</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-error">
                    {preview.blockers.map(blocker => (
                      <li key={blocker.code}>{blocker.message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <label className="block text-sm text-base-content/70" htmlFor="account-deletion-confirmation">
                  Type DELETE to confirm
                  <input
                    id="account-deletion-confirmation"
                    type="text"
                    value={confirmation}
                    onChange={event => setConfirmation(event.target.value)}
                    className="input mt-2 w-full max-w-sm border-error/30 bg-[var(--rateloop-field)]"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-error btn-sm"
                  disabled={blocked || confirmation !== "DELETE" || submitting}
                  onClick={() => void deleteAccount()}
                >
                  {submitting ? "Deleting…" : "Delete account permanently"}
                </button>
                <button
                  type="button"
                  className="btn rateloop-secondary-action btn-sm"
                  disabled={submitting}
                  onClick={cancelDeletionReview}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
