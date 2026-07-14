"use client";

import { useEffect, useState } from "react";
import type { EvaluationDashboard, EvaluationRun } from "~~/lib/tokenless/evaluationDashboard";

type Workspace = { workspaceId: string; name: string; role: string };

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

function percent(bps: number | null) {
  return bps === null ? "Suppressed" : `${(bps / 100).toFixed(1)}%`;
}

function usdc(atomic: string) {
  try {
    const amount = BigInt(atomic);
    const whole = amount / 1_000_000n;
    const fractional = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
    return `${whole.toLocaleString()}${fractional ? `.${fractional}` : ""} USDC`;
  } catch {
    return `${atomic} atomic units`;
  }
}

function SampleNote({ run }: { run: EvaluationRun }) {
  if (run.sampleStatus === "suppressed") {
    return (
      <p className="mt-2 text-xs leading-5 text-amber-100/80">
        Preference cells are suppressed until {run.minimumAggregationSize} valid responses are available.
      </p>
    );
  }
  if (run.sampleStatus === "small") {
    return (
      <p className="mt-2 text-xs leading-5 text-amber-100/80">
        Small sample ({run.validResponses}); treat this interval as directional, not as a stable performance estimate.
      </p>
    );
  }
  return <p className="mt-2 text-xs text-base-content/45">Based on {run.validResponses} valid human responses.</p>;
}

function RunCard({ run }: { run: EvaluationRun }) {
  const share = run.candidateSelectionShareBps;
  return (
    <article className="surface-card rounded-2xl p-5" aria-labelledby={`evaluation-${run.runId}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">{run.projectName}</p>
          <h3 id={`evaluation-${run.runId}`} className="mt-1 text-lg font-semibold">
            {run.suiteName}
          </h3>
          <p className="mt-1 font-mono text-xs text-base-content/40">{run.runId}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-white/[0.06] px-2 py-1">{run.status}</span>
          <span className="rounded-md bg-white/[0.06] px-2 py-1">{run.reviewerSource}</span>
          <span className="rounded-md bg-white/[0.06] px-2 py-1">{run.compensation}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)]">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs text-base-content/45">Candidate selection share</p>
              <p className="mt-1 text-2xl font-semibold">{percent(share)}</p>
            </div>
            {run.candidateSelectionIntervalBps ? (
              <p className="text-right text-xs text-base-content/55">
                95% interval
                <br />
                {percent(run.candidateSelectionIntervalBps.lower)}–{percent(run.candidateSelectionIntervalBps.upper)}
              </p>
            ) : null}
          </div>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]"
            role="img"
            aria-label={
              share === null ? "Candidate selection share suppressed" : `Candidate selected ${percent(share)}`
            }
          >
            {share !== null ? (
              <div
                className="h-full rounded-full bg-gradient-to-r from-[var(--rateloop-blue)] to-[var(--rateloop-pink)]"
                style={{ width: `${Math.max(1, share / 100)}%` }}
              />
            ) : null}
          </div>
          <SampleNote run={run} />
        </div>

        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm">
          <div>
            <dt className="text-xs text-base-content/45">Cases</dt>
            <dd className="mt-1 font-mono">{run.caseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Reviewers</dt>
            <dd className="mt-1 font-mono">{run.distinctReviewers}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Client sign-off</dt>
            <dd className="mt-1">{run.clientDecision ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Evidence packet</dt>
            <dd className="mt-1">{run.evidencePacketAvailable ? "Available" : "Not generated"}</dd>
          </div>
        </dl>
      </div>

      <p className="mt-4 rounded-lg border border-amber-200/10 bg-amber-100/[0.04] px-3 py-2 text-xs leading-5 text-amber-50/70">
        Unattributed: this run does not contain an immutable agent-version reference. It is excluded from per-agent
        performance comparisons.
      </p>
    </article>
  );
}

export function EvaluationDashboardPanel() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [dashboard, setDashboard] = useState<EvaluationDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await readJson(
          await fetch("/api/account/workspaces", {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        const next = (body.workspaces ?? []) as Workspace[];
        if (controller.signal.aborted) return;
        setWorkspaces(next);
        setWorkspaceId(next[0]?.workspaceId ?? "");
        if (next.length === 0) setLoading(false);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load evaluations.");
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/evaluations`, {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }),
        );
        if (!controller.signal.aborted) setDashboard(body as unknown as EvaluationDashboard);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load evaluations.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [workspaceId]);

  function selectWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    setDashboard(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Evaluations</p>
            <h2 className="mt-2 text-2xl font-semibold">Human evidence, with provenance before performance</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-base-content/60">
              These views use persisted run responses, evidence packets, and client decisions. RateLoop does not create
              a global agent ranking, and it does not infer agent agreement from unattributed candidates.
            </p>
          </div>
          <label className="min-w-56 text-sm text-base-content/60">
            Workspace
            <select
              className="select mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
              value={workspaceId}
              onChange={event => selectWorkspace(event.target.value)}
              disabled={loading}
            >
              {workspaces.map(workspace => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
          {error}
        </div>
      ) : null}
      {loading ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55" role="status">
          <span className="loading loading-spinner loading-sm mr-2" /> Loading source evidence…
        </div>
      ) : null}
      {!loading && workspaces.length === 0 ? (
        <div className="surface-card rounded-2xl p-6 text-sm text-base-content/55">
          Create a workspace in Overview before evaluating an agent workflow.
        </div>
      ) : null}

      {dashboard ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Evaluation summary">
            {[
              ["Human runs", dashboard.summary.totalRuns],
              ["Completed", dashboard.summary.completedRuns],
              ["Evidence-backed", dashboard.summary.evidenceBackedRuns],
              ["Valid responses", dashboard.summary.validResponses],
              ["Agent-attributed", dashboard.summary.attributedRuns],
            ].map(([label, value]) => (
              <div key={label} className="surface-card rounded-xl p-4">
                <p className="text-xs text-base-content/45">{label}</p>
                <p className="mt-2 font-mono text-2xl">{value}</p>
              </div>
            ))}
          </section>

          <section className="surface-card rounded-2xl p-6" aria-labelledby="agent-attribution-heading">
            <h2 id="agent-attribution-heading" className="text-xl font-semibold">
              Registered agents
            </h2>
            <p className="mt-2 text-sm leading-6 text-base-content/55">
              Agent selection will activate only after each review opportunity captures a server-verified immutable
              version ID. Until then, runs remain visible but cannot affect an agent score.
            </p>
            {dashboard.agents.length === 0 ? (
              <p className="mt-4 rounded-lg bg-white/[0.03] p-3 text-sm text-base-content/50">
                No agents are registered in this workspace.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dashboard.agents.map(agent => (
                  <article key={agent.agentId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-medium">{agent.displayName}</h3>
                      <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">v{agent.versionNumber}</span>
                    </div>
                    <p className="mt-2 text-xs text-base-content/50">
                      Declared {agent.declaredProvider} · {agent.declaredModel}
                    </p>
                    <p className="mt-3 text-xs text-amber-100/75">No attributable runs yet</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="evaluation-runs-heading">
            <div>
              <h2 id="evaluation-runs-heading" className="text-xl font-semibold">
                Human-assurance runs
              </h2>
              <p className="mt-1 text-sm text-base-content/50">Newest 100 runs in this workspace.</p>
            </div>
            {dashboard.runs.length === 0 ? (
              <div className="surface-card rounded-2xl p-6 text-sm leading-6 text-base-content/55">
                No persisted human-assurance runs are available yet. Dashboard metrics appear only after real run data
                is stored; no demo scores are generated.
              </div>
            ) : (
              dashboard.runs.map(run => <RunCard key={run.runId} run={run} />)
            )}
          </section>

          <section className="surface-card rounded-2xl p-6" aria-labelledby="publishing-limits-heading">
            <h2 id="publishing-limits-heading" className="text-xl font-semibold">
              Agent publishing and spend limits
            </h2>
            {!dashboard.canViewPublishingPolicies ? (
              <p className="mt-3 text-sm text-base-content/55">
                Policy limits are restricted to workspace owners and admins.
              </p>
            ) : dashboard.publishingPolicies?.length === 0 ? (
              <p className="mt-3 text-sm text-base-content/55">No publishing policy has been configured.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {dashboard.publishingPolicies?.map(policy => (
                  <article key={policy.policyId} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-medium">
                        {policy.name} · v{policy.version}
                      </h3>
                      <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">
                        {policy.enabled && !policy.revokedAt ? "active" : "inactive"}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <dt className="text-xs text-base-content/45">Per panel</dt>
                        <dd className="mt-1 font-mono">{usdc(policy.maxPanelAtomic)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-base-content/45">Daily</dt>
                        <dd className="mt-1 font-mono">{usdc(policy.maxDailyAtomic)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-base-content/45">Monthly</dt>
                        <dd className="mt-1 font-mono">{usdc(policy.maxMonthlyAtomic)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-base-content/45">Maximum humans</dt>
                        <dd className="mt-1 font-mono">{policy.maxPanelSize}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
