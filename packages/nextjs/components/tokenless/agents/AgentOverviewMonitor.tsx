"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { agentTabHref } from "./agentWorkspaceState";
import type {
  AgentOverview,
  AgentOverviewDecisionTimeTrendPoint,
  AgentOverviewParent,
  AgentOverviewScope,
} from "~~/lib/tokenless/agentOverview";
import { readJson } from "~~/lib/tokenless/http";

const trendDateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function percent(bps: number) {
  return `${(bps / 100).toFixed(1)}%`;
}

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "Unavailable";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} sec`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes} min${seconds ? ` ${seconds} sec` : ""}`;
}

function usdc(atomic: string) {
  try {
    const amount = BigInt(atomic);
    const whole = amount / 1_000_000n;
    const fractional = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
    return `${whole.toLocaleString()}${fractional ? `.${fractional}` : ""} USDC`;
  } catch {
    return "Unavailable";
  }
}

function stageLabel(stage: AgentOverviewScope["stage"]) {
  if (stage === "high_coverage") return "High coverage";
  if (stage === "medium_coverage") return "Medium coverage";
  return stage === "monitoring" ? "Monitoring" : "Calibrating";
}

function stageComposition(parent: AgentOverviewParent) {
  return (
    [
      ["calibrating", "calibrating"],
      ["high_coverage", "high coverage"],
      ["medium_coverage", "medium coverage"],
      ["monitoring", "monitoring"],
    ] as const
  )
    .filter(([stage]) => parent.stageCounts[stage] > 0)
    .map(([stage, label]) => `${parent.stageCounts[stage]} ${label}`)
    .join(" · ");
}

function meanTokens(scope: AgentOverviewScope) {
  if (scope.averageInputTokenTotal === null || scope.averageOutputTokenTotal === null) return "Unavailable";
  return Math.round(scope.averageInputTokenTotal + scope.averageOutputTokenTotal).toLocaleString();
}

function HeadlineCards({ overview }: { overview: AgentOverview }) {
  const endorsement = overview.headline.reviewerEndorsement;
  const latency = overview.headline.medianDecisionLatency;
  const cost = overview.headline.costPerDecision;
  return (
    <section aria-labelledby="agent-overview-headline-heading">
      <h2 id="agent-overview-headline-heading" className="sr-only">
        Overview headline metrics
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="surface-card rounded-2xl p-5">
          <p className="text-sm text-base-content/60">Completed decisions</p>
          <p className="mt-2 text-3xl font-semibold">{overview.headline.completedDecisions.toLocaleString()}</p>
          <p className="mt-2 text-xs text-base-content/55">Settled in this window</p>
        </article>
        <article className="surface-card rounded-2xl p-5">
          <p className="text-sm text-base-content/60">Reviewer endorsement</p>
          {endorsement.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{percent(endorsement.rateBps)} endorsed</p>
              <p className="mt-2 text-xs text-base-content/55">
                {percent(endorsement.intervalBps.lower)}–{percent(endorsement.intervalBps.upper)} · n ={" "}
                {endorsement.sampleSize}
                {endorsement.limitedSample ? " · too few cases to be reliable" : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">Unavailable</p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{endorsement.reason}</p>
            </>
          )}
        </article>
        <article className="surface-card rounded-2xl p-5">
          <p className="text-sm text-base-content/60">Median time to decision</p>
          {latency.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{duration(latency.milliseconds)}</p>
              <p className="mt-2 text-xs text-base-content/55">n = {latency.sampleSize} timed decisions</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">Unavailable</p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{latency.reason}</p>
            </>
          )}
        </article>
        <article className="surface-card rounded-2xl p-5">
          <p className="text-sm text-base-content/60">Cost per decision</p>
          {cost.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{usdc(cost.averageAtomic)}</p>
              <p className="mt-2 text-xs text-base-content/55">n = {cost.sampleSize} costed decisions</p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">Unavailable</p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{cost.reason}</p>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

function trendDate(date: string) {
  return trendDateFormatter.format(new Date(`${date}T00:00:00.000Z`));
}

function overviewPageFromUrl() {
  if (typeof window === "undefined") return 1;
  const value = Number(new URL(window.location.href).searchParams.get("overviewPage") ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function replaceOverviewPageInUrl(page: number) {
  const url = new URL(window.location.href);
  if (page === 1) url.searchParams.delete("overviewPage");
  else url.searchParams.set("overviewPage", String(page));
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function ReviewOutcomeTrend({ overview }: { overview: AgentOverview }) {
  const trend = overview.trends.outcomes;
  return (
    <article className="surface-card rounded-2xl p-5">
      <h3 className="text-base font-semibold">Review outcomes</h3>
      <p className="mt-1 text-sm text-base-content/55">Daily settled decisions by panel outcome.</p>
      {!trend.available ? (
        <p className="mt-6 text-sm text-base-content/55">{trend.reason}</p>
      ) : (
        <>
          {(() => {
            const width = 600;
            const height = 180;
            const left = 10;
            const top = 12;
            const bottom = 26;
            const plotHeight = height - top - bottom;
            const slotWidth = (width - left * 2) / trend.points.length;
            const barWidth = Math.max(3, Math.min(15, slotWidth * 0.72));
            const maximum = Math.max(1, ...trend.points.map(point => point.completedCount));
            return (
              <svg
                className="mt-4 h-44 w-full"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-labelledby="agent-outcomes-trend-title agent-outcomes-trend-description"
              >
                <title id="agent-outcomes-trend-title">Review outcome trend</title>
                <desc id="agent-outcomes-trend-description">
                  {trend.endorsedCount} endorsed, {trend.rejectedCount} rejected, and {trend.inconclusiveCount}{" "}
                  inconclusive decisions across {overview.window.label.toLowerCase()}.
                </desc>
                <line
                  x1={left}
                  y1={height - bottom}
                  x2={width - left}
                  y2={height - bottom}
                  stroke="currentColor"
                  strokeOpacity="0.18"
                  vectorEffect="non-scaling-stroke"
                />
                {trend.points.map((point, index) => {
                  const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
                  const endorsedHeight = (point.endorsedCount / maximum) * plotHeight;
                  const rejectedHeight = (point.rejectedCount / maximum) * plotHeight;
                  const inconclusiveHeight = (point.inconclusiveCount / maximum) * plotHeight;
                  const base = height - bottom;
                  return (
                    <g key={point.date}>
                      <rect
                        x={x}
                        y={base - endorsedHeight}
                        width={barWidth}
                        height={endorsedHeight}
                        rx="1.5"
                        className="fill-emerald-300/80"
                      />
                      <rect
                        x={x}
                        y={base - endorsedHeight - rejectedHeight}
                        width={barWidth}
                        height={rejectedHeight}
                        rx="1.5"
                        className="fill-rose-300/80"
                      />
                      <rect
                        x={x}
                        y={base - endorsedHeight - rejectedHeight - inconclusiveHeight}
                        width={barWidth}
                        height={inconclusiveHeight}
                        rx="1.5"
                        className="fill-amber-200/75"
                      />
                      {index === 0 || index === trend.points.length - 1 ? (
                        <text
                          x={x + barWidth / 2}
                          y={height - 7}
                          textAnchor="middle"
                          fill="currentColor"
                          fillOpacity="0.6"
                          fontSize="10"
                        >
                          {trendDate(point.date)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          <p className="mt-1 text-xs text-base-content/55">
            {trend.endorsedCount.toLocaleString()} endorsed · {trend.rejectedCount.toLocaleString()} rejected ·{" "}
            {trend.inconclusiveCount.toLocaleString()} inconclusive
          </p>
          <p className="mt-2 text-xs text-base-content/55">
            Rejected means the panel did not endorse the output, not that reviewers disagreed with each other.
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-base-content/55" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-300/80" /> Endorsed
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-rose-300/80" /> Rejected
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-amber-200/75" /> Inconclusive
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function decisionTimeSegments(
  points: AgentOverviewDecisionTimeTrendPoint[],
  input: { left: number; top: number; width: number; height: number; bottom: number; maximum: number },
) {
  const slotWidth = (input.width - input.left * 2) / Math.max(1, points.length - 1);
  const plotHeight = input.height - input.top - input.bottom;
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  points.forEach((point, index) => {
    if (point.medianMilliseconds === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({
      x: input.left + index * slotWidth,
      y: input.top + plotHeight - (point.medianMilliseconds / input.maximum) * plotHeight,
    });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function DecisionTimeTrend({ overview }: { overview: AgentOverview }) {
  const trend = overview.trends.decisionTime;
  return (
    <article className="surface-card rounded-2xl p-5">
      <h3 className="text-base font-semibold">Decision time</h3>
      <p className="mt-1 text-sm text-base-content/55">Daily median from review request to settled decision.</p>
      {!trend.available ? (
        <p className="mt-6 text-sm text-base-content/55">{trend.reason}</p>
      ) : (
        <>
          {(() => {
            const width = 600;
            const height = 180;
            const left = 18;
            const top = 12;
            const bottom = 26;
            const values = trend.points
              .map(point => point.medianMilliseconds)
              .filter((value): value is number => value !== null);
            const maximum = Math.max(1, ...values);
            const segments = decisionTimeSegments(trend.points, { left, top, width, height, bottom, maximum });
            const slotWidth = (width - left * 2) / Math.max(1, trend.points.length - 1);
            const plotHeight = height - top - bottom;
            return (
              <svg
                className="mt-4 h-44 w-full text-[var(--rateloop-blue)]"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-labelledby="agent-decision-time-trend-title agent-decision-time-trend-description"
              >
                <title id="agent-decision-time-trend-title">Decision-time trend</title>
                <desc id="agent-decision-time-trend-description">
                  Daily median decision time from {trendDate(trend.points[0]!.date)} to{" "}
                  {trendDate(trend.points.at(-1)!.date)}, based on {trend.sampleSize} timed decisions.
                </desc>
                <line
                  x1={left}
                  y1={height - bottom}
                  x2={width - left}
                  y2={height - bottom}
                  stroke="currentColor"
                  strokeOpacity="0.18"
                  vectorEffect="non-scaling-stroke"
                />
                {segments.map((segment, index) =>
                  segment.length > 1 ? (
                    <polyline
                      key={`segment-${index}`}
                      points={segment.map(point => `${point.x},${point.y}`).join(" ")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null,
                )}
                {trend.points.map((point, index) =>
                  point.medianMilliseconds === null ? null : (
                    <circle
                      key={point.date}
                      cx={left + index * slotWidth}
                      cy={top + plotHeight - (point.medianMilliseconds / maximum) * plotHeight}
                      r="3"
                      fill="currentColor"
                    />
                  ),
                )}
                <text x={left} y={height - 7} fill="currentColor" fillOpacity="0.6" fontSize="10">
                  {trendDate(trend.points[0]!.date)}
                </text>
                <text
                  x={width - left}
                  y={height - 7}
                  textAnchor="end"
                  fill="currentColor"
                  fillOpacity="0.6"
                  fontSize="10"
                >
                  {trendDate(trend.points.at(-1)!.date)}
                </text>
              </svg>
            );
          })()}
          <p className="mt-1 text-xs text-base-content/55">{trend.sampleSize.toLocaleString()} timed decisions</p>
        </>
      )}
    </article>
  );
}

function TrendPanels({ overview }: { overview: AgentOverview }) {
  return (
    <section aria-labelledby="agent-overview-trends-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="agent-overview-trends-heading" className="text-xl font-semibold">
          Trends
        </h2>
        <span className="text-xs text-base-content/55">{overview.trends.periodLabel}</span>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ReviewOutcomeTrend overview={overview} />
        <DecisionTimeTrend overview={overview} />
      </div>
    </section>
  );
}

function ScopeTable({ parent }: { parent: AgentOverviewParent }) {
  if (parent.scopes.length === 0) {
    return <p className="p-4 text-sm text-base-content/55">No assurance scope evidence for this version yet.</p>;
  }
  return (
    <div className="overflow-x-auto p-3">
      <table className="table table-sm min-w-[68rem]">
        <thead>
          <tr>
            <th>Scope</th>
            <th>Risk</th>
            <th>Stage</th>
            <th>Review rate</th>
            <th>Comparable</th>
            <th>Endorsement · 95% lower</th>
            <th>Agent runtime</th>
            <th>Mean tokens</th>
            <th>Last change</th>
          </tr>
        </thead>
        <tbody>
          {parent.scopes.map(scope => (
            <tr key={scope.scopeId}>
              <td>
                <span className="font-medium">{scope.workflowKey}</span>
                <code className="mt-1 block max-w-52 truncate text-[10px] text-base-content/45">{scope.scopeId}</code>
              </td>
              <td className="capitalize">{scope.riskTier}</td>
              <td>{stageLabel(scope.stage)}</td>
              <td className="font-mono">{percent(scope.reviewRateBps)}</td>
              <td className="font-mono">{scope.comparableCount.toLocaleString()}</td>
              <td className="font-mono">
                {scope.humanAgreementBps === null || scope.humanAgreementLower95Bps === null
                  ? "Unavailable"
                  : `${percent(scope.humanAgreementBps)} · ${percent(scope.humanAgreementLower95Bps)} · n=${scope.comparableCount}`}
              </td>
              <td>{duration(scope.averageTotalDurationMs)}</td>
              <td>{meanTokens(scope)}</td>
              <td>{scope.lastTransition ? new Date(scope.lastTransition.createdAt).toLocaleDateString() : "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {parent.scopesTruncated ? (
        <p className="px-2 pb-2 pt-3 text-xs text-base-content/55">
          Showing the 8 most recently updated of {parent.scopeCount} scope partitions.
        </p>
      ) : null}
    </div>
  );
}

function AgentVersionTable({
  loading,
  onPageChange,
  overview,
}: {
  loading: boolean;
  onPageChange: (page: number) => void;
  overview: AgentOverview;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const firstParent =
    overview.agentVersions.totalParentCount === 0
      ? 0
      : (overview.agentVersions.page - 1) * overview.agentVersions.pageSize + 1;
  const lastParent = firstParent + overview.agentVersions.parents.length - (firstParent === 0 ? 0 : 1);
  return (
    <section
      className="surface-card rounded-2xl p-5"
      aria-busy={loading}
      aria-labelledby="agent-version-monitor-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="agent-version-monitor-heading" className="text-xl font-semibold">
            Agent versions
          </h2>
          <p className="mt-1 text-sm text-base-content/55">
            {overview.agentVersions.periodLabel}. Parent rows show scope composition and the lowest observed scope
            bound, never an average.
          </p>
        </div>
        <span className="badge border-white/10 bg-white/[0.04]">Current versions</span>
      </div>
      {overview.agentVersions.parents.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">No connected agent versions are available.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="table min-w-[52rem]">
            <thead>
              <tr>
                <th>Agent version</th>
                <th>Scope composition</th>
                <th>Lowest observed endorsement bound</th>
                <th>
                  <span className="sr-only">Scope detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.agentVersions.parents.map(parent => {
                const open = expanded.has(parent.versionId);
                return (
                  <Fragment key={parent.versionId}>
                    <tr>
                      <td>
                        <p className="font-medium">{parent.displayName}</p>
                        <p className="mt-1 text-xs text-base-content/55">
                          v{parent.versionNumber} · {parent.environment} · {parent.agentStatus}
                        </p>
                      </td>
                      <td>
                        <p>
                          {parent.scopeCount.toLocaleString()} {parent.scopeCount === 1 ? "scope" : "scopes"}
                        </p>
                        <p className="mt-1 text-xs text-base-content/55">
                          {stageComposition(parent) || "No stage evidence"}
                        </p>
                      </td>
                      <td>
                        {parent.lowestEndorsement ? (
                          <>
                            <p className="font-mono">{percent(parent.lowestEndorsement.lower95Bps)}</p>
                            <p className="mt-1 text-xs text-base-content/55">
                              {parent.lowestEndorsement.workflowKey} · {parent.lowestEndorsement.riskTier}
                            </p>
                          </>
                        ) : (
                          <span className="text-base-content/55">Unavailable</span>
                        )}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          aria-controls={`agent-version-scopes-${parent.versionId}`}
                          aria-expanded={open}
                          onClick={() =>
                            setExpanded(current => {
                              const next = new Set(current);
                              if (next.has(parent.versionId)) next.delete(parent.versionId);
                              else next.add(parent.versionId);
                              return next;
                            })
                          }
                        >
                          {open ? "Hide scopes" : "View scopes"}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={4} id={`agent-version-scopes-${parent.versionId}`} className="bg-black/15 p-0">
                          <ScopeTable parent={parent} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className="text-xs text-base-content/55">
          {overview.agentVersions.totalParentCount === 0
            ? "No current agent versions"
            : `${firstParent}–${lastParent} of ${overview.agentVersions.totalParentCount} current agent versions`}
        </p>
        <nav className="flex items-center gap-2" aria-label="Agent version pages">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !overview.agentVersions.hasPreviousPage}
            onClick={() => onPageChange(overview.agentVersions.page - 1)}
          >
            Previous
          </button>
          <span className="min-w-24 text-center text-xs text-base-content/60">
            Page {overview.agentVersions.page} of {overview.agentVersions.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !overview.agentVersions.hasNextPage}
            onClick={() => onPageChange(overview.agentVersions.page + 1)}
          >
            Next
          </button>
        </nav>
      </div>
    </section>
  );
}

function AttentionList({ overview, workspaceId }: { overview: AgentOverview; workspaceId: string }) {
  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="agent-attention-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="agent-attention-heading" className="text-xl font-semibold">
            Attention
          </h2>
          <p className="mt-1 text-sm text-base-content/55">
            Blocked work and evidence that is objectively below its confidence requirement.
          </p>
        </div>
        <span className="text-xs text-base-content/55">{overview.attention.periodLabel}</span>
      </div>
      {overview.attention.items.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">No blocked or evidence-confidence issues need attention.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/10 rounded-xl border border-white/10">
          {overview.attention.items.map(item => (
            <li key={item.itemId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge border-white/10 bg-white/[0.04]">
                    {item.kind === "blocked"
                      ? "Blocked"
                      : item.kind === "low_confidence"
                        ? "Low confidence"
                        : "Insufficient evidence"}
                  </span>
                  <p className="font-medium">{item.displayName}</p>
                </div>
                {item.kind === "blocked" ? (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.blockedCount.toLocaleString()} blocked {item.blockedCount === 1 ? "review" : "reviews"} cannot
                    settle.
                  </p>
                ) : item.kind === "low_confidence" ? (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.workflowKey} · {item.riskTier} · 95% lower bound {percent(item.lower95Bps)} is below the{" "}
                    {percent(item.policyThresholdBps)} policy threshold · {item.rejectedCount.toLocaleString()} rejected
                    of {item.comparableCount.toLocaleString()} comparable decisions
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.workflowKey} · {item.riskTier} · n = {item.comparableCount.toLocaleString()} of{" "}
                    {item.targetComparableCount.toLocaleString()} comparable decisions
                  </p>
                )}
              </div>
              <Link
                className="btn btn-outline btn-sm shrink-0 self-start sm:self-auto"
                href={agentTabHref(
                  item.kind === "insufficient" ? "registry" : item.kind === "blocked" ? "inbox" : "evaluations",
                  workspaceId,
                )}
              >
                {item.kind === "insufficient"
                  ? "Review setup"
                  : item.kind === "blocked"
                    ? "Open approvals"
                    : "Open results"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {overview.attention.itemsTruncated ? (
        <p className="mt-3 text-xs text-base-content/55">
          Showing {overview.attention.items.length} of {overview.attention.totalItemCount} current evidence issues.
        </p>
      ) : null}
    </section>
  );
}

export function AgentOverviewMonitor({ workspaceId }: { workspaceId: string }) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [page, setPage] = useState(overviewPageFromUrl);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/overview?page=${page}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(response => readJson<AgentOverview>(response))
      .then(body => {
        if (!controller.signal.aborted) {
          setOverview(body);
          if (body.agentVersions.page !== page) {
            setPage(body.agentVersions.page);
            replaceOverviewPageInUrl(body.agentVersions.page);
          }
        }
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load overview.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, workspaceId]);

  if (loading && !overview) {
    return (
      <section className="surface-card rounded-2xl p-6" role="status">
        Loading agent monitor…
      </section>
    );
  }
  if (!overview) {
    return (
      <section className="surface-card rounded-2xl p-6 text-red-100" role="alert">
        {error ?? "Agent monitor is unavailable."}
      </section>
    );
  }
  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-5" aria-labelledby="agent-monitor-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="agent-monitor-heading" className="text-2xl font-semibold">
              Agent monitor
            </h2>
            <p className="mt-1 text-sm text-base-content/55">
              Fixed operational view. Headline metrics cover completed human-review decisions.
            </p>
          </div>
          <span className="badge border-white/10 bg-white/[0.04]">{overview.window.label}</span>
        </div>
      </section>
      <HeadlineCards overview={overview} />
      <TrendPanels overview={overview} />
      {error ? (
        <p className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
          {error}
        </p>
      ) : null}
      <AgentVersionTable
        loading={loading}
        overview={overview}
        onPageChange={nextPage => {
          replaceOverviewPageInUrl(nextPage);
          setPage(nextPage);
        }}
      />
      <AttentionList overview={overview} workspaceId={workspaceId} />
    </div>
  );
}
