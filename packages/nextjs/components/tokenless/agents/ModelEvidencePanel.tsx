"use client";

import React, { useState } from "react";
import type {
  EvaluationModelExecution,
  EvaluationModelProfile,
  EvaluationModelScope,
} from "~~/lib/tokenless/evaluationDashboard";

const dateFormatter = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function modelName(profile: EvaluationModelProfile["primary"]) {
  return profile.resolvedModel ?? profile.requestedModel;
}

function profileLabel(profile: EvaluationModelProfile) {
  const version = profile.primary.modelVersion ? ` · ${profile.primary.modelVersion}` : "";
  const contributors = profile.contributors.length > 0 ? ` + ${profile.contributors.length} more` : "";
  return `${profile.primary.provider} · ${modelName(profile.primary)}${version}${contributors}`;
}

function percent(bps: number | null) {
  return bps === null ? "Pending" : `${(bps / 100).toFixed(1)}%`;
}

function duration(milliseconds: number | null) {
  if (milliseconds === null) return "Not reported";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} sec`;
}

function tokenCount(value: number | null) {
  return value === null ? "—" : value.toLocaleString();
}

function stageLabel(stage: EvaluationModelScope["stage"]) {
  if (stage === "high_coverage") return "High coverage";
  if (stage === "medium_coverage") return "Medium coverage";
  return stage === "monitoring" ? "Monitoring" : "Calibrating";
}

function reviewLabel(execution: EvaluationModelExecution) {
  if (execution.reviewStatus === "completed") return "Reviewed";
  if (execution.reviewStatus === "review_requested") return "In review";
  if (execution.reviewStatus === "skipped") return "Skipped";
  if (execution.reviewStatus === "failed") return "Review failed";
  return execution.reviewStatus === "decided" ? "Decision recorded" : "Not evaluated";
}

function safeId(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/gu, "-");
}

function EvaluationVolumeChart({ profile }: { profile: EvaluationModelProfile }) {
  const points = profile.daily.slice(-14);
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
      <h3 className="text-sm font-semibold">Evaluation volume</h3>
      <p className="mt-1 text-xs text-base-content/50">Eligible outputs and human-review requests by day.</p>
      {points.length > 0 ? (
        <svg
          className="mt-4 h-40 w-full text-[var(--rateloop-blue)]"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${id}-title ${id}-description`}
        >
          <title id={`${id}-title`}>{`Evaluation volume for ${profileLabel(profile)}`}</title>
          <desc id={`${id}-description`}>
            {totals.opportunities} eligible outputs and {totals.reviewed} human-review requests across {points.length}
            observed days.
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
                  fillOpacity="0.25"
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
        <p className="mt-4 text-sm text-base-content/50">No request history yet.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-base-content/55" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-blue)]/25" /> Eligible
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm bg-[var(--rateloop-blue)]" /> Human review
        </span>
      </div>
    </div>
  );
}

function AgreementChart({ profile }: { profile: EvaluationModelProfile }) {
  const agreed = profile.agreementCount;
  const disagreed = Math.max(0, profile.comparableCount - agreed);
  const total = Math.max(1, profile.comparableCount);
  const agreedWidth = `${(agreed / total) * 100}%`;
  const disagreedWidth = `${(disagreed / total) * 100}%`;

  return (
    <div>
      <h3 className="text-sm font-semibold">Human agreement</h3>
      <p className="mt-1 text-xs text-base-content/50">Comparable reviewed outputs for this model profile.</p>
      {profile.comparableCount > 0 ? (
        <div
          className="mt-6"
          role="img"
          aria-label={`${agreed} agreed and ${disagreed} disagreed comparable outputs for ${profileLabel(profile)}.`}
        >
          <div className="flex h-5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="bg-emerald-300/80" style={{ width: agreedWidth }} />
            <div className="bg-rose-300/75" style={{ width: disagreedWidth }} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-base-content/50">Agreed</p>
              <p className="mt-1 font-mono text-lg">{agreed.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-base-content/50">Disagreed</p>
              <p className="mt-1 font-mono text-lg">{disagreed.toLocaleString()}</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-base-content/50">No comparable human results yet.</p>
      )}
    </div>
  );
}

function ModelScopeList({ scopes }: { scopes: EvaluationModelScope[] }) {
  const visible = scopes.slice(0, 6);
  const additional = scopes.slice(6);
  if (visible.length === 0) return null;
  const cards = (items: EvaluationModelScope[]) =>
    items.map(scope => (
      <div key={scope.scopeId} className="surface-card-nested rounded-xl p-3 text-sm">
        <p className="font-medium">{scope.workflowKey}</p>
        <p className="mt-1 text-xs text-base-content/55">
          <span className="capitalize">{scope.riskTier} risk</span> · {stageLabel(scope.stage)}
        </p>
      </div>
    ));
  return (
    <section aria-labelledby="model-coverage-heading">
      <h3 id="model-coverage-heading" className="text-sm font-semibold">
        Coverage
      </h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cards(visible)}</div>
      {additional.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-base-content/65">
            Show {additional.length} more scopes
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cards(additional)}</div>
        </details>
      ) : null}
    </section>
  );
}

function RecentExecutions({ executions }: { executions: EvaluationModelExecution[] }) {
  if (executions.length === 0) return null;
  return (
    <section aria-labelledby="model-requests-heading">
      <h3 id="model-requests-heading" className="text-sm font-semibold">
        Recent requests
      </h3>
      <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-base-content/50">
            <tr>
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">Scope</th>
              <th className="px-4 py-3 font-medium">Execution</th>
              <th className="px-4 py-3 font-medium">Tokens</th>
              <th className="px-4 py-3 font-medium">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {executions.slice(0, 10).map(execution => (
              <tr key={execution.executionId}>
                <td className="px-4 py-3 text-xs text-base-content/60">
                  <time dateTime={execution.occurredAt}>{dateFormatter.format(new Date(execution.occurredAt))}</time>
                </td>
                <td className="px-4 py-3">
                  <p>{execution.workflowKey ?? "Not reported"}</p>
                  {execution.riskTier ? (
                    <p className="mt-1 text-xs capitalize text-base-content/45">{execution.riskTier} risk</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p>
                    {execution.modelCallCount} {execution.modelCallCount === 1 ? "model call" : "model calls"}
                  </p>
                  <p className="mt-1 text-xs text-base-content/45">{duration(execution.durationMs)}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {tokenCount(execution.inputTokens)} in · {tokenCount(execution.outputTokens)} out
                </td>
                <td className="px-4 py-3">
                  <p>{reviewLabel(execution)}</p>
                  {execution.agreement ? (
                    <p className="mt-1 text-xs capitalize text-base-content/45">{execution.agreement}</p>
                  ) : null}
                  {execution.metadataComplete === false ? (
                    <p className="mt-1 text-xs text-amber-100/80">Metadata incomplete</p>
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
  const [selectedProfileHash, setSelectedProfileHash] = useState("");
  const selected = profiles.find(profile => profile.profileHash === selectedProfileHash) ?? profiles[0] ?? null;
  if (!selected) return null;

  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="model-evidence-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="model-evidence-heading" className="text-xl font-semibold">
            Model evidence
          </h2>
          <p className="mt-1 text-sm text-base-content/60">Execution evidence from eligible outputs.</p>
        </div>
        {profiles.length > 1 ? (
          <label className="text-sm text-base-content/65 lg:min-w-80">
            Model profile
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={selected.profileHash}
              onChange={event => setSelectedProfileHash(event.target.value)}
            >
              {profiles.map(profile => (
                <option key={profile.profileHash} value={profile.profileHash}>
                  {profileLabel(profile)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-white/10 pt-5">
        <div>
          <p className="text-lg font-semibold">{profileLabel(selected)}</p>
          <p className="mt-1 text-xs text-base-content/50">
            {selected.agentNames.length > 0 ? selected.agentNames.join(", ") : "Connected agent"}
            {selected.orchestrationMode === "multi_model" ? " · Multi-model execution" : " · Single model"}
          </p>
        </div>
        {selected.contributors.length > 0 ? (
          <p className="max-w-xl text-xs leading-5 text-base-content/55">
            Contributors:{" "}
            {selected.contributors.map(contributor => `${contributor.provider} · ${modelName(contributor)}`).join(", ")}
          </p>
        ) : null}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Eligible outputs", selected.opportunityCount.toLocaleString()],
          ["Sent to human review", selected.reviewRequestedCount.toLocaleString()],
          ["Human agreement", percent(selected.humanAgreementBps)],
          ["Mean execution time", duration(selected.averageDurationMs)],
        ].map(([label, value]) => (
          <div key={label} className="surface-card-nested rounded-xl p-4">
            <dt className="text-xs text-base-content/45">{label}</dt>
            <dd className="mt-2 font-mono text-lg">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="surface-card-nested rounded-xl p-4">
          <EvaluationVolumeChart profile={selected} />
        </div>
        <div className="surface-card-nested rounded-xl p-4">
          <AgreementChart profile={selected} />
        </div>
      </div>

      <div className="mt-6 space-y-6">
        <ModelScopeList scopes={selected.scopes} />
        <RecentExecutions executions={selected.recentExecutions} />
      </div>

      <p className="mt-5 border-t border-white/10 pt-4 text-xs text-base-content/45">
        Model and execution metadata is reported by the connected host, not independently verified.
      </p>
    </section>
  );
}
