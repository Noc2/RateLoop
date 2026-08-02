"use client";

import React, { useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { SelectField } from "~~/components/tokenless/forms/Field";
import { Card } from "~~/components/tokenless/ui/Card";
import type {
  EvaluationModelDailyPoint,
  EvaluationModelExecution,
  EvaluationModelProfile,
  EvaluationModelScope,
} from "~~/lib/tokenless/evaluationDashboard";

function modelName(profile: EvaluationModelProfile["primary"]) {
  return profile.resolvedModel ?? profile.requestedModel;
}

type Translate = (key: string, values?: Record<string, number | string>) => string;

function profileLabel(profile: EvaluationModelProfile, copy: Translate) {
  const version = profile.primary.modelVersion ? ` · ${profile.primary.modelVersion}` : "";
  const contributors =
    profile.contributors.length > 0 ? ` + ${copy("contributorsMore", { count: profile.contributors.length })}` : "";
  return `${profile.primary.provider} · ${modelName(profile.primary)}${version}${contributors}`;
}

function percent(bps: number | null, copy: Translate, format: ReturnType<typeof useAgentFormatter>) {
  return bps === null
    ? copy("pending")
    : `${format.number(bps / 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function duration(milliseconds: number | null, copy: Translate, format: ReturnType<typeof useAgentFormatter>) {
  if (milliseconds === null) return copy("notReported");
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return copy("seconds", {
    value: format.number(milliseconds / 1_000, {
      minimumFractionDigits: milliseconds < 10_000 ? 1 : 0,
      maximumFractionDigits: milliseconds < 10_000 ? 1 : 0,
    }),
  });
}

function tokenCount(value: number | null, locale: string) {
  return value === null ? "—" : value.toLocaleString(locale);
}

function stageLabel(stage: EvaluationModelScope["stage"], copy: Translate) {
  return copy(`stage.${stage}`);
}

function reviewLabel(execution: EvaluationModelExecution, copy: Translate) {
  const known = new Set(["completed", "review_requested", "skipped", "failed", "decided"]);
  return copy(
    `review.${execution.reviewStatus && known.has(execution.reviewStatus) ? execution.reviewStatus : "not_evaluated"}`,
  );
}

function riskLabel(riskTier: string, copy: Translate) {
  return copy(`risk.${["low", "medium", "high", "critical"].includes(riskTier) ? riskTier : "unknown"}`);
}

function agreementLabel(agreement: string, copy: Translate) {
  return copy(`agreement.${["agreed", "disagreed"].includes(agreement) ? agreement : "unknown"}`);
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}

export function modelVolumeCalendarPoints(daily: EvaluationModelDailyPoint[], endDate = new Date()) {
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  if (!Number.isFinite(end.getTime())) throw new Error("The model-volume end date is invalid.");
  const byDate = new Map(daily.map(point => [point.date, point]));
  return Array.from({ length: 14 }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (13 - index));
    const key = date.toISOString().slice(0, 10);
    return (
      byDate.get(key) ?? {
        date: key,
        executionCount: 0,
        opportunityCount: 0,
        reviewRequestedCount: 0,
        comparableCount: 0,
        agreementCount: 0,
      }
    );
  });
}

function EvaluationVolumeChart({ profile }: { profile: EvaluationModelProfile }) {
  const copy = useAgentTranslations("evidencePanels.model");
  const points = modelVolumeCalendarPoints(profile.daily);
  const width = 560;
  const height = 150;
  const left = 12;
  const top = 12;
  const bottom = 24;
  const plotHeight = height - top - bottom;
  const slotWidth = (width - left * 2) / Math.max(points.length, 1);
  const barWidth = Math.max(4, Math.min(22, slotWidth * 0.62));
  const maximum = Math.max(1, ...points.map(point => point.opportunityCount));
  const id = `model-volume-${safeId(profile.profileHash)}`;
  const totals = points.reduce(
    (sum, point) => ({
      opportunities: sum.opportunities + point.opportunityCount,
      reviewed: sum.reviewed + point.reviewRequestedCount,
    }),
    { opportunities: 0, reviewed: 0 },
  );

  return (
    <div>
      <h3 className="text-sm font-semibold">
        <AgentText id="evaluationVolume" />
      </h3>
      <p className="mt-1 text-xs text-base-content/55">
        <AgentText id="evaluationVolumeDescription" />
      </p>
      {profile.daily.length > 0 ? (
        <svg
          className="mt-4 h-40 w-full text-[var(--rateloop-blue)]"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
        >
          <title id={`${id}-title`}>{copy("volumeFor", { profile: profileLabel(profile, copy) })}</title>
          <desc id={`${id}-description`}>
            {totals.opportunities} <AgentText id="translated197" /> {totals.reviewed} <AgentText id="translated198" />{" "}
            {points.length}
            <AgentText id="translated199" />
          </desc>
          <line
            x1={left}
            y1={height - bottom}
            x2={width - left}
            y2={height - bottom}
            stroke="currentColor"
            strokeOpacity="0.2"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((point, index) => {
            const x = left + index * slotWidth + (slotWidth - barWidth) / 2;
            const opportunityHeight = (point.opportunityCount / maximum) * plotHeight;
            const reviewHeight = (point.reviewRequestedCount / maximum) * plotHeight;
            return (
              <g key={point.date}>
                <rect
                  x={x}
                  y={height - bottom - opportunityHeight}
                  width={barWidth}
                  height={opportunityHeight}
                  rx="2"
                  fill="currentColor"
                  fillOpacity="0.7"
                />
                <rect
                  x={x}
                  y={height - bottom - reviewHeight}
                  width={barWidth}
                  height={reviewHeight}
                  rx="2"
                  fill="currentColor"
                  fillOpacity="0.9"
                />
                {index === 0 || index === points.length - 1 ? (
                  <text
                    x={x + barWidth / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fill="currentColor"
                    fillOpacity="0.65"
                    fontSize="10"
                  >
                    {point.date.slice(5)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noRequestHistory" />
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-base-content/55" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-blue)]/70" /> <AgentText id="translated200" />
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-blue)]" /> <AgentText id="translated201" />
        </span>
      </div>
    </div>
  );
}

function AgreementChart({ profile }: { profile: EvaluationModelProfile }) {
  const copy = useAgentTranslations("evidencePanels.model");
  const locale = useAgentLocale();
  const agreed = profile.agreementCount;
  const disagreed = Math.max(0, profile.comparableCount - agreed);
  const total = Math.max(1, profile.comparableCount);
  const agreedWidth = `${(agreed / total) * 100}%`;
  const disagreedWidth = `${(disagreed / total) * 100}%`;

  return (
    <div>
      <h3 className="text-sm font-semibold">
        <AgentText id="humanAgreement" />
      </h3>
      <p className="mt-1 text-xs text-base-content/55">
        <AgentText id="humanAgreementDescription" />
      </p>
      {profile.comparableCount > 0 ? (
        <div
          className="mt-6"
          role="img"
          aria-label={copy("agreementAria", {
            agreed,
            disagreed,
            profile: profileLabel(profile, copy),
          })}
        >
          <div className="flex h-5 overflow-hidden rounded-full bg-base-content/[0.06]">
            <div className="bg-[var(--rateloop-green)]" style={{ width: agreedWidth }} />
            <div className="bg-[var(--rateloop-pink)]" style={{ width: disagreedWidth }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-base-content/55">
                <AgentText id="agreed" />
              </p>
              <p className="mt-1 font-mono text-lg">{agreed.toLocaleString(locale)}</p>
            </div>
            <div>
              <p className="text-xs text-base-content/55">
                <AgentText id="disagreed" />
              </p>
              <p className="mt-1 font-mono text-lg">{disagreed.toLocaleString(locale)}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/55">
          <AgentText id="noComparableResults" />
        </p>
      )}
    </div>
  );
}

function ModelScopeList({ scopes }: { scopes: EvaluationModelScope[] }) {
  const copy = useAgentTranslations("evidencePanels.model");
  const visible = scopes.slice(0, 6);
  const additional = scopes.slice(6);
  if (visible.length === 0) return null;
  const cards = (items: EvaluationModelScope[]) =>
    items.map(scope => (
      <Card as="div" variant="nested" key={scope.scopeId} className="rounded-xl p-3 text-sm">
        <p className="font-medium">{scope.workflowKey}</p>
        <p className="mt-1 text-xs text-base-content/55">
          <span className="capitalize">
            {riskLabel(scope.riskTier, copy)} <AgentText id="translated202" />
          </span>{" "}
          · {stageLabel(scope.stage, copy)}
        </p>
      </Card>
    ));
  return (
    <section aria-labelledby="model-coverage-heading">
      <h3 id="model-coverage-heading" className="text-sm font-semibold">
        <AgentText id="translated203" />
      </h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cards(visible)}</div>
      {additional.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-base-content/65">
            <AgentText id="translated204" /> {additional.length} <AgentText id="translated205" />
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cards(additional)}</div>
        </details>
      ) : null}
    </section>
  );
}

function RecentExecutions({ executions }: { executions: EvaluationModelExecution[] }) {
  const copy = useAgentTranslations("evidencePanels.model");
  const format = useAgentFormatter();
  const locale = useAgentLocale();
  if (executions.length === 0) return null;
  return (
    <section aria-labelledby="model-requests-heading">
      <h3 id="model-requests-heading" className="text-sm font-semibold">
        <AgentText id="translated206" />
      </h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-base-content/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-base-content/[0.03] text-xs text-base-content/55">
            <tr>
              <th className="px-4 py-3 font-medium">
                <AgentText id="time" />
              </th>
              <th className="px-4 py-3 font-medium">
                <AgentText id="scope" />
              </th>
              <th className="px-4 py-3 font-medium">
                <AgentText id="execution" />
              </th>
              <th className="px-4 py-3 font-medium">
                <AgentText id="tokens" />
              </th>
              <th className="px-4 py-3 font-medium">
                <AgentText id="review" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base-content/10">
            {executions.slice(0, 10).map(execution => (
              <tr key={execution.executionId}>
                <td className="px-4 py-3 text-xs text-base-content/60">
                  <time dateTime={execution.occurredAt}>
                    {format.dateTime(new Date(execution.occurredAt), {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </time>
                </td>
                <td className="px-4 py-3">
                  <p>{execution.workflowKey ?? <AgentText id="dynamic050" />}</p>
                  {execution.riskTier ? (
                    <p className="mt-1 text-xs capitalize text-base-content/55">
                      {riskLabel(execution.riskTier, copy)} <AgentText id="translated202" />
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p>
                    {copy(execution.modelCallCount === 1 ? "modelCallOne" : "modelCallMany", {
                      count: execution.modelCallCount,
                    })}
                  </p>
                  <p className="mt-1 text-xs text-base-content/55">{duration(execution.durationMs, copy, format)}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {tokenCount(execution.inputTokens, locale)} <AgentText id="translated207" />{" "}
                  {tokenCount(execution.outputTokens, locale)} <AgentText id="translated208" />
                </td>
                <td className="px-4 py-3">
                  <p>{reviewLabel(execution, copy)}</p>
                  {execution.agreement ? (
                    <p className="mt-1 text-xs text-base-content/55">{agreementLabel(execution.agreement, copy)}</p>
                  ) : null}
                  {execution.metadataComplete === false ? (
                    <p className="mt-1 text-xs text-warning/80">
                      <AgentText id="metadataIncomplete" />
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ModelEvidencePanel({ profiles }: { profiles: EvaluationModelProfile[] }) {
  const copy = useAgentTranslations("evidencePanels.model");
  const format = useAgentFormatter();
  const locale = useAgentLocale();
  const [selectedProfileHash, setSelectedProfileHash] = useState("");
  const selected = profiles.find(profile => profile.profileHash === selectedProfileHash) ?? profiles[0] ?? null;
  if (!selected) return null;

  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="model-evidence-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="model-evidence-heading" className="text-xl font-semibold">
            <AgentText id="translated209" />
          </h2>
          <p className="mt-1 text-sm text-base-content/60">
            <AgentText id="executionEvidence" />
          </p>
        </div>
        {profiles.length > 1 ? (
          <SelectField
            containerClassName="lg:min-w-80"
            className="border-base-content/10 bg-[var(--rateloop-field)]"
            label={<AgentText id="attribute031" />}
            labelClassName="text-sm text-base-content/65"
            value={selected.profileHash}
            onChange={event => setSelectedProfileHash(event.target.value)}
          >
            {profiles.map(profile => (
              <option key={profile.profileHash} value={profile.profileHash}>
                {profileLabel(profile, copy)}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-base-content/10 pt-5">
        <div>
          <p className="text-lg font-semibold">{profileLabel(selected, copy)}</p>
          <p className="mt-1 text-xs text-base-content/55">
            {selected.agentNames.length > 0 ? selected.agentNames.join(", ") : <AgentText id="dynamic046" />}
            {` · ${copy(selected.orchestrationMode === "multi_model" ? "multiModel" : "singleModel")}`}
          </p>
        </div>
        {selected.contributors.length > 0 ? (
          <p className="max-w-xl text-xs leading-5 text-base-content/55">
            <AgentText id="translated210" />{" "}
            {selected.contributors.map(contributor => `${contributor.provider} · ${modelName(contributor)}`).join(", ")}
          </p>
        ) : null}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [copy("eligibleOutputs"), selected.opportunityCount.toLocaleString(locale)],
          [copy("sentToReview"), selected.reviewRequestedCount.toLocaleString(locale)],
          [copy("humanAgreement"), percent(selected.humanAgreementBps, copy, format)],
          [copy("meanExecutionTime"), duration(selected.averageDurationMs, copy, format)],
        ].map(([label, value]) => (
          <Card as="div" variant="nested" key={label} className="rounded-xl p-4">
            <dt className="text-xs text-base-content/55">{label}</dt>
            <dd className="mt-2 font-mono text-lg">{value}</dd>
          </Card>
        ))}
      </dl>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card as="div" variant="nested" className="rounded-xl p-4">
          <EvaluationVolumeChart profile={selected} />
        </Card>
        <Card as="div" variant="nested" className="rounded-xl p-4">
          <AgreementChart profile={selected} />
        </Card>
      </div>

      <div className="mt-6 space-y-6">
        <ModelScopeList scopes={selected.scopes} />
        <RecentExecutions executions={selected.recentExecutions} />
      </div>

      <p className="mt-5 border-t border-base-content/10 pt-4 text-xs text-base-content/55">
        <AgentText id="translated211" />
      </p>
    </Card>
  );
}
