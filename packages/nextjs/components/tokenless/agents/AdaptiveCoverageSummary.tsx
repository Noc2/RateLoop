import React from "react";
import type {
  AdaptiveCoverageReasonCode,
  AdaptiveCoverageTile,
  EvaluationDashboard,
} from "~~/lib/tokenless/evaluationDashboard";

const reasonLabels: Record<AdaptiveCoverageReasonCode, string> = {
  two_stable_windows: "Two stable review windows",
  fifty_stable_cases: "50 stable comparable cases",
  one_hundred_stable_cases: "100 stable comparable cases",
  safety_gates_unavailable: "Safety evidence is not available; review returned to 100%",
  agreement_below_threshold: "Agreement fell below the policy threshold",
  completion_gate_failed: "Completion evidence missed its gate",
  human_agreement_gate_failed: "Human agreement missed its gate",
  latency_gate_failed: "Review latency missed its gate",
  drift_gate_failed: "Comparable results drifted",
  missing_metadata: "Required decision context was missing",
  severe_disagreement_open: "A severe disagreement remains open",
  policy_evidence_changed: "Policy evidence changed",
};

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function formatRate(bps: number) {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function stageLabel(stage: AdaptiveCoverageTile["stage"]) {
  if (stage === "high_coverage") return "High coverage";
  if (stage === "medium_coverage") return "Medium coverage";
  return stage === "monitoring" ? "Monitoring" : "Calibrating";
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}

function CoverageSparkline({ coverage }: { coverage: AdaptiveCoverageTile }) {
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
      ? `Baseline review coverage moved ${rates.map(formatRate).join(" to ")}.`
      : `Baseline review coverage remains ${formatRate(coverage.reviewRateBps)}; no change is recorded.`;

  return (
    <svg
      className="h-11 w-full max-w-40 text-[var(--rateloop-blue)]"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby={`${id}-title ${id}-description`}
    >
      <title id={`${id}-title`}>Adaptive review-rate trend</title>
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
  const tiles = agents.flatMap(agent => agent.adaptiveCoverage.map(coverage => ({ agent, coverage })));
  if (tiles.length === 0) return null;

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="adaptive-coverage-heading">
      <h2 id="adaptive-coverage-heading" className="text-xl font-semibold">
        Adaptive coverage
      </h2>
      <p className="mt-1 text-sm text-base-content/60">Review rates change only after evidence gates pass.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ agent, coverage }) => {
          const latest = coverage.changes[0];
          return (
            <article key={`${agent.agentId}:${coverage.scopeId}`} className="surface-card-nested rounded-xl p-4">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">
                {agent.displayName}
              </p>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{coverage.workflowKey}</h3>
                  <p className="mt-1 text-xs text-base-content/60">
                    <span className="capitalize">{coverage.riskTier} risk</span> · {stageLabel(coverage.stage)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-base-content/60">Review rate</p>
                  <p className="mt-1 font-mono text-xl font-semibold">{formatRate(coverage.reviewRateBps)}</p>
                </div>
              </div>
              <div className="mt-3">
                <CoverageSparkline coverage={coverage} />
              </div>
              {latest ? (
                <p className="mt-2 text-xs leading-5 text-base-content/70">
                  <span className="font-semibold text-base-content">Why:</span> {reasonLabels[latest.reason]}
                </p>
              ) : (
                <p className="mt-2 text-xs text-base-content/60">No rate change yet.</p>
              )}
              {coverage.changes.length > 0 ? (
                <details className="mt-3 border-t border-white/10 pt-3">
                  <summary className="cursor-pointer rounded text-xs font-medium text-base-content/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rateloop-blue)]">
                    Rate history ({coverage.changes.length})
                  </summary>
                  <ol className="mt-3 space-y-2">
                    {coverage.changes.map(change => (
                      <li key={`${change.changedAt}:${change.fromRateBps}:${change.toRateBps}`} className="text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-base-content">
                            {formatRate(change.fromRateBps)} → {formatRate(change.toRateBps)}
                          </span>
                          <time dateTime={change.changedAt} className="text-base-content/60">
                            {dateFormatter.format(new Date(change.changedAt))}
                          </time>
                        </div>
                        <p className="mt-1 text-base-content/70">{reasonLabels[change.reason]}</p>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
