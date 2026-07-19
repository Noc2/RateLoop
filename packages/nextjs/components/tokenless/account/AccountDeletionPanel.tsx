"use client";

import { type FormEvent, useState } from "react";
import { betterAuthClient, issueAccountDeletionProof, readBrowserAuthConfiguration } from "~~/lib/auth/client";

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
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: unknown };
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "Unable to process account deletion.",
    );
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
  const [reauthenticating, setReauthenticating] = useState(false);
  const [reauthVisible, setReauthVisible] = useState(false);
  const [reauthConfiguration, setReauthConfiguration] = useState<Awaited<
    ReturnType<typeof readBrowserAuthConfiguration>
  > | null>(null);
  const [reauthEmail, setReauthEmail] = useState("");
  const [reauthOtp, setReauthOtp] = useState("");
  const [reauthOtpSent, setReauthOtpSent] = useState(false);
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
    setReauthVisible(false);
    setReauthEmail("");
    setReauthOtp("");
    setReauthOtpSent(false);
    setError(null);
  }

  async function deleteAccount(recentAuthProof: string) {
    setSubmitting(true);
    await readJson<{ deleted: true }>(
      await fetch("/api/account/deletion", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE", recentAuthProof }),
      }),
    );
    window.location.assign("/");
  }

  async function finishRecentAuthentication() {
    const issued = await issueAccountDeletionProof();
    await betterAuthClient.signOut().catch(() => undefined);
    await deleteAccount(issued.proof);
  }

  async function runRecentAuthentication(action: () => Promise<void>, fallback: string) {
    setReauthenticating(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      await betterAuthClient.signOut().catch(() => undefined);
      setError(cause instanceof Error ? cause.message : fallback);
      setSubmitting(false);
    } finally {
      setReauthenticating(false);
    }
  }

  async function beginRecentAuthentication() {
    if (!preview || preview.blockers.length > 0 || confirmation !== "DELETE") return;
    setReauthVisible(true);
    await runRecentAuthentication(async () => {
      await betterAuthClient.signOut().catch(() => undefined);
      setReauthConfiguration(await readBrowserAuthConfiguration());
    }, "Unable to load sign-in options.");
  }

  async function sendReauthCode(event: FormEvent) {
    event.preventDefault();
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.emailOtp.sendVerificationOtp({ email: reauthEmail, type: "sign-in" });
      if (response.error) throw new Error(response.error.message || "Unable to send the sign-in code.");
      setReauthOtpSent(true);
    }, "Unable to send the sign-in code.");
  }

  async function verifyReauthCode(event: FormEvent) {
    event.preventDefault();
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.signIn.emailOtp({ email: reauthEmail, otp: reauthOtp });
      if (response.error) throw new Error(response.error.message || "The sign-in code is invalid or expired.");
      await finishRecentAuthentication();
    }, "Unable to verify the sign-in code.");
  }

  async function verifyWithPasskey() {
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.signIn.passkey();
      if (response.error) throw new Error(response.error.message || "Passkey verification failed.");
      await finishRecentAuthentication();
    }, "Passkey verification failed.");
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
                {!reauthVisible ? (
                  <button
                    type="button"
                    className="btn btn-error btn-sm"
                    disabled={blocked || confirmation !== "DELETE" || submitting || reauthenticating}
                    onClick={() => void beginRecentAuthentication()}
                  >
                    Verify and delete
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn rateloop-secondary-action btn-sm"
                  disabled={submitting || reauthenticating}
                  onClick={cancelDeletionReview}
                >
                  Cancel
                </button>
              </div>

              {reauthVisible ? (
                <div className="max-w-sm rounded-xl border border-error/25 bg-error/5 p-4">
                  <h3 className="text-sm font-semibold">Sign in again to delete</h3>
                  <p className="mt-1 text-sm leading-6 text-base-content/60">
                    This verification is valid only for this deletion.
                  </p>
                  {!reauthConfiguration ? (
                    <p className="mt-4 text-sm text-base-content/50" role="status">
                      Loading sign-in options…
                    </p>
                  ) : reauthOtpSent ? (
                    <form className="mt-4 space-y-3" onSubmit={verifyReauthCode}>
                      <label className="block text-sm font-medium" htmlFor="account-deletion-otp">
                        Six-digit code
                      </label>
                      <input
                        id="account-deletion-otp"
                        className="input input-bordered w-full font-mono tracking-[0.25em]"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        required
                        value={reauthOtp}
                        onChange={event => setReauthOtp(event.target.value.replace(/\D/g, ""))}
                      />
                      <button
                        className="btn btn-error min-h-11 w-full"
                        disabled={reauthenticating || submitting || reauthOtp.length !== 6}
                      >
                        {submitting ? "Deleting…" : "Verify code and delete"}
                      </button>
                    </form>
                  ) : (
                    <>
                      <form className="mt-4 space-y-3" onSubmit={sendReauthCode}>
                        <label className="block text-sm font-medium" htmlFor="account-deletion-email">
                          Account email
                        </label>
                        <input
                          id="account-deletion-email"
                          className="input input-bordered w-full"
                          type="email"
                          autoComplete="email"
                          required
                          value={reauthEmail}
                          onChange={event => setReauthEmail(event.target.value)}
                        />
                        <button
                          className="btn btn-error min-h-11 w-full"
                          disabled={reauthenticating || !reauthConfiguration.methods.emailOtp}
                        >
                          Email a code
                        </button>
                      </form>
                      {reauthConfiguration.methods.passkey ? (
                        <button
                          type="button"
                          className="btn rateloop-secondary-action mt-3 min-h-11 w-full"
                          disabled={reauthenticating}
                          onClick={() => void verifyWithPasskey()}
                        >
                          Verify with a passkey
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
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
