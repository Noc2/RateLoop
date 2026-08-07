"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Field } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
import { notifyBrowserAuthSessionChanged } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";

type Profile = {
  principalAddress: string;
  displayName: string | null;
  profileDisplayName: string | null;
  providerDisplayName: string | null;
  updatedAt: string | null;
};

export function ProfileClient() {
  const t = useTranslations("account.profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  const refresh = useCallback(
    async (signal: AbortSignal) => {
      const profileBody = await readJson<Profile>(
        await fetch("/api/account/profile", { cache: "no-store", credentials: "same-origin", signal }),
        { fallbackMessage: t("loadFailed") },
      );
      if (signal.aborted) return;
      const nextProfile = profileBody;
      setProfile(nextProfile);
      setDisplayName(nextProfile.profileDisplayName ?? "");
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void refresh(controller.signal)
      .catch(cause => {
        if (!controller.signal.aborted) capture(cause, t("loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [capture, refresh, t]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !profile || busy) return;
    setBusy(true);
    clear();
    setSaved(false);
    try {
      const body = await readJson<Profile>(
        await fetch("/api/account/profile", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName }),
        }),
        { fallbackMessage: t("saveFailed") },
      );
      const nextProfile = body;
      setProfile(nextProfile);
      setDisplayName(nextProfile.profileDisplayName ?? "");
      notifyBrowserAuthSessionChanged();
      setSaved(true);
    } catch (cause) {
      capture(cause, t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card as="section" className="rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="profile-display-name-heading" className="text-xl font-semibold">
              {t("title")}
            </h2>
          </div>
          <Button as={Link} variant="secondary" size="sm" href="/settings/wallets">
            {t("wallets")}
          </Button>
        </div>
        <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" aria-busy={loading} onSubmit={save}>
          <div className="grow">
            <Field
              id="profile-display-name"
              label={t("label")}
              value={displayName}
              onChange={event => {
                setDisplayName(event.target.value);
                clear("displayName");
              }}
              disabled={loading || !profile || busy}
              className="input w-full border-base-content/10 bg-[var(--rateloop-field)]"
              maxLength={80}
              placeholder={profile?.providerDisplayName ?? t("placeholder")}
              error={fieldErrors.displayName}
            />
          </div>
          <Button variant="primary" type="submit" disabled={loading || !profile || busy}>
            {loading ? t("loading") : busy ? t("saving") : t("save")}
          </Button>
        </form>
        {saved ? <p className="mt-3 text-sm text-success">{t("saved")}</p> : null}
        {formError ? (
          <p className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error" role="alert">
            {formError}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
