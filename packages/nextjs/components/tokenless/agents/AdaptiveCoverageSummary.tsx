"use client";

import React from "react";
import { useAgentFormatter, useAgentTranslations } from "./AgentsLocaleProvider";
import { Card } from "~~/components/tokenless/ui/Card";
import type {
  AdaptiveCoverageReasonCode,
  AdaptiveCoverageTile,
  EvaluationDashboard,
} from "~~/lib/tokenless/evaluationDashboard";

const reasonKeys = {
  two_stable_windows: "reasonTwoStableWindows",
  fifty_stable_cases: "reasonFiftyStableCases",
  one_hundred_stable_cases: "reasonHundredStableCases",
  safety_gates_unavailable: "reasonSafetyUnavailable",
  agreement_below_threshold: "reasonAgreementLow",
  completion_gate_failed: "reasonCompletionFailed",
  human_agreement_gate_failed: "reasonHumanAgreementFailed",
  latency_gate_failed: "reasonLatencyFailed",
  drift_gate_failed: "reasonDriftFailed",
  missing_metadata: "reasonMissingMetadata",
  severe_disagreement_open: "reasonSevereDisagreement",
  policy_evidence_changed: "reasonPolicyChanged",
} as const satisfies Record<AdaptiveCoverageReasonCode, string>;

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}

function CoverageSparkline({ coverage }: { coverage: AdaptiveCoverageTile }) {
  const format = useAgentFormatter();
  const t = useAgentTranslations("adaptive");
  const formatRate = (bps: number) =>
    format.number(bps / 10_000, {
      style: "percent",
      maximumFractionDigits: Number.isInteger(bps / 100) ? 0 : 1,
    });
  const chronological = [...coverage.changes].reverse();
  const rates =
    chronological.length > 0
      ? [chronological[0]!.fromRateBps, ...chronological.map(change => change.toRateBps)]
      : [coverage.reviewRateBps, coverage.reviewRateBps];
  const width = 144;
  const height = 42;
  const padding = 3;
  const points = rates.map((rate, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(1, rates.length - 1);
    const y = padding + ((10_000 - rate) * (height - padding * 2)) / 10_000;
    return { x, y };
  });
  const id = `adaptive-coverage-${safeId(coverage.scopeId)}`;
  const description =
    coverage.changes.length > 0
      ? t("trendMoved", { rates: rates.map(formatRate).join(t("ratesSeparator")) })
      : t("trendUnchanged", { rate: formatRate(coverage.reviewRateBps) });

  return (
    <svg
      className="h-11 w-full max-w-40 text-[var(--rateloop-blue)]"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
    >
      <title id={`${id}-title`}>{t("trendTitle")}</title>
      <desc id={`${id}-description`}>{description}</desc>
      <line
        x1={padding}
        y1={height - padding}
        x2={width - padding}
        y2={height - padding}
        stroke="currentColor"
        strokeOpacity="0.2"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={points.map(point => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map((point, index) => (
        <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r="2.5" fill="currentColor" />
      ))}
    </svg>
  );
}

export function AdaptiveCoverageSummary({ agents }: { agents: EvaluationDashboard["agents"] }) {
  const format = useAgentFormatter();
  const t = useAgentTranslations("adaptive");
  const formatRate = (bps: number) =>
    format.number(bps / 10_000, {
      style: "percent",
      maximumFractionDigits: Number.isInteger(bps / 100) ? 0 : 1,
    });
  const stageLabel = (stage: AdaptiveCoverageTile["stage"]) =>
    stage === "high_coverage"
      ? t("stageHigh")
      : stage === "medium_coverage"
        ? t("stageMedium")
        : stage === "monitoring"
          ? t("stageMonitoring")
          : t("stageCalibrating");
  const tiles = agents.flatMap(agent => agent.adaptiveCoverage.map(coverage => ({ agent, coverage })));
  if (tiles.length === 0) return null;

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="adaptive-coverage-heading">
      <h2 id="adaptive-coverage-heading" className="text-xl font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-base-content/60">{t("description")}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ agent, coverage }) => {
          const latest = coverage.changes[0];
          return (
            <Card as="article" variant="nested" key={`${agent.agentId}:${coverage.scopeId}`} className="rounded-xl p-4">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
                {agent.displayName}
              </p>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{coverage.workflowKey}</h3>
                  <p className="mt-1 text-xs text-base-content/60">
                    <span>{t("risk", { tier: coverage.riskTier })}</span> · {stageLabel(coverage.stage)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-base-content/60">{t("reviewRate")}</p>
                  <p className="mt-1 font-mono text-xl font-semibold">{formatRate(coverage.reviewRateBps)}</p>
                </div>
              </div>
              <div className="mt-3">
                <CoverageSparkline coverage={coverage} />
              </div>
              {latest ? (
                <p className="mt-2 text-xs leading-5 text-base-content/70">
                  <span className="font-semibold text-base-content">{t("why")}</span> {t(reasonKeys[latest.reason])}
                </p>
              ) : (
                <p className="mt-2 text-xs text-base-content/60">{t("noChange")}</p>
              )}
              {coverage.changes.length > 0 ? (
                <details className="mt-3 border-t border-base-content/10 pt-3">
                  <summary className="cursor-pointer rounded text-xs font-medium text-base-content/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]">
                    {t("history", { count: coverage.changes.length })}
                  </summary>
                  <ol className="mt-3 space-y-2">
                    {coverage.changes.map(change => (
                      <li key={`${change.changedAt}:${change.fromRateBps}:${change.toRateBps}`} className="text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-base-content">
                            {formatRate(change.fromRateBps)} → {formatRate(change.toRateBps)}
                          </span>
                          <time dateTime={change.changedAt} className="text-base-content/60">
                            {format.dateTime(new Date(change.changedAt), {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              timeZone: "UTC",
                            })}
                          </time>
                        </div>
                        <p className="mt-1 text-base-content/70">{t(reasonKeys[change.reason])}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </Card>
          );
        })}
      </div>
    </Card>
  );
}
