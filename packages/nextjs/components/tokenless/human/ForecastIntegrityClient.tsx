"use client";

import { useCallback, useEffect, useState } from "react";

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

const REASON_LABELS: Record<string, string> = {
  forecast_invariant: "Forecasts changed too little",
  forecast_discrimination_absent: "Forecasts did not distinguish outcomes",
  forecast_vote_decoupled: "Forecasts moved independently of your ratings",
  forecast_pair_lockstep: "A reviewer pair moved in lockstep",
};

const CONSEQUENCE_LABELS: Record<IntegrityItem["consequence"], string> = {
  none: "No assignment effect",
  future_assignment_restriction: "New assignments paused",
  suspended_by_open_appeal: "Assignment pause suspended during appeal",
};

export function ForecastIntegrityClient() {
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
        throw new Error(body?.message ?? "Unable to load forecast integrity.");
      }
      setData(body as IntegrityResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load forecast integrity.");
    }
  }, []);

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
      if (!response.ok) throw new Error(body?.message ?? "Unable to open the appeal.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open the appeal.");
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
      if (!response.ok) throw new Error(body?.message ?? "Unable to withdraw the appeal.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to withdraw the appeal.");
    } finally {
      setBusyFinding(null);
    }
  }

  if (!data && !error) return null;
  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="forecast-integrity-title">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Review quality</p>
      <h2 id="forecast-integrity-title" className="mt-2 text-xl font-semibold">
        Crowd forecast record
      </h2>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      {data?.items.length ? (
        <div className="mt-5 space-y-4">
          {data.items.map((item, itemIndex) => (
            <article
              className="surface-card-nested rounded-xl p-4"
              key={`${item.subjectSpace}:${item.workspaceId ?? "network"}:${itemIndex}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">
                    {item.subjectSpace === "network_rater" ? "Network reviews" : "Invited workspace reviews"}
                  </h3>
                  <p className="mt-1 text-xs text-base-content/55">{item.observationCount} terminal forecasts</p>
                </div>
                <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{CONSEQUENCE_LABELS[item.consequence]}</span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-base-content/55">Brier skill</dt>
                  <dd className="mt-1">
                    {item.brierSkillScoreBps === null ? "Awaiting outcome variety" : `${item.brierSkillScoreBps} bps`}
                  </dd>
                </div>
                <div>
                  <dt className="text-base-content/55">Outcome discrimination</dt>
                  <dd className="mt-1">
                    {item.outcomeDiscriminationBps === null
                      ? "Not enough outcomes"
                      : `${item.outcomeDiscriminationBps} bps`}
                  </dd>
                </div>
                <div>
                  <dt className="text-base-content/55">Payment effect</dt>
                  <dd className="mt-1">None</dd>
                </div>
              </dl>
              {item.findings.length ? (
                <div className="mt-4 space-y-3">
                  {item.findings.map(finding => (
                    <div className="rounded-lg border border-white/10 p-3" key={finding.findingId}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm">{REASON_LABELS[finding.reasonCode] ?? finding.reasonCode}</p>
                        <span className="text-xs text-base-content/55">
                          {finding.severity === "hard" ? "Assignment signal" : "Advisory signal"}
                        </span>
                      </div>
                      {finding.appealOpen && finding.openAppealId ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-xs text-amber-100">
                            Appeal open. Only this finding’s assignment consequence is suspended.
                          </p>
                          <button
                            type="button"
                            className="rateloop-secondary-action rounded-lg px-3 py-2 text-sm"
                            disabled={busyFinding === finding.findingId}
                            onClick={() => void withdraw(finding.openAppealId!, finding.findingId)}
                          >
                            {busyFinding === finding.findingId ? "Withdrawing…" : "Withdraw appeal"}
                          </button>
                        </div>
                      ) : finding.severity === "hard" ? (
                        <div className="mt-3 flex flex-wrap items-end gap-2">
                          <label className="text-xs">
                            Appeal reason
                            <select
                              className="mt-1 block rounded-lg border border-white/15 bg-black px-3 py-2"
                              value={appealReasons[finding.findingId] ?? "context_missing"}
                              onChange={event =>
                                setAppealReasons(current => ({ ...current, [finding.findingId]: event.target.value }))
                              }
                            >
                              <option value="context_missing">Context was missing</option>
                              <option value="shared_process">Shared review process</option>
                              <option value="measurement_error">Measurement error</option>
                              <option value="other">Other</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            className="rateloop-secondary-action rounded-lg px-3 py-2 text-sm"
                            disabled={busyFinding === finding.findingId}
                            onClick={() => void appeal(finding.findingId)}
                          >
                            {busyFinding === finding.findingId ? "Opening…" : "Open appeal"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-base-content/55">No forecast integrity findings.</p>
              )}
            </article>
          ))}
        </div>
      ) : data ? (
        <p className="mt-4 text-sm text-base-content/55">
          Counters appear after a terminal review includes a forecast.
        </p>
      ) : null}
    </section>
  );
}
