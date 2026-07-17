"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AdaptiveCoverageSummary } from "~~/components/tokenless/agents/AdaptiveCoverageSummary";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import type { AssuranceMetricsSnapshot } from "~~/lib/tokenless/assuranceMetrics";
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

function percentagePointsSquared(value: string | null) {
  if (value === null) return "Not available";
  try {
    const roundedHundredths = (BigInt(value) + 50n) / 100n;
    return `${roundedHundredths / 100n}.${(roundedHundredths % 100n).toString().padStart(2, "0")}`;
  } catch {
    return "Not available";
  }
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

function decisionLabel(decision: EvaluationRun["clientDecision"]) {
  if (decision === "go") return "Go";
  if (decision === "revise") return "Revise";
  if (decision === "stop") return "Stop";
  return null;
}

function AssuranceMetricsSummary({ snapshot }: { snapshot: AssuranceMetricsSnapshot }) {
  const totals = snapshot.scopes.reduce(
    (sum, scope) => ({
      eligible: sum.eligible + scope.eligible,
      requested: sum.requested + scope.requested,
      comparable: sum.comparable + scope.comparable,
      disagreements: sum.disagreements + scope.disagreements,
      latencyCount: sum.latencyCount + scope.latencyCount,
      latencyMilliseconds: sum.latencyMilliseconds + scope.latencyMilliseconds,
    }),
    { eligible: 0, requested: 0, comparable: 0, disagreements: 0, latencyCount: 0, latencyMilliseconds: 0 },
  );
  const sampling = totals.eligible > 0 ? `${((totals.requested / totals.eligible) * 100).toFixed(1)}%` : "No data";
  const disagreement =
    totals.comparable > 0 ? `${((totals.disagreements / totals.comparable) * 100).toFixed(1)}%` : "No data";
  const latency =
    totals.latencyCount > 0
      ? `${Math.round(totals.latencyMilliseconds / totals.latencyCount / 1_000).toLocaleString()} sec`
      : "No data";
  const anchor =
    snapshot.evidenceAnchor.state === "absent"
      ? "No anchor"
      : `${snapshot.evidenceAnchor.state} · ${snapshot.evidenceAnchor.lagSeconds.toLocaleString()} sec`;
  const overrideRate =
    snapshot.overrideDecisions.overrideRateBps === null
      ? "No data"
      : `${(snapshot.overrideDecisions.overrideRateBps / 100).toFixed(1)}% of ${snapshot.overrideDecisions.decided}`;
  return (
    <section className="surface-card rounded-2xl p-6" aria-labelledby="assurance-metrics-heading">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Last 30 days</p>
      <h2 id="assurance-metrics-heading" className="mt-2 text-xl font-semibold">
        Assurance operations
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Sampling rate", sampling],
          ["Mean verdict latency", latency],
          ["Disagreement rate", disagreement],
          ["Override rate", overrideRate],
          ["Latest evidence anchor", anchor],
        ].map(([label, value]) => (
          <div key={label} className="surface-card-nested rounded-xl p-4">
            <dt className="text-xs text-base-content/45">{label}</dt>
            <dd className="mt-2 font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-base-content/45">
        {snapshot.reviewsRequested} requested · {snapshot.reviewsCompleted} completed · {snapshot.blocked} blocked ·{" "}
        {snapshot.approvalRequired} awaiting approval
      </p>
    </section>
  );
}

function SampleNote({ run }: { run: EvaluationRun }) {
  if (run.sampleStatus === "suppressed") {
    return (
      <p className="mt-2 text-xs leading-5 text-amber-100/80" role="status">
        Result hidden until {run.minimumAggregationSize} reviewers respond.
      </p>
    );
  }
  if (run.sampleStatus === "small") {
    return (
      <p className="mt-2 text-xs leading-5 text-amber-100/80">
        Small sample ({run.validResponses}); treat this result as directional.
      </p>
    );
  }
  return <p className="mt-2 text-xs text-base-content/45">{run.validResponses} valid responses</p>;
}

function ClientDecisionButtons({
  run,
  workspaceId,
  onDecided,
}: {
  run: EvaluationRun;
  workspaceId: string;
  onDecided: (decision: NonNullable<EvaluationRun["clientDecision"]>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(decision: NonNullable<EvaluationRun["clientDecision"]>) {
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/runs/${encodeURIComponent(run.runId)}/evidence/decision`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision }),
          },
        ),
      );
      onDecided(decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record the decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-base-content/45">Sign off on this run — no choice is preselected.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["go", "revise", "stop"] as const).map(choice => (
          <button
            key={choice}
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void submit(choice)}
            disabled={busy}
          >
            {decisionLabel(choice)}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-100" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const OVERRIDE_OUTCOMES = ["accepted", "disregarded", "overridden", "reversed"] as const;

function OverrideRecordForm({ run, workspaceId }: { run: EvaluationRun; workspaceId: string }) {
  const [reasons, setReasons] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [recorded, setRecorded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent, outcome: (typeof OVERRIDE_OUTCOMES)[number]) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/runs/${encodeURIComponent(run.runId)}/evidence/overrides`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              outcome,
              reasons: reasons.trim(),
              ...(correctiveAction.trim() ? { correctiveAction: correctiveAction.trim() } : {}),
            }),
          },
        ),
      );
      setRecorded(outcome);
      setReasons("");
      setCorrectiveAction("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to record the override decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 border-t border-white/10 pt-4" onSubmit={event => event.preventDefault()}>
      <p className="text-sm font-semibold text-base-content/65">Record what you did with this output</p>
      <p className="mt-1 text-xs text-base-content/45">
        Append-only record with mandatory reasons; a new record supersedes, never edits. No choice is preselected.
      </p>
      {recorded ? (
        <p className="mt-2 text-xs text-emerald-100" role="status">
          Recorded as {recorded}. Recording again supersedes this record.
        </p>
      ) : null}
      <textarea
        className="textarea mt-3 w-full border-white/10 bg-[var(--rateloop-field)] text-sm"
        placeholder="Reasons (required, 10-2000 characters)"
        value={reasons}
        onChange={event => setReasons(event.target.value)}
        maxLength={2000}
        rows={2}
      />
      <input
        className="input mt-2 w-full border-white/10 bg-[var(--rateloop-field)] text-sm"
        placeholder="Linked corrective action (optional)"
        value={correctiveAction}
        onChange={event => setCorrectiveAction(event.target.value)}
        maxLength={2000}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {OVERRIDE_OUTCOMES.map(outcome => (
          <button
            key={outcome}
            type="button"
            className="btn btn-outline btn-sm capitalize"
            onClick={event => void submit(event, outcome)}
            disabled={busy || reasons.trim().length < 10}
          >
            {outcome}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-100" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RunCard({ run, workspaceId }: { run: EvaluationRun; workspaceId: string }) {
  const share = run.candidateSelectionShareBps;
  const [clientDecision, setClientDecision] = useState(run.clientDecision);
  const decision = decisionLabel(clientDecision);
  const decidable = run.status === "completed" && run.evidencePacketAvailable && !clientDecision;
  return (
    <article className="surface-card rounded-2xl p-5" aria-labelledby={`evaluation-${run.runId}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">{run.projectName}</p>
          <h3 id={`evaluation-${run.runId}`} className="mt-1 text-lg font-semibold">
            {run.suiteName}
          </h3>
        </div>
        <span className="self-start rounded-md bg-white/[0.06] px-2 py-1 text-xs capitalize">{run.status}</span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]">
        <div>
          <p className="text-xs text-base-content/45">{decision ? "Decision" : "Current result"}</p>
          <p className="mt-1 text-2xl font-semibold">
            {decision ?? (share === null ? "Waiting for responses" : `${percent(share)} chose the candidate`)}
          </p>
          <SampleNote run={run} />
          {decidable ? (
            <ClientDecisionButtons run={run} workspaceId={workspaceId} onDecided={setClientDecision} />
          ) : null}
        </div>
        {run.candidateSelectionIntervalBps ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm">
            <p className="text-xs text-base-content/45">95% confidence interval</p>
            <p className="mt-1 font-mono">
              {percent(run.candidateSelectionIntervalBps.lower)}–{percent(run.candidateSelectionIntervalBps.upper)}
            </p>
            <p className="mt-3 text-xs text-base-content/45">{run.distinctReviewers} reviewers</p>
          </div>
        ) : null}
      </div>

      <details className="mt-4 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
          Evidence and run details
        </summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-base-content/45">Cases</dt>
            <dd className="mt-1 font-mono">{run.caseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Calibration items</dt>
            <dd className="mt-1 font-mono">{run.calibrationCaseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Reviewers</dt>
            <dd className="mt-1 font-mono">{run.distinctReviewers}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Reviewer source</dt>
            <dd className="mt-1 capitalize">{run.reviewerSource}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Compensation</dt>
            <dd className="mt-1 capitalize">{run.compensation}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Evidence packet</dt>
            <dd className="mt-1">{run.evidencePacketAvailable ? "Available" : "Not generated"}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/45">Created</dt>
            <dd className="mt-1">{new Date(run.createdAt).toLocaleString()}</dd>
          </div>
          {run.mechanismHealth ? (
            <>
              <div>
                <dt className="text-xs text-base-content/45">Quorum-case unanimity</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.unanimityRateBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/45">Calibration failure rate</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.goldFailureRateBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/45">Comparable-case drift</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.comparableDriftBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/45">Quality score variance (percentage points²)</dt>
                <dd className="mt-1 font-mono">{percentagePointsSquared(run.mechanismHealth.rbtsScoreVarianceBps2)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        <p className="mt-4 text-xs leading-5 text-base-content/45">
          This run has no immutable agent-version reference, so it is excluded from per-agent comparisons.
        </p>
        <code className="mt-3 block break-all text-[11px] text-base-content/35">{run.runId}</code>
      </details>
      {run.status === "completed" ? <OverrideRecordForm run={run} workspaceId={workspaceId} /> : null}
    </article>
  );
}

export function EvaluationDashboardPanel({
  initialWorkspaceId = "",
  showWorkspaceSelector = true,
}: {
  initialWorkspaceId?: string;
  showWorkspaceSelector?: boolean;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [dashboard, setDashboard] = useState<EvaluationDashboard | null>(null);
  const [assuranceMetrics, setAssuranceMetrics] = useState<AssuranceMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      setMetricsError(false);
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
        setWorkspaceId(
          next.some(workspace => workspace.workspaceId === initialWorkspaceId)
            ? initialWorkspaceId
            : (next[0]?.workspaceId ?? ""),
        );
        if (next.length === 0) setLoading(false);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load evaluations.");
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [initialWorkspaceId]);

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
        const nextDashboard = body as unknown as EvaluationDashboard;
        if (!controller.signal.aborted) setDashboard(nextDashboard);
        if (nextDashboard.callerRole === "owner" || nextDashboard.callerRole === "admin") {
          try {
            const metrics = await readJson(
              await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/metrics/summary`, {
                cache: "no-store",
                credentials: "same-origin",
                signal: controller.signal,
              }),
            );
            if (!controller.signal.aborted) setAssuranceMetrics(metrics as unknown as AssuranceMetricsSnapshot);
          } catch {
            if (!controller.signal.aborted) setMetricsError(true);
          }
        } else if (!controller.signal.aborted) {
          setAssuranceMetrics(null);
        }
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
    setAssuranceMetrics(null);
    setError(null);
  }

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Evaluations</p>
            <h2 className="mt-2 text-2xl font-semibold">Human review results</h2>
            <p className="mt-2 text-sm text-base-content/55">Decisions and evidence from your agent workflows.</p>
          </div>
          {showWorkspaceSelector && workspaces.length > 1 ? (
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
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-red-300/20 bg-red-300/[0.06] p-4 text-sm text-red-100" role="alert">
          {error}
        </div>
      ) : null}
      <AsyncSection loading={loading} loadingLabel="Loading evaluations">
        {null}
      </AsyncSection>
      {!loading && workspaces.length === 0 ? (
        <div className="surface-card rounded-2xl p-6">
          <h3 className="font-semibold">Create a workspace first</h3>
          <p className="mt-2 text-sm text-base-content/55">Evaluations belong to a workspace.</p>
        </div>
      ) : null}

      {assuranceMetrics ? <AssuranceMetricsSummary snapshot={assuranceMetrics} /> : null}
      {metricsError ? (
        <p className="text-xs text-amber-100/80" role="status">
          Assurance operations metrics are temporarily unavailable.
        </p>
      ) : null}

      {dashboard ? <AdaptiveCoverageSummary agents={dashboard.agents} /> : null}

      {!loading && dashboard?.runs.length === 0 ? (
        <section className="surface-card rounded-2xl p-6" aria-labelledby="evaluations-empty-heading">
          <h3 id="evaluations-empty-heading" className="font-semibold">
            No evaluations yet
          </h3>
          <p className="mt-2 text-sm text-base-content/55">Results appear after your agent requests human review.</p>
        </section>
      ) : null}

      {dashboard && dashboard.runs.length > 0 ? (
        <>
          <section className="space-y-3" aria-labelledby="evaluation-runs-heading">
            <h2 id="evaluation-runs-heading" className="text-xl font-semibold">
              Results
            </h2>
            {dashboard.runs.map(run => (
              <RunCard key={run.runId} run={run} workspaceId={workspaceId} />
            ))}
          </section>

          <details className="surface-card rounded-2xl p-6">
            <summary className="cursor-pointer text-sm font-semibold">How results are shown</summary>
            <div className="mt-4 max-w-3xl space-y-2 text-sm leading-6 text-base-content/55">
              <p>
                Results use persisted responses, evidence packets, and client decisions. Small samples and confidence
                intervals stay beside the result they qualify.
              </p>
              <p>
                RateLoop does not create a global agent ranking. Runs without an immutable agent version stay in the
                audit history but do not enter per-agent comparisons.
              </p>
            </div>
          </details>

          <details className="surface-card rounded-2xl p-6">
            <summary className="cursor-pointer text-sm font-semibold">Workspace evaluation details</summary>
            <div className="mt-5 space-y-6">
              <section aria-labelledby="evaluation-summary-heading">
                <h2 id="evaluation-summary-heading" className="text-base font-semibold">
                  Summary
                </h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["Runs", dashboard.summary.totalRuns],
                    ["Completed", dashboard.summary.completedRuns],
                    ["Evidence-backed", dashboard.summary.evidenceBackedRuns],
                    ["Valid responses", dashboard.summary.validResponses],
                  ].map(([label, value]) => (
                    <div key={label} className="surface-card-nested rounded-xl p-4">
                      <dt className="text-xs text-base-content/45">{label}</dt>
                      <dd className="mt-2 font-mono text-xl">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section aria-labelledby="agent-attribution-heading">
                <h2 id="agent-attribution-heading" className="text-base font-semibold">
                  Registered agents
                </h2>
                {dashboard.agents.length === 0 ? (
                  <p className="mt-3 text-sm text-base-content/50">No registered agents.</p>
                ) : (
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {dashboard.agents.map(agent => (
                      <article key={agent.agentId} className="surface-card-nested rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-medium">{agent.displayName}</h3>
                          <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">v{agent.versionNumber}</span>
                        </div>
                        <p className="mt-2 text-xs text-base-content/50">
                          {agent.declaredProvider} · {agent.declaredModel}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              <section aria-labelledby="publishing-limits-heading">
                <h2 id="publishing-limits-heading" className="text-base font-semibold">
                  Publishing limits
                </h2>
                {!dashboard.canViewPublishingPolicies ? (
                  <p className="mt-3 text-sm text-base-content/55">Visible to workspace owners and admins.</p>
                ) : dashboard.publishingPolicies?.length === 0 ? (
                  <p className="mt-3 text-sm text-base-content/55">No publishing policy configured.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {dashboard.publishingPolicies?.map(policy => (
                      <article key={policy.policyId} className="surface-card-nested rounded-xl p-4">
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
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
