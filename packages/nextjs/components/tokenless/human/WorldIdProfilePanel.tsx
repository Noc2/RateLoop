"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { WorldIdAssuranceClient } from "~~/components/tokenless/WorldIdAssuranceClient";
import { Card } from "~~/components/tokenless/ui/Card";

type WorldIdStatus = {
  verified: boolean;
  providerId: string;
  validityModel: string | null;
  verifiedAt: string | null;
};

async function readStatus(fallbackMessage: string) {
  const response = await fetch("/api/rater/assurance/world-id/status", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof body.message === "string" ? body.message : fallbackMessage);
  }
  return body as WorldIdStatus;
}

export function WorldIdProfilePanel() {
  const t = useTranslations("human.worldId");
  const format = useFormatter();
  const [status, setStatus] = useState<WorldIdStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setStatus(await readStatus(t("loadFailed")));
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card as="section" className="rounded-2xl p-6">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {status ? (
        <div className="mt-4">
          <WorldIdAssuranceClient verified={status.verified} onVerified={refresh} />
          {status.verifiedAt ? (
            <p className="mt-3 text-xs text-base-content/55">
              {t("enrolled", {
                date: format.dateTime(new Date(status.verifiedAt), { dateStyle: "medium" }),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p role="status" className="mt-5 text-sm text-base-content/55">
          {t("loading")}
        </p>
      )}
      {error ? (
        <p role="alert" className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
