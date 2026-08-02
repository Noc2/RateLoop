"use client";

import { type FormEvent, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Card } from "~~/components/tokenless/ui/Card";
import { betterAuthClient, issueAccountDeletionProof, readBrowserAuthConfiguration } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";

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

class DeletionFieldError extends Error {
  field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = "DeletionFieldError";
    this.field = field;
  }
}

export function AccountDeletionPanel() {
  const locale = useLocale();
  const t = useTranslations("account.deletion");
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
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  async function loadPreview() {
    setLoading(true);
    setError(null);
    try {
      const body = await readJson<DeletionPreview>(
        await fetch("/api/account/deletion", { credentials: "same-origin", cache: "no-store" }),
      );
      setPreview(body);
    } catch {
      setError(t("loadFailed"));
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
    clear();
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
    window.location.assign(locale === "en" ? "/" : `/${locale}`);
  }

  async function finishRecentAuthentication() {
    const issued = await issueAccountDeletionProof();
    await betterAuthClient.signOut().catch(() => undefined);
    await deleteAccount(issued.proof);
  }

  async function runRecentAuthentication(action: () => Promise<void>, fallback: string) {
    setReauthenticating(true);
    setError(null);
    clear();
    try {
      await action();
    } catch (cause) {
      await betterAuthClient.signOut().catch(() => undefined);
      capture(cause, fallback);
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
    }, t("verificationOptionsFailed"));
  }

  async function sendReauthCode(event: FormEvent) {
    event.preventDefault();
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.emailOtp.sendVerificationOtp({ email: reauthEmail, type: "sign-in" });
      if (response.error) {
        throw new DeletionFieldError(response.error.message || t("sendFailed"), "email");
      }
      setReauthOtpSent(true);
    }, t("sendFailed"));
  }

  async function verifyReauthCode(event: FormEvent) {
    event.preventDefault();
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.signIn.emailOtp({ email: reauthEmail, otp: reauthOtp });
      if (response.error) {
        throw new DeletionFieldError(response.error.message || t("invalidCode"), "otp");
      }
      await finishRecentAuthentication();
    }, t("verifyCodeFailed"));
  }

  async function verifyWithPasskey() {
    await runRecentAuthentication(async () => {
      const response = await betterAuthClient.signIn.passkey();
      if (response.error) throw new Error(response.error.message || t("passkeyFailed"));
      await finishRecentAuthentication();
    }, t("passkeyFailed"));
  }

  const blocked = !preview || preview.blockers.length > 0;

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="account-deletion-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h2 id="account-deletion-heading" className="text-lg font-semibold text-error">
          {t("title")}
        </h2>
        {!reviewing ? (
          <button
            type="button"
            className="btn rateloop-secondary-action btn-sm text-error"
            onClick={startDeletionReview}
          >
            {t("review")}
          </button>
        ) : null}
      </div>

      {reviewing ? (
        <div className="mt-5 border-t border-base-content/10 pt-5">
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">{t("permanent")}</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/60">{t("retention")}</p>

          {loading ? <p className="mt-5 text-sm text-base-content/55">{t("checking")}</p> : null}

          {preview ? (
            <div className="mt-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">{t("impact")}</h3>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-base-content/60">
                  <li>{t("ownedWorkspaces", { count: preview.impact.ownedWorkspaces })}</li>
                  <li>{t("sharedWorkspaces", { count: preview.impact.sharedWorkspaces })}</li>
                  <li>{t("acceptedAssignments", { count: preview.impact.acceptedAssignments })}</li>
                  <li>{t("managedWallets", { count: preview.impact.managedWallets })}</li>
                </ul>
              </div>

              {preview.impact.retainedRecords.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold">{t("retainedRecords")}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-base-content/60">
                    {preview.impact.retainedRecords.map(record => (
                      <li key={record}>{record}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview.warnings.length > 0 ? (
                <ul className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-sm leading-6 text-warning">
                  {preview.warnings.map(warning => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              {preview.blockers.length > 0 ? (
                <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3" role="alert">
                  <p className="text-sm font-semibold text-error">{t("blockers")}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-error">
                    {preview.blockers.map(blocker => (
                      <li key={blocker.code}>{blocker.message}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="max-w-sm">
                  <Field
                    id="account-deletion-confirmation"
                    label={t("confirmation")}
                    type="text"
                    value={confirmation}
                    onChange={event => {
                      setConfirmation(event.target.value);
                      clear("confirmation");
                    }}
                    className="input mt-2 w-full max-w-sm border-error/30 bg-[var(--rateloop-field)]"
                    autoComplete="off"
                    spellCheck={false}
                    error={fieldErrors.confirmation}
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {!reauthVisible ? (
                  <button
                    type="button"
                    className="btn btn-error btn-sm"
                    disabled={blocked || confirmation !== "DELETE" || submitting || reauthenticating}
                    onClick={() => void beginRecentAuthentication()}
                  >
                    {t("verifyDelete")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn rateloop-secondary-action btn-sm"
                  disabled={submitting || reauthenticating}
                  onClick={cancelDeletionReview}
                >
                  {t("cancel")}
                </button>
              </div>

              {reauthVisible ? (
                <div className="max-w-sm rounded-xl border border-error/25 bg-error/5 p-4">
                  <h3 className="text-sm font-semibold">{t("signInAgain")}</h3>
                  <p className="mt-1 text-sm leading-6 text-base-content/60">{t("verificationPurpose")}</p>
                  {!reauthConfiguration ? (
                    <p className="mt-4 text-sm text-base-content/55" role="status">
                      {t("loadingMethods")}
                    </p>
                  ) : reauthOtpSent ? (
                    <form className="mt-4 space-y-3" onSubmit={verifyReauthCode}>
                      <Field
                        id="account-deletion-otp"
                        className="input input-bordered w-full font-mono tracking-[0.25em]"
                        label={t("code")}
                        format="oneTimeCode"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                        value={reauthOtp}
                        error={fieldErrors.otp}
                        onChange={event => {
                          setReauthOtp(event.target.value.replace(/\D/g, ""));
                          clear("otp");
                        }}
                      />
                      <button
                        className="btn btn-error min-h-11 w-full"
                        disabled={reauthenticating || submitting || reauthOtp.length !== 6}
                      >
                        {submitting ? t("deleting") : t("verifyCodeDelete")}
                      </button>
                    </form>
                  ) : (
                    <>
                      <form className="mt-4 space-y-3" onSubmit={sendReauthCode}>
                        <Field
                          id="account-deletion-email"
                          className="input input-bordered w-full"
                          label={t("email")}
                          type="email"
                          autoComplete="email"
                          required
                          value={reauthEmail}
                          error={fieldErrors.email}
                          onChange={event => {
                            setReauthEmail(event.target.value);
                            clear("email");
                          }}
                        />
                        <button
                          className="btn btn-error min-h-11 w-full"
                          disabled={reauthenticating || !reauthConfiguration.methods.emailOtp}
                        >
                          {t("emailCode")}
                        </button>
                      </form>
                      {reauthConfiguration.methods.passkey ? (
                        <button
                          type="button"
                          className="btn rateloop-secondary-action mt-3 min-h-11 w-full"
                          disabled={reauthenticating}
                          onClick={() => void verifyWithPasskey()}
                        >
                          {t("verifyPasskey")}
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
          {formError ? (
            <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
              {formError}
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
