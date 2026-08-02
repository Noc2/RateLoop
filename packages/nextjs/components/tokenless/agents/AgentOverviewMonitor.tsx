"use client";

import { Fragment, useEffect, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { localizeOverviewPeriod, localizeOverviewReason, localizeQualityBucket } from "./agentOverviewLocalization";
import { agentTabHref } from "./agentWorkspaceState";
import { InfoPopover } from "~~/components/tokenless/InfoPopover";
import { SelectField } from "~~/components/tokenless/forms/Field";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
import type {
  AgentOverview,
  AgentOverviewDecisionTimeTrendPoint,
  AgentOverviewParent,
  AgentOverviewScope,
} from "~~/lib/tokenless/agentOverview";
import {
  type AgentOverviewPeriod,
  type AgentOverviewUrlState,
  agentOverviewApiSearch,
  parseAgentOverviewUrlState,
  updateAgentOverviewUrlSearch,
} from "~~/lib/tokenless/agentOverviewUrlState";
import type { AgentReviewQualityHotspot } from "~~/lib/tokenless/agentReviewQuality";
import { readJson } from "~~/lib/tokenless/http";

function percent(bps: number) {
  return `${(bps / 100).toFixed(1)}%`;
}

function duration(milliseconds: number | null, unavailable: string) {
  if (milliseconds === null) return unavailable;
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} sec`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes} min${seconds ? ` ${seconds} sec` : ""}`;
}

function usdc(atomic: string, locale: string, unavailable: string) {
  try {
    const amount = BigInt(atomic);
    const whole = amount / 1_000_000n;
    const fractional = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
    return `${whole.toLocaleString(locale)}${fractional ? `.${fractional}` : ""} USDC`;
  } catch {
    return unavailable;
  }
}

type AgentTranslate = (key: string, values?: Record<string, number | string>) => string;

function stageLabel(stage: AgentOverviewScope["stage"], t: AgentTranslate) {
  if (stage === "high_coverage") return t("stageHighCoverage");
  if (stage === "medium_coverage") return t("stageMediumCoverage");
  return stage === "monitoring" ? t("stageMonitoring") : t("stageCalibrating");
}

function stageComposition(parent: AgentOverviewParent, t: AgentTranslate) {
  return (
    [
      ["calibrating", t("stageCalibrating")],
      ["high_coverage", t("stageHighCoverage")],
      ["medium_coverage", t("stageMediumCoverage")],
      ["monitoring", t("stageMonitoring")],
    ] as const
  )
    .filter(([stage]) => parent.stageCounts[stage] > 0)
    .map(([stage, label]) => `${parent.stageCounts[stage]} ${label}`)
    .join(" · ");
}

function meanTokens(scope: AgentOverviewScope, locale: string, unavailable: string) {
  if (scope.averageInputTokenTotal === null || scope.averageOutputTokenTotal === null) return unavailable;
  return Math.round(scope.averageInputTokenTotal + scope.averageOutputTokenTotal).toLocaleString(locale);
}

function HeadlineCards({ overview }: { overview: AgentOverview }) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const completed = overview.headline.completedDecisions;
  const endorsement = overview.headline.reviewerEndorsement;
  const latency = overview.headline.medianDecisionLatency;
  const cost = overview.headline.costPerDecision;
  return (
    <section aria-labelledby="agent-overview-headline-heading">
      <h2 id="agent-overview-headline-heading" className="sr-only">
        <AgentText id="translated038" />
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card as="article" className="rounded-2xl p-5">
          <p className="text-sm text-base-content/60">
            <AgentText id="completedDecisions" />
          </p>
          {completed.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{completed.count.toLocaleString(locale)}</p>
              <p className="mt-2 text-xs text-base-content/55">
                <AgentText id="settledWindow" />
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">
                <AgentText id="unavailable" />
              </p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{completed.reason}</p>
            </>
          )}
        </Card>
        <Card as="article" className="rounded-2xl p-5">
          <p className="text-sm text-base-content/60">
            <AgentText id="reviewerEndorsement" />
          </p>
          {endorsement.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">
                {percent(endorsement.rateBps)} <AgentText id="translated039" />
              </p>
              <p className="mt-2 text-xs text-base-content/55">
                {percent(endorsement.intervalBps.lower)}–{percent(endorsement.intervalBps.upper)} · n ={" "}
                {endorsement.sampleSize}
                {endorsement.limitedSample ? ui("limitedCases") : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">
                <AgentText id="unavailable" />
              </p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{endorsement.reason}</p>
            </>
          )}
        </Card>
        <Card as="article" className="rounded-2xl p-5">
          <p className="text-sm text-base-content/60">
            <AgentText id="medianDecisionTime" />
          </p>
          {latency.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{duration(latency.milliseconds, ui("unavailable"))}</p>
              <p className="mt-2 text-xs text-base-content/55">
                n = {latency.sampleSize} <AgentText id="translated040" />
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">
                <AgentText id="unavailable" />
              </p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{latency.reason}</p>
            </>
          )}
        </Card>
        <Card as="article" className="rounded-2xl p-5">
          <p className="text-sm text-base-content/60">
            <AgentText id="costPerDecision" />
          </p>
          {cost.available ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{usdc(cost.averageAtomic, locale, ui("unavailable"))}</p>
              <p className="mt-2 text-xs text-base-content/55">
                n = {cost.sampleSize} <AgentText id="translated041" />
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-xl font-semibold">
                <AgentText id="unavailable" />
              </p>
              <p className="mt-2 text-xs leading-5 text-base-content/55">{cost.reason}</p>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

function trendDate(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function overviewUrlStateFromWindow() {
  if (typeof window === "undefined") return parseAgentOverviewUrlState("");
  return parseAgentOverviewUrlState(new URL(window.location.href).searchParams);
}

function replaceOverviewUrlState(state: AgentOverviewUrlState) {
  const url = new URL(window.location.href);
  const search = updateAgentOverviewUrlSearch(url.searchParams, state);
  window.history.replaceState(window.history.state, "", `${url.pathname}${search ? `?${search}` : ""}${url.hash}`);
}

function ReviewOutcomeTrend({ overview }: { overview: AgentOverview }) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const trend = overview.trends.outcomes;
  return (
    <Card as="article" className="rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold">
          <AgentText id="reviewOutcomes" />
        </h3>
        <InfoPopover label={ui("aboutReviewOutcomes")}>
          <AgentText id="reviewOutcomesDescription" /> <AgentText id="translated048" />
        </InfoPopover>
      </div>
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
                <title id="agent-outcomes-trend-title">
                  <AgentText id="reviewOutcomeTrend" />
                </title>
                <desc id="agent-outcomes-trend-description">
                  {trend.endorsedCount} <AgentText id="translated042" /> {trend.rejectedCount}{" "}
                  <AgentText id="translated043" /> {trend.inconclusiveCount} <AgentText id="translated044" />{" "}
                  {overview.window.label.toLowerCase()}.
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
                        className="fill-[var(--rateloop-green)]"
                      />
                      <rect
                        x={x}
                        y={base - endorsedHeight - rejectedHeight}
                        width={barWidth}
                        height={rejectedHeight}
                        rx="1.5"
                        className="fill-[var(--rateloop-pink)]"
                      />
                      <rect
                        x={x}
                        y={base - endorsedHeight - rejectedHeight - inconclusiveHeight}
                        width={barWidth}
                        height={inconclusiveHeight}
                        rx="1.5"
                        className="fill-[var(--rateloop-yellow)]"
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
                          {trendDate(point.date, locale)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </svg>
            );
          })()}
          <p className="mt-1 text-xs text-base-content/55">
            {trend.endorsedCount.toLocaleString(locale)} <AgentText id="translated045" />{" "}
            {trend.rejectedCount.toLocaleString(locale)} <AgentText id="translated046" />{" "}
            {trend.inconclusiveCount.toLocaleString(locale)} <AgentText id="translated047" />
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-base-content/55" aria-hidden="true">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-green)]" /> <AgentText id="translated049" />
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-pink)]" /> <AgentText id="translated050" />
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-yellow)]" /> <AgentText id="translated051" />
            </span>
          </div>
        </>
      )}
    </Card>
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
  const locale = useAgentLocale();
  const trend = overview.trends.decisionTime;
  return (
    <Card as="article" className="rounded-2xl p-5">
      <h3 className="text-base font-semibold">
        <AgentText id="decisionTime" />
      </h3>
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
                <title id="agent-decision-time-trend-title">
                  <AgentText id="decisionTimeTrend" />
                </title>
                <desc id="agent-decision-time-trend-description">
                  <AgentText id="translated052" /> {trendDate(trend.points[0]!.date, locale)}{" "}
                  <AgentText id="translated053" /> {trendDate(trend.points.at(-1)!.date, locale)}
                  <AgentText id="translated054" /> {trend.sampleSize} <AgentText id="translated055" />
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
                  {trendDate(trend.points[0]!.date, locale)}
                </text>
                <text
                  x={width - left}
                  y={height - 7}
                  textAnchor="end"
                  fill="currentColor"
                  fillOpacity="0.6"
                  fontSize="10"
                >
                  {trendDate(trend.points.at(-1)!.date, locale)}
                </text>
              </svg>
            );
          })()}
          <p className="mt-1 text-xs text-base-content/55">
            {trend.sampleSize.toLocaleString(locale)} <AgentText id="translated040" />
          </p>
        </>
      )}
    </Card>
  );
}

function TrendPanels({ overview }: { overview: AgentOverview }) {
  const ui = useAgentTranslations("ui");
  return (
    <section aria-labelledby="agent-overview-trends-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="agent-overview-trends-heading" className="text-xl font-semibold">
          <AgentText id="translated056" />
        </h2>
        <span className="text-xs text-base-content/55">{localizeOverviewPeriod(overview.trends.periodLabel, ui)}</span>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ReviewOutcomeTrend overview={overview} />
        <DecisionTimeTrend overview={overview} />
      </div>
    </section>
  );
}

function privacyThresholdLabel(overview: AgentOverview, t: AgentTranslate) {
  const threshold = overview.reviewQuality.privacyThreshold;
  if (!threshold) return null;
  return threshold.minimum === threshold.maximum
    ? t("reviewerCount", { count: threshold.minimum })
    : t("reviewerRange", { minimum: threshold.minimum, maximum: threshold.maximum });
}

function QualityDistribution({
  rows,
  unit,
}: {
  rows: Array<{ key: string; label: string; count: number; shareBps: number }>;
  unit: "cases" | "decisions";
}) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  return (
    <div className="mt-4 space-y-3">
      {rows.map(row => {
        const label = localizeQualityBucket(row.key, row.label, unit, ui);
        return (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs text-base-content/60">
              <span>{label}</span>
              <span className="font-mono">
                {percent(row.shareBps)} · n = {row.count.toLocaleString(locale)}
              </span>
            </div>
            <progress
              className="progress progress-primary h-1.5 w-full"
              max={10_000}
              value={row.shareBps}
              aria-label={`${label}: ${percent(row.shareBps)}, ${row.count} ${ui(unit === "cases" ? "cases" : "decisions")}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function QualityHotspots({ emptyMessage, hotspots }: { emptyMessage: string; hotspots: AgentReviewQualityHotspot[] }) {
  const locale = useAgentLocale();
  if (hotspots.length === 0) return <p className="mt-4 text-sm text-base-content/55">{emptyMessage}</p>;
  return (
    <ol className="mt-4 divide-y divide-base-content/10">
      {hotspots.map(hotspot => (
        <li key={hotspot.key} className="py-3 first:pt-0 last:pb-0">
          <p className="truncate text-sm font-medium">{hotspot.label}</p>
          <p className="mt-1 text-xs text-base-content/55">
            {percent(hotspot.splitRateBps)} <AgentText id="translated057" /> {percent(hotspot.dissentRateBps)}{" "}
            <AgentText id="translated058" /> {hotspot.caseCount.toLocaleString(locale)} <AgentText id="translated059" />
          </p>
        </li>
      ))}
    </ol>
  );
}

function ReviewQualityPanel({ overview }: { overview: AgentOverview }) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const quality = overview.reviewQuality;
  const threshold = privacyThresholdLabel(overview, ui);
  const privacyCopy = threshold ? ui("privacyThresholdMet", { threshold }) : ui("privacyThresholdPending");
  return (
    <section aria-labelledby="agent-review-quality-heading">
      <div className="mb-3">
        <div>
          <h2 id="agent-review-quality-heading" className="text-xl font-semibold">
            <AgentText id="translated060" />
          </h2>
          <p className="mt-1 text-sm text-base-content/55">
            <AgentText id="translated061" />
          </p>
        </div>
      </div>
      {quality.availability !== "available" ? (
        <Card as="article" className="rounded-2xl p-5">
          <p className="font-medium">
            {quality.availability === "suppressed" ? <AgentText id="dynamic009" /> : <AgentText id="dynamic005" />}
          </p>
          <p className="mt-2 text-sm text-base-content/55">
            {quality.consensus.available ? (
              <AgentText id="dynamic010" />
            ) : (
              localizeOverviewReason(quality.consensus.reason, ui)
            )}
          </p>
          <p className="mt-2 text-xs text-base-content/55">{privacyCopy}</p>
        </Card>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-4">
            <Card as="article" className="rounded-2xl p-5">
              <h3 className="text-base font-semibold">
                <AgentText id="reviewerConsensus" />
              </h3>
              {quality.consensus.available ? (
                <>
                  <p className="mt-2 text-3xl font-semibold">
                    {percent(quality.consensus.unanimityRateBps)} <AgentText id="translated062" />
                  </p>
                  <p className="mt-2 text-xs text-base-content/55">
                    {quality.consensus.unanimousCaseCount.toLocaleString(locale)} <AgentText id="translated063" />{" "}
                    {quality.consensus.caseCount.toLocaleString(locale)} <AgentText id="translated059" />
                    {quality.consensus.limitedSample ? ui("limitedCases") : ""}
                  </p>
                </>
              ) : null}
            </Card>
            <Card as="article" className="rounded-2xl p-5">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">
                  <AgentText id="reviewerConsistency" />
                </h3>
                <InfoPopover label={ui("aboutReviewerConsistency")}>
                  <AgentText id="translated064" />
                </InfoPopover>
              </div>
              {quality.reviewerConsistency.available ? (
                <>
                  <p className="mt-2 text-3xl font-semibold">
                    α = {(quality.reviewerConsistency.alphaMilli / 1_000).toFixed(3)}
                  </p>
                  <p className="mt-2 text-xs text-base-content/55">
                    n = {quality.reviewerConsistency.caseCount.toLocaleString(locale)} <AgentText id="translated065" />{" "}
                    {quality.reviewerConsistency.ratingCount.toLocaleString(locale)} <AgentText id="translated066" />
                    {quality.reviewerConsistency.limitedSample ? ui("limitedCases") : ""}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-base-content/55">
                  {localizeOverviewReason(quality.reviewerConsistency.reason, ui)}
                </p>
              )}
            </Card>
            <Card as="article" className="rounded-2xl p-5 xl:col-span-2">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">
                  <AgentText id="panelSplit" />
                </h3>
                <InfoPopover label={ui("aboutPanelSplit")}>
                  <AgentText id="translated067" />
                </InfoPopover>
              </div>
              {quality.panelSplit.available ? (
                <QualityDistribution
                  unit="cases"
                  rows={quality.panelSplit.buckets.map(bucket => ({
                    key: bucket.key,
                    label: bucket.label,
                    count: bucket.caseCount,
                    shareBps: bucket.shareBps,
                  }))}
                />
              ) : null}
            </Card>
          </div>
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <Card as="article" className="rounded-2xl p-5">
              <h3 className="text-base font-semibold">
                <AgentText id="timeToDecision" />
              </h3>
              {quality.decisionTime.available ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-base-content/55">
                        <AgentText id="median" />
                      </p>
                      <p className="mt-1 text-xl font-semibold">
                        {duration(quality.decisionTime.medianMilliseconds, ui("unavailable"))}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-base-content/55">
                        <AgentText id="percentile95" />
                      </p>
                      <p className="mt-1 text-xl font-semibold">
                        {duration(quality.decisionTime.p95Milliseconds, ui("unavailable"))}
                      </p>
                    </div>
                  </div>
                  <QualityDistribution
                    unit="decisions"
                    rows={quality.decisionTime.buckets.map(bucket => ({
                      key: bucket.key,
                      label: bucket.label,
                      count: bucket.decisionCount,
                      shareBps: bucket.shareBps,
                    }))}
                  />
                  <p className="mt-3 text-xs text-base-content/55">
                    n = {quality.decisionTime.sampleSize.toLocaleString(locale)} <AgentText id="translated068" />
                    {quality.decisionTime.limitedSample ? ui("limitedDecisions") : ""}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-base-content/55">
                  {localizeOverviewReason(quality.decisionTime.reason, ui)}
                </p>
              )}
            </Card>
            <Card as="article" className="rounded-2xl p-5">
              <h3 className="text-base font-semibold">
                <AgentText id="workflowHotspots" />
              </h3>
              <QualityHotspots hotspots={quality.hotspots.workflows} emptyMessage={ui("noWorkflowHotspots")} />
            </Card>
            <Card as="article" className="rounded-2xl p-5">
              <h3 className="text-base font-semibold">
                <AgentText id="riskHotspots" />
              </h3>
              <QualityHotspots hotspots={quality.hotspots.riskTiers} emptyMessage={ui("noRiskHotspots")} />
            </Card>
          </div>
          {quality.hotspots.cases.length > 0 ? (
            <Card as="article" className="mt-5 rounded-2xl p-5">
              <h3 className="text-base font-semibold">
                <AgentText id="caseHotspots" />
              </h3>
              <QualityHotspots hotspots={quality.hotspots.cases} emptyMessage="" />
            </Card>
          ) : null}
          <p className="mt-3 text-xs text-base-content/55">{privacyCopy}</p>
        </>
      )}
    </section>
  );
}

function ScopeTable({ parent }: { parent: AgentOverviewParent }) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  if (parent.scopes.length === 0) {
    return (
      <p className="p-4 text-sm text-base-content/55">
        <AgentText id="noScopeEvidence" />
      </p>
    );
  }
  return (
    <div className="overflow-x-auto p-3">
      <table className="table table-sm min-w-[68rem]">
        <thead>
          <tr>
            <th>
              <AgentText id="scope" />
            </th>
            <th>
              <AgentText id="risk" />
            </th>
            <th>
              <AgentText id="stage" />
            </th>
            <th>
              <AgentText id="reviewRate" />
            </th>
            <th>
              <AgentText id="comparable" />
            </th>
            <th>
              <AgentText id="endorsementLower" />
            </th>
            <th>
              <AgentText id="agentRuntime" />
            </th>
            <th>
              <AgentText id="meanTokens" />
            </th>
            <th>
              <AgentText id="lastChange" />
            </th>
          </tr>
        </thead>
        <tbody>
          {parent.scopes.map(scope => (
            <tr key={scope.scopeId}>
              <td>
                <span className="font-medium">{scope.workflowKey}</span>
                <code className="mt-1 block max-w-52 truncate text-[10px] text-base-content/55">{scope.scopeId}</code>
              </td>
              <td className="capitalize">{scope.riskTier}</td>
              <td>{stageLabel(scope.stage, ui)}</td>
              <td className="font-mono">{percent(scope.reviewRateBps)}</td>
              <td className="font-mono">{scope.comparableCount.toLocaleString(locale)}</td>
              <td className="font-mono">
                {scope.humanAgreementBps === null || scope.humanAgreementLower95Bps === null ? (
                  <AgentText id="dynamic012" />
                ) : (
                  `${percent(scope.humanAgreementBps)} · ${percent(scope.humanAgreementLower95Bps)} · n=${scope.comparableCount}`
                )}
              </td>
              <td>{duration(scope.averageTotalDurationMs, ui("unavailable"))}</td>
              <td>{meanTokens(scope, locale, ui("unavailable"))}</td>
              <td>
                {scope.lastTransition ? (
                  new Date(scope.lastTransition.createdAt).toLocaleDateString(locale)
                ) : (
                  <AgentText id="dynamic006" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {parent.scopesTruncated ? (
        <p className="px-2 pb-2 pt-3 text-xs text-base-content/55">
          <AgentText id="translated069" /> {parent.scopeCount} <AgentText id="translated070" />
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
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const firstParent =
    overview.agentVersions.totalParentCount === 0
      ? 0
      : (overview.agentVersions.page - 1) * overview.agentVersions.pageSize + 1;
  const lastParent = firstParent + overview.agentVersions.parents.length - (firstParent === 0 ? 0 : 1);
  return (
    <Card as="section" className="rounded-2xl p-5" aria-busy={loading} aria-labelledby="agent-version-monitor-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="agent-version-monitor-heading" className="text-xl font-semibold">
          <AgentText id="translated071" />
        </h2>
        <span className="badge border-base-content/10 bg-base-content/[0.04]">
          <AgentText id="currentVersions" />
        </span>
      </div>
      {overview.agentVersions.parents.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">
          <AgentText id="translated073" />
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="table min-w-[52rem]">
            <thead>
              <tr>
                <th>
                  <AgentText id="agentVersion" />
                </th>
                <th>
                  <AgentText id="scopeComposition" />
                </th>
                <th>
                  <AgentText id="lowestEndorsement" />
                </th>
                <th>
                  <span className="sr-only">
                    <AgentText id="scopeDetail" />
                  </span>
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
                          {parent.scopeCount.toLocaleString(locale)}{" "}
                          {parent.scopeCount === 1 ? ui("scopeOne") : ui("scopeMany")}
                        </p>
                        <p className="mt-1 text-xs text-base-content/55">
                          {stageComposition(parent, ui) || ui("noStageEvidence")}
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
                          <span className="text-base-content/55">
                            <AgentText id="unavailable" />
                          </span>
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
                          {open ? ui("hideScopes") : ui("viewScopes")}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td
                          colSpan={4}
                          id={`agent-version-scopes-${parent.versionId}`}
                          className="bg-base-content/[0.025] p-0"
                        >
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
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-base-content/10 pt-4">
        <p className="text-xs text-base-content/55">
          {overview.agentVersions.totalParentCount === 0 ? (
            <AgentText id="dynamic004" />
          ) : (
            ui("agentVersionRange", {
              first: firstParent,
              last: lastParent,
              total: overview.agentVersions.totalParentCount,
            })
          )}
        </p>
        <nav className="flex items-center gap-2" aria-label={ui("agentVersionPages")}>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !overview.agentVersions.hasPreviousPage}
            onClick={() => onPageChange(overview.agentVersions.page - 1)}
          >
            <AgentText id="translated074" />
          </button>
          <span className="min-w-24 text-center text-xs text-base-content/60">
            <AgentText id="translated075" /> {overview.agentVersions.page} <AgentText id="translated063" />{" "}
            {overview.agentVersions.totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={loading || !overview.agentVersions.hasNextPage}
            onClick={() => onPageChange(overview.agentVersions.page + 1)}
          >
            <AgentText id="translated076" />
          </button>
        </nav>
      </div>
    </Card>
  );
}

function AttentionList({ overview, workspaceId }: { overview: AgentOverview; workspaceId: string }) {
  const locale = useAgentLocale();
  const ui = useAgentTranslations("ui");
  return (
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="agent-attention-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="agent-attention-heading" className="text-xl font-semibold">
          <AgentText id="translated077" />
        </h2>
        <span className="text-xs text-base-content/55">
          {localizeOverviewPeriod(overview.attention.periodLabel, ui)}
        </span>
      </div>
      {overview.attention.items.length === 0 ? (
        <p className="mt-5 text-sm text-base-content/55">
          <AgentText id="noAttention" />
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-base-content/10 rounded-xl border border-base-content/10">
          {overview.attention.items.map(item => (
            <li key={item.itemId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge border-base-content/10 bg-base-content/[0.04]">
                    {item.kind === "blocked" ? (
                      <AgentText id="dynamic003" />
                    ) : item.kind === "low_confidence" ? (
                      ui("lowConfidence")
                    ) : (
                      ui("insufficientEvidence")
                    )}
                  </span>
                  <p className="font-medium">{item.displayName}</p>
                </div>
                {item.kind === "blocked" ? (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.blockedCount.toLocaleString(locale)} <AgentText id="translated079" />{" "}
                    {item.blockedCount === 1 ? ui("reviewOne") : ui("reviewMany")} <AgentText id="translated080" />
                  </p>
                ) : item.kind === "low_confidence" ? (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.workflowKey} · {item.riskTier} · 95% lower bound {percent(item.lower95Bps)}{" "}
                    <AgentText id="translated081" /> {percent(item.policyThresholdBps)} <AgentText id="translated082" />{" "}
                    {item.rejectedCount.toLocaleString(locale)} <AgentText id="translated083" />{" "}
                    {item.comparableCount.toLocaleString(locale)} <AgentText id="translated084" />
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-base-content/60">
                    {item.workflowKey} · {item.riskTier} · n = {item.comparableCount.toLocaleString(locale)}{" "}
                    <AgentText id="translated063" /> {item.targetComparableCount.toLocaleString(locale)}{" "}
                    <AgentText id="translated084" />
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
                {item.kind === "insufficient" ? (
                  <AgentText id="dynamic011" />
                ) : item.kind === "blocked" ? (
                  <AgentText id="dynamic007" />
                ) : (
                  <AgentText id="dynamic008" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {overview.attention.itemsTruncated ? (
        <p className="mt-3 text-xs text-base-content/55">
          <AgentText id="translated085" /> {overview.attention.items.length} <AgentText id="translated063" />{" "}
          {overview.attention.totalItemCount} <AgentText id="translated086" />
        </p>
      ) : null}
    </Card>
  );
}

const OVERVIEW_PERIOD_OPTIONS: Array<{ value: AgentOverviewPeriod; labelKey: string }> = [
  { value: "7", labelKey: "period7Days" },
  { value: "30", labelKey: "period30Days" },
  { value: "90", labelKey: "period90Days" },
  { value: "lifetime", labelKey: "periodLifetime" },
];

function OverviewControls({
  loading,
  onChange,
  overview,
  query,
}: {
  loading: boolean;
  onChange: (patch: Partial<AgentOverviewUrlState>) => void;
  overview: AgentOverview;
  query: AgentOverviewUrlState;
}) {
  const ui = useAgentTranslations("ui");
  const hasFilters = Boolean(query.workflow || query.riskTier || query.stage || query.versionId);
  const selectClassName = "select-sm bg-base-content/[0.04]";
  const labelClassName = "mb-1 text-xs text-base-content/65";
  return (
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="agent-overview-filters-heading">
      <h2 id="agent-overview-filters-heading" className="sr-only">
        <AgentText id="translated087" />
      </h2>
      {hasFilters ? (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={loading}
            onClick={() => onChange({ workflow: null, riskTier: null, stage: null, versionId: null, page: 1 })}
          >
            <AgentText id="translated089" />
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SelectField
          label={<AgentText id="attribute001" />}
          labelClassName={labelClassName}
          className={selectClassName}
          value={query.period}
          disabled={loading}
          onChange={event => onChange({ period: event.target.value as AgentOverviewPeriod, page: 1 })}
        >
          {OVERVIEW_PERIOD_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {ui(option.labelKey)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={<AgentText id="attribute002" />}
          labelClassName={labelClassName}
          className={selectClassName}
          value={query.workflow ?? ""}
          disabled={loading}
          onChange={event => onChange({ workflow: event.target.value || null, page: 1 })}
        >
          <option value="">
            <AgentText id="allWorkflows" />
          </option>
          {overview.facets.workflows.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={<AgentText id="attribute003" />}
          labelClassName={labelClassName}
          className={selectClassName}
          value={query.riskTier ?? ""}
          disabled={loading}
          onChange={event => onChange({ riskTier: event.target.value || null, page: 1 })}
        >
          <option value="">
            <AgentText id="allRiskTiers" />
          </option>
          {overview.facets.riskTiers.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={<AgentText id="attribute004" />}
          labelClassName={labelClassName}
          className={selectClassName}
          value={query.stage ?? ""}
          disabled={loading}
          onChange={event =>
            onChange({
              stage: (event.target.value || null) as AgentOverviewUrlState["stage"],
              page: 1,
            })
          }
        >
          <option value="">
            <AgentText id="allStages" />
          </option>
          {overview.facets.stages.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={<AgentText id="attribute005" />}
          labelClassName={labelClassName}
          className={selectClassName}
          value={query.versionId ?? ""}
          disabled={loading}
          onChange={event => onChange({ versionId: event.target.value || null, page: 1 })}
        >
          <option value="">
            <AgentText id="allCurrentVersions" />
          </option>
          {overview.facets.versions.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectField>
      </div>
      {overview.facets.optionsTruncated ? (
        <p className="mt-3 text-xs text-base-content/55">
          <AgentText id="translated090" />
        </p>
      ) : null}
    </Card>
  );
}

export function AgentOverviewMonitor({ workspaceId }: { workspaceId: string }) {
  const errors = useAgentTranslations("errors");
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [query, setQuery] = useState(overviewUrlStateFromWindow);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const syncFromHistory = () => setQuery(overviewUrlStateFromWindow());
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const apiSearch = agentOverviewApiSearch(query);
    void fetch(
      `/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/overview${apiSearch ? `?${apiSearch}` : ""}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(response => readJson<AgentOverview>(response))
      .then(body => {
        if (!controller.signal.aborted) {
          setOverview(body);
          const resolvedQuery: AgentOverviewUrlState = {
            ...query,
            workflow: body.facets.selected.workflow,
            riskTier: body.facets.selected.riskTier,
            stage: body.facets.selected.stage,
            versionId: body.facets.selected.versionId,
            page: body.agentVersions.page,
          };
          if (agentOverviewApiSearch(resolvedQuery) !== agentOverviewApiSearch(query)) {
            replaceOverviewUrlState(resolvedQuery);
            setQuery(resolvedQuery);
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(errors("loadOverview"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [errors, query, workspaceId]);

  const updateQuery = (patch: Partial<AgentOverviewUrlState>) => {
    const next = { ...query, ...patch };
    replaceOverviewUrlState(next);
    setQuery(next);
  };

  if (loading && !overview) {
    return (
      <Card as="section" className="rounded-2xl p-6" role="status">
        <AgentText id="translated091" />
      </Card>
    );
  }
  if (!overview) {
    return (
      <Card as="section" className="rounded-2xl p-6 text-error" role="alert">
        {error ?? <AgentText id="dynamic002" />}
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <OverviewControls loading={loading} overview={overview} query={query} onChange={updateQuery} />
      <HeadlineCards overview={overview} />
      {error ? (
        <p className="rounded-xl border border-error/20 bg-error/[0.06] p-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      <AgentVersionTable loading={loading} overview={overview} onPageChange={page => updateQuery({ page })} />
      <TrendPanels overview={overview} />
      <ReviewQualityPanel overview={overview} />
      <AttentionList overview={overview} workspaceId={workspaceId} />
    </div>
  );
}
