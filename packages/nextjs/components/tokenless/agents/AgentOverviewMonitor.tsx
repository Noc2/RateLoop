"use client";

import { Fragment, useEffect, useState } from "react";
import type { AgentOverview, AgentOverviewParent, AgentOverviewScope } from "~~/lib/tokenless/agentOverview";
import { readJson } from "~~/lib/tokenless/http";

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

function AgentVersionTable({ overview }: { overview: AgentOverview }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="agent-version-monitor-heading">
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
      {overview.agentVersions.parentsTruncated ? (
        <p className="mt-3 text-xs text-base-content/55">
          Showing {overview.agentVersions.parents.length} of {overview.agentVersions.totalParentCount} current agent
          versions.
        </p>
      ) : null}
    </section>
  );
}

export function AgentOverviewMonitor({ workspaceId }: { workspaceId: string }) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/agents/overview`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(response => readJson<AgentOverview>(response))
      .then(body => {
        if (!controller.signal.aborted) setOverview(body);
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load overview.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId]);

  if (loading) {
    return (
      <section className="surface-card rounded-2xl p-6" role="status">
        Loading agent monitor…
      </section>
    );
  }
  if (error || !overview) {
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
      <AgentVersionTable overview={overview} />
    </div>
  );
}
