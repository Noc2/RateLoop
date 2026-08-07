"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { SelectField } from "~~/components/tokenless/forms/Field";
import { Card } from "~~/components/tokenless/ui/Card";

type Finding = {
  findingId: string;
  reasonCode: string;
  severity: "soft" | "hard";
  sourceObservationCount: string;
  payoutEffect: "none";
  consequence: "none" | "future_assignment_restriction";
  appealOpen: boolean;
  openAppealId: string | null;
  createdAt: string;
};

type IntegrityItem = {
  subjectSpace: "invited_workspace" | "network_rater";
  workspaceId: string | null;
  observationCount: number;
  brierSkillScoreBps: number | null;
  forecastVarianceBpsSquared: number;
  outcomeDiscriminationBps: number | null;
  voteDiscriminationBps: number | null;
  reasonCodes: string[];
  limitationCodes: [];
  payoutEffect: "none";
  consequence: "none" | "future_assignment_restriction" | "suspended_by_open_appeal";
  findings: Finding[];
};

type IntegrityResponse = {
  schemaVersion: "rateloop.reviewer-forecast-integrity.v1";
  items: IntegrityItem[];
};

export function formatForecastPercentage(valueBps: number) {
  const percentage = valueBps / 100;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

export function ForecastIntegrityClient() {
  const t = useTranslations("human.forecastIntegrity");
  const format = useFormatter();
  const percentage = (valueBps: number) => `${format.number(valueBps / 100, { maximumFractionDigits: 1 })}%`;
  const [data, setData] = useState<IntegrityResponse | null>(null);
  const [appealReasons, setAppealReasons] = useState<Record<string, string>>({});
  const [busyFinding, setBusyFinding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/account/forecast-integrity", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => null)) as
        | (Partial<IntegrityResponse> & { message?: string })
        | null;
      if (
        !response.ok ||
        body?.schemaVersion !== "rateloop.reviewer-forecast-integrity.v1" ||
        !Array.isArray(body.items)
      ) {
        throw new Error(body?.message ?? t("loadFailed"));
      }
      setData(body as IntegrityResponse);
    } catch {
      setError(t("loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function appeal(findingId: string) {
    setBusyFinding(findingId);
    setError(null);
    try {
      const response = await fetch("/api/account/forecast-integrity", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingId,
          reasonCode: appealReasons[findingId] ?? "context_missing",
        }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? t("openFailed"));
      await refresh();
    } catch {
      setError(t("openFailed"));
    } finally {
      setBusyFinding(null);
    }
  }

  async function withdraw(appealId: string, findingId: string) {
    setBusyFinding(findingId);
    setError(null);
    try {
      const response = await fetch("/api/account/forecast-integrity", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appealId }),
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) throw new Error(body?.message ?? t("withdrawFailed"));
      await refresh();
    } catch {
      setError(t("withdrawFailed"));
    } finally {
      setBusyFinding(null);
    }
  }

  if (!data && !error) return null;
  return (
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="forecast-integrity-title">
      <h2 id="forecast-integrity-title" className="text-xl font-semibold">
        {t("title")}
      </h2>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-error">
          {error}
        </p>
      ) : null}
      {data?.items.length ? (
        <div className="mt-5 space-y-4">
          {data.items.map((item, itemIndex) => (
            <Card
              as="article"
              variant="nested"
              className="rounded-xl p-4"
              key={`${item.subjectSpace}:${item.workspaceId ?? "network"}:${itemIndex}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {item.subjectSpace === "network_rater" ? t("network") : t("invited")}
                  </h3>
                  <p className="mt-1 text-xs text-base-content/55">
                    {t("observations", { count: item.observationCount })}
                  </p>
                </div>
                <span className="rounded-md bg-base-content/5 px-3 py-1 text-xs">
                  {t(`consequences.${item.consequence}`)}
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-base-content/55">{t("accuracy")}</dt>
                  <dd className="mt-1">
                    {item.brierSkillScoreBps === null ? t("awaitingVariety") : percentage(item.brierSkillScoreBps)}
                  </dd>
                </div>
                <div>
                  <dt className="text-base-content/55">{t("separation")}</dt>
                  <dd className="mt-1">
                    {item.outcomeDiscriminationBps === null
                      ? t("notEnough")
                      : t("pointGap", { value: percentage(item.outcomeDiscriminationBps) })}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs leading-5 text-base-content/55">{t("explanation")}</p>
              {item.findings.length ? (
                <div className="mt-4 space-y-3">
                  {item.findings.map(finding => (
                    <div className="rounded-lg border border-base-content/10 p-3" key={finding.findingId}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm">
                          {t.has(`reasons.${finding.reasonCode}`)
                            ? t(`reasons.${finding.reasonCode}`)
                            : finding.reasonCode}
                        </p>
                        <span className="text-xs text-base-content/55">
                          {finding.severity === "hard" ? t("assignmentSignal") : t("advisorySignal")}
                        </span>
                      </div>
                      {finding.appealOpen && finding.openAppealId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-warning">{t("appealOpen")}</p>
                          <button
                            type="button"
                            className="btn rateloop-secondary-action min-h-9 rounded-lg px-3 py-2 text-sm"
                            disabled={busyFinding === finding.findingId}
                            onClick={() => void withdraw(finding.openAppealId!, finding.findingId)}
                          >
                            {busyFinding === finding.findingId ? t("withdrawing") : t("withdraw")}
                          </button>
                        </div>
                      ) : finding.severity === "hard" ? (
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <SelectField
                            containerClassName="text-xs"
                            className="mt-1 block rounded-lg border-base-content/15 bg-[var(--rateloop-field)] px-3 py-2"
                            label={t("reason")}
                            labelClassName="mb-0 text-xs"
                            value={appealReasons[finding.findingId] ?? "context_missing"}
                            onChange={event =>
                              setAppealReasons(current => ({ ...current, [finding.findingId]: event.target.value }))
                            }
                          >
                            <option value="context_missing">{t("contextMissing")}</option>
                            <option value="shared_process">{t("sharedProcess")}</option>
                            <option value="measurement_error">{t("measurementError")}</option>
                            <option value="other">{t("other")}</option>
                          </SelectField>
                          <button
                            type="button"
                            className="btn rateloop-secondary-action min-h-9 rounded-lg px-3 py-2 text-sm"
                            disabled={busyFinding === finding.findingId}
                            onClick={() => void appeal(finding.findingId)}
                          >
                            {busyFinding === finding.findingId ? t("opening") : t("open")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-base-content/55">{t("empty")}</p>
              )}
            </Card>
          ))}
        </div>
      ) : data ? (
        <p className="mt-4 text-sm text-base-content/55">{t("waiting")}</p>
      ) : null}
    </Card>
  );
}
