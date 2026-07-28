"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdaptiveCoverageSummary } from "~~/components/tokenless/agents/AdaptiveCoverageSummary";
import { ModelEvidencePanel } from "~~/components/tokenless/agents/ModelEvidencePanel";
import { agentTabHref } from "~~/components/tokenless/agents/agentWorkspaceState";
import {
  DEFAULT_EVALUATION_URL_STATE,
  type EvaluationUrlState,
  evaluationUrlHref,
  parseEvaluationUrlState,
} from "~~/components/tokenless/agents/evaluationUrlState";
import { updateEvidenceUrlSearch } from "~~/components/tokenless/agents/evidenceUrlState";
import { Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { useFormErrors } from "~~/components/tokenless/forms/useFormErrors";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { formatHumanDurationFromSeconds } from "~~/lib/humanDuration";
import type { AssuranceMetricsSnapshot } from "~~/lib/tokenless/assuranceMetrics";
import type { DeciderDecisionTrend, EvaluationDashboard, EvaluationRun } from "~~/lib/tokenless/evaluationDashboard";
import { readJson } from "~~/lib/tokenless/http";
import type { OversightRunCaseView } from "~~/lib/tokenless/oversightCaseView";

type Workspace = { workspaceId: string; name: string; role: string };

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

function runNeedsDecision(run: EvaluationRun) {
  return run.status === "completed" && run.evidencePacketAvailable && !run.clientDecision;
}

function runPresentationStatus(run: EvaluationRun) {
  if (runNeedsDecision(run)) return "needs_action";
  if (["failed", "dead"].includes(run.status)) return "failed";
  if (["completed", "cancelled"].includes(run.status)) return "completed";
  return "waiting";
}

function evidenceHrefForRun(workspaceId: string, runId: string, currentSearch: string) {
  const route = new URL(
    agentTabHref("evidence", workspaceId, new URLSearchParams(currentSearch)),
    "https://rateloop.local",
  );
  route.search = updateEvidenceUrlSearch(route.search, { runId, packetId: null });
  return `${route.pathname}${route.search}`;
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
      ? formatHumanDurationFromSeconds(Math.round(totals.latencyMilliseconds / totals.latencyCount / 1_000))
      : "No data";
  const anchor =
    snapshot.evidenceAnchor.state === "absent"
      ? "No anchor"
      : `${snapshot.evidenceAnchor.state} · ${formatHumanDurationFromSeconds(snapshot.evidenceAnchor.lagSeconds)}`;
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
            <dt className="text-xs text-base-content/55">{label}</dt>
            <dd className="mt-2 font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-base-content/55">
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
  return <p className="mt-2 text-xs text-base-content/55">{run.validResponses} valid responses</p>;
}

/**
 * Signals a decider must see before the decision buttons: reviewer
 * disagreement, calibration (gold) failures and mechanism health, and how old
 * the evidence is. Rendered above every decision and override control.
 */
function DecisionSignals({ run }: { run: EvaluationRun }) {
  const share = run.candidateSelectionShareBps;
  const dissentBps = share === null ? null : Math.min(share, 10_000 - share);
  const evidenceAgeHours = run.completedAt
    ? Math.max(0, Math.round((Date.now() - new Date(run.completedAt).getTime()) / 3_600_000))
    : null;
  const signals: Array<[string, string]> = [
    ["Reviewer dissent", dissentBps === null ? "Suppressed" : percent(dissentBps)],
    [
      "Calibration failure rate",
      run.mechanismHealth?.goldFailureRateBps === null || run.mechanismHealth === null
        ? "No calibration data"
        : percent(run.mechanismHealth.goldFailureRateBps),
    ],
    [
      "Quorum-case unanimity",
      run.mechanismHealth?.unanimityRateBps === null || run.mechanismHealth === null
        ? "No data"
        : percent(run.mechanismHealth.unanimityRateBps),
    ],
    [
      "Time since evidence",
      evidenceAgeHours === null
        ? "Not completed"
        : evidenceAgeHours < 48
          ? `${evidenceAgeHours} h`
          : `${Math.round(evidenceAgeHours / 24)} days`,
    ],
  ];
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3" role="note">
      <p className="text-xs font-semibold text-base-content/55">Before you decide</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {signals.map(([label, value]) => (
          <div key={label}>
            <dt className="text-base-content/55">{label}</dt>
            <dd className="mt-0.5 font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function deciderTrendLabel(trend: DeciderDecisionTrend | undefined) {
  if (!trend) return null;
  const parts: string[] = [];
  if (trend.clientDecisions.total > 0) {
    const share = Math.round((trend.clientDecisions.goCount / trend.clientDecisions.total) * 100);
    parts.push(`You chose go on ${share}% of your last ${trend.clientDecisions.total} sign-offs`);
  }
  if (trend.overrides.total > 0) {
    const share = Math.round((trend.overrides.acceptedCount / trend.overrides.total) * 100);
    parts.push(`you accepted ${share}% of your last ${trend.overrides.total} recorded outcomes`);
  }
  return parts.length > 0 ? `${parts.join(" · ")}.` : null;
}

function ClientDecisionButtons({
  run,
  workspaceId,
  trend,
  onDecided,
}: {
  run: EvaluationRun;
  workspaceId: string;
  trend?: DeciderDecisionTrend;
  onDecided: (decision: NonNullable<EvaluationRun["clientDecision"]>) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  const explanationMissing = run.explanationRequired && note.trim().length < 10;
  const trendLabel = deciderTrendLabel(trend);

  async function submit(decision: NonNullable<EvaluationRun["clientDecision"]>) {
    setBusy(true);
    clear();
    try {
      await readJson(
        await fetch(
          `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/runs/${encodeURIComponent(run.runId)}/evidence/decision`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
          },
        ),
      );
      onDecided(decision);
    } catch (cause) {
      capture(cause, "Unable to record the decision.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-base-content/55">Sign off on this run — no choice is preselected.</p>
      {trendLabel ? <p className="mt-1 text-xs text-base-content/55">{trendLabel}</p> : null}
      {run.explanationRequired ? (
        <div className="mt-2 rounded-lg border border-amber-200/20 bg-amber-300/[0.06] p-3">
          <p className="text-xs font-semibold text-amber-100/90">Explain this decision</p>
          <p className="mt-1 text-xs leading-5 text-amber-100/70">
            This run was sampled for an explained decision: write your reasons before choosing — even for go.
          </p>
          <TextareaField
            label="Reasons"
            className="mt-2 w-full border-white/10 bg-[var(--rateloop-field)] text-sm"
            placeholder="Reasons (required for this run, at least 10 characters)"
            hint={
              explanationMissing
                ? `At least 10 characters are required before you can sign off — ${10 - note.trim().length} to go.`
                : "Long enough to sign off."
            }
            value={note}
            error={fieldErrors.note}
            maxLength={2000}
            rows={2}
            onChange={event => {
              clear("note");
              setNote(event.target.value);
            }}
          />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {(["go", "revise", "stop"] as const).map(choice => (
          <button
            key={choice}
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void submit(choice)}
            disabled={busy || explanationMissing}
          >
            {decisionLabel(choice)}
          </button>
        ))}
      </div>
      {formError ? (
        <p className="mt-2 text-xs text-red-100" role="alert">
          {formError}
        </p>
      ) : null}
    </div>
  );
}

const OVERRIDE_OUTCOMES = ["accepted", "disregarded", "overridden", "reversed"] as const;

function OverrideRecordForm({
  run,
  workspaceId,
  trend,
}: {
  run: EvaluationRun;
  workspaceId: string;
  trend?: DeciderDecisionTrend;
}) {
  const [reasons, setReasons] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [recorded, setRecorded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();

  async function submit(event: FormEvent, outcome: (typeof OVERRIDE_OUTCOMES)[number]) {
    event.preventDefault();
    setBusy(true);
    clear();
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
      capture(cause, "Unable to record the override decision.");
    } finally {
      setBusy(false);
    }
  }

  const trendLabel = deciderTrendLabel(trend);
  const reasonsTooShort = reasons.trim().length < 10;
  return (
    <form className="mt-4 border-t border-white/10 pt-4" onSubmit={event => event.preventDefault()}>
      <p className="text-sm font-semibold text-base-content/65">Record what you did with this output</p>
      <p className="mt-1 text-xs text-base-content/55">
        Append-only record with mandatory reasons; a new record supersedes, never edits. No choice is preselected.
      </p>
      {trendLabel ? <p className="mt-1 text-xs text-base-content/55">{trendLabel}</p> : null}
      <DecisionSignals run={run} />
      {recorded ? (
        <p className="mt-2 text-xs text-emerald-100" role="status">
          Recorded as {recorded}. Recording again supersedes this record.
        </p>
      ) : null}
      <TextareaField
        label="Reasons"
        className="mt-3 w-full border-white/10 bg-[var(--rateloop-field)] text-sm"
        placeholder="Reasons (required, 10-2000 characters)"
        hint={
          reasonsTooShort
            ? `At least 10 characters are required before you can record an outcome — ${10 - reasons.trim().length} to go.`
            : "Long enough to record an outcome."
        }
        value={reasons}
        error={fieldErrors.reasons}
        onChange={event => {
          clear("reasons");
          setReasons(event.target.value);
        }}
        maxLength={2000}
        rows={2}
      />
      <Field
        label="Linked corrective action"
        className="mt-2 w-full border-white/10 bg-[var(--rateloop-field)] text-sm"
        placeholder="Linked corrective action (optional)"
        value={correctiveAction}
        error={fieldErrors.correctiveAction}
        onChange={event => {
          clear("correctiveAction");
          setCorrectiveAction(event.target.value);
        }}
        maxLength={2000}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        {OVERRIDE_OUTCOMES.map(outcome => (
          <button
            key={outcome}
            type="button"
            className="btn btn-outline btn-sm capitalize"
            onClick={event => void submit(event, outcome)}
            disabled={busy || reasonsTooShort}
          >
            {outcome}
          </button>
        ))}
      </div>
      {formError ? (
        <p className="mt-2 text-xs text-red-100" role="alert">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

function OversightCaseDetail({ run, workspaceId }: { run: EvaluationRun; workspaceId: string }) {
  const [view, setView] = useState<OversightRunCaseView | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "denied" | "error">("idle");

  async function load() {
    if (view || state === "loading") return;
    setState("loading");
    try {
      const response = await fetch(
        `/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/runs/${encodeURIComponent(run.runId)}/cases`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (response.status === 403) {
        setState("denied");
        return;
      }
      setView((await readJson(response)) as unknown as OversightRunCaseView);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <details className="mt-4 border-t border-white/10 pt-4" onToggle={event => event.currentTarget.open && void load()}>
      <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
        {run.failureSummary ? "Why this failed: case detail and reviewer reasons" : "Case detail and reviewer reasons"}
      </summary>
      {state === "loading" ? <p className="mt-3 text-xs text-base-content/55">Loading case material…</p> : null}
      {state === "denied" ? (
        <p className="mt-3 text-xs text-base-content/55">
          Case material opens only for workspace owners, admins, and designated decision owners.
        </p>
      ) : null}
      {state === "error" ? (
        <p className="mt-3 text-xs text-red-100" role="alert">
          Unable to load the case detail.
        </p>
      ) : null}
      {view && !view.detailAvailable ? (
        <p className="mt-3 text-xs leading-5 text-base-content/55">{view.note}</p>
      ) : null}
      {view?.detailAvailable ? (
        <div className="mt-3 space-y-3">
          {view.note ? <p className="text-xs leading-5 text-base-content/55">{view.note}</p> : null}
          {view.cases.some(caseView => caseView.responses.length > 0) ? (
            <p className="text-xs leading-5 text-base-content/55">
              Reviewer labels are run-specific pseudonyms by design. Responses are not linked here to roster identities.
            </p>
          ) : null}
          {view.cases.map(caseView => (
            <article key={caseView.caseId} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  {caseView.title}
                  {caseView.isCalibration ? (
                    <span className="ml-2 rounded bg-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase">
                      Calibration
                    </span>
                  ) : null}
                </h4>
                <p className="text-xs text-base-content/55">
                  {caseView.choiceCounts.candidate} candidate · {caseView.choiceCounts.baseline} baseline
                  {caseView.disagreementBps !== null ? ` · ${percent(caseView.disagreementBps)} dissent` : ""}
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-base-content/60">{caseView.instructions}</p>
              <p className="mt-2 flex flex-wrap gap-2 text-xs">
                {caseView.artifacts.map(artifact => (
                  <a
                    key={artifact.artifactId}
                    className="rounded-md bg-white/[0.06] px-2 py-1 capitalize text-[var(--rateloop-blue)]"
                    href={`/api/account/workspaces/${encodeURIComponent(workspaceId)}/assurance/projects/${encodeURIComponent(view.projectId)}/artifacts/${encodeURIComponent(artifact.artifactId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {artifact.role}: {artifact.label ?? artifact.artifactId}
                  </a>
                ))}
              </p>
              {caseView.responses.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {caseView.responses.map((response, index) => (
                    <li key={`${caseView.caseId}-${index}`} className="rounded-lg bg-black/20 p-3 text-xs leading-5">
                      <p className="text-base-content/55">
                        {response.reviewerPseudonym} · chose {response.choice}
                        {response.failureTagKeys.length > 0 ? ` · ${response.failureTagKeys.join(", ")}` : ""}
                      </p>
                      {response.rationale ? (
                        <p className="mt-1 whitespace-pre-wrap text-base-content/70">{response.rationale}</p>
                      ) : (
                        <p className="mt-1 text-base-content/55">No workspace-owned rationale for this response.</p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-base-content/55">No valid responses recorded for this case.</p>
              )}
            </article>
          ))}
          {view.overrideDecisions.length > 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <h4 className="text-sm font-semibold">Override history</h4>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-base-content/60">
                {view.overrideDecisions.map(decision => (
                  <li key={decision.recordId}>
                    <span className="capitalize">{decision.outcome}</span>
                    {decision.current ? "" : " (superseded)"} · {new Date(decision.decidedAt).toLocaleString()} —{" "}
                    {decision.reasons}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function RunCard({
  run,
  workspaceId,
  trend,
  evidenceHref,
}: {
  run: EvaluationRun;
  workspaceId: string;
  trend?: DeciderDecisionTrend;
  evidenceHref: string | null;
}) {
  const share = run.candidateSelectionShareBps;
  const [clientDecision, setClientDecision] = useState(run.clientDecision);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const decision = decisionLabel(clientDecision);
  const decidable = runNeedsDecision({ ...run, clientDecision });
  const presentationStatus = decidable
    ? { label: "Needs action", className: "bg-amber-300/10 text-amber-100" }
    : ["completed", "cancelled"].includes(run.status)
      ? { label: "Completed", className: "bg-emerald-300/10 text-emerald-100" }
      : ["failed", "dead"].includes(run.status)
        ? { label: "Failed", className: "bg-red-300/10 text-red-100" }
        : { label: "Waiting", className: "bg-white/[0.06] text-base-content/65" };
  const currentResult =
    share === null
      ? run.status === "completed"
        ? "Insufficient responses"
        : "Waiting for responses"
      : `${percent(share)} chose the candidate`;
  return (
    <article className="surface-card rounded-2xl p-5" aria-labelledby={`evaluation-${run.runId}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-blue)]">{run.projectName}</p>
          <h3 id={`evaluation-${run.runId}`} className="mt-1 text-lg font-semibold">
            {run.suiteName}
          </h3>
        </div>
        <span className={`self-start rounded-md px-2 py-1 text-xs ${presentationStatus.className}`}>
          {presentationStatus.label}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]">
        <div>
          <p className="text-xs text-base-content/55">{decision ? "Decision" : "Current result"}</p>
          <p className="mt-1 text-2xl font-semibold">{decision ?? currentResult}</p>
          <SampleNote run={run} />
          {run.failureSummary ? (
            <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.06] p-3">
              <h4 className="text-sm font-semibold text-red-100">Why this failed</h4>
              <p className="mt-1 text-sm leading-6 text-red-100/80">{run.failureSummary.message}</p>
            </div>
          ) : null}
          {decidable ? (
            <>
              <DecisionSignals run={run} />
              <ClientDecisionButtons run={run} workspaceId={workspaceId} trend={trend} onDecided={setClientDecision} />
            </>
          ) : null}
        </div>
        {run.candidateSelectionIntervalBps ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.025] p-4 text-sm">
            <p className="text-xs text-base-content/55">95% confidence interval</p>
            <p className="mt-1 font-mono">
              {percent(run.candidateSelectionIntervalBps.lower)}–{percent(run.candidateSelectionIntervalBps.upper)}
            </p>
            <p className="mt-3 text-xs text-base-content/55">{run.distinctReviewers} reviewers</p>
          </div>
        ) : null}
      </div>

      {evidenceHref ? (
        <div className="mt-4">
          <Link className="btn btn-outline btn-sm" href={evidenceHref}>
            Open evidence
          </Link>
        </div>
      ) : null}

      <details className="mt-4 border-t border-white/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
          Evidence and run details
        </summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-base-content/55">Cases</dt>
            <dd className="mt-1 font-mono">{run.caseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Calibration items</dt>
            <dd className="mt-1 font-mono">{run.calibrationCaseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Reviewers</dt>
            <dd className="mt-1 font-mono">{run.distinctReviewers}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Reviewer source</dt>
            <dd className="mt-1 capitalize">{run.reviewerSource}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Compensation</dt>
            <dd className="mt-1 capitalize">{run.compensation}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Evidence packet</dt>
            <dd className="mt-1">{run.evidencePacketAvailable ? "Available" : "Not generated"}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">Created</dt>
            <dd className="mt-1">{new Date(run.createdAt).toLocaleString()}</dd>
          </div>
          {run.attribution.status === "attributed" ? (
            <>
              <div>
                <dt className="text-xs text-base-content/55">Agent ID</dt>
                <dd className="mt-1 break-all font-mono">{run.attribution.agentId}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">Agent version</dt>
                <dd className="mt-1 break-all font-mono">{run.attribution.versionId}</dd>
              </div>
            </>
          ) : null}
          {run.mechanismHealth ? (
            <>
              <div>
                <dt className="text-xs text-base-content/55">Quorum-case unanimity</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.unanimityRateBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">Calibration failure rate</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.goldFailureRateBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">Comparable-case drift</dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.comparableDriftBps)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">Quality score variance (percentage points²)</dt>
                <dd className="mt-1 font-mono">{percentagePointsSquared(run.mechanismHealth.rbtsScoreVarianceBps2)}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {run.attribution.status === "unattributed" ? (
          <p className="mt-4 text-xs leading-5 text-base-content/55">
            This run has no immutable agent-version reference, so it is excluded from per-agent comparisons.
          </p>
        ) : null}
        <code className="mt-3 block break-all text-[11px] text-base-content/55">{run.runId}</code>
      </details>
      {["completed", "failed", "dead"].includes(run.status) ? (
        <OversightCaseDetail run={run} workspaceId={workspaceId} />
      ) : null}
      {run.status === "completed" ? (
        <div className="mt-4 border-t border-white/10 pt-4">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            aria-controls={`override-record-${run.runId}`}
            aria-expanded={overrideOpen}
            onClick={() => setOverrideOpen(current => !current)}
          >
            {overrideOpen ? "Done" : "Record override or corrective action"}
          </button>
          {overrideOpen ? (
            <div id={`override-record-${run.runId}`}>
              <OverrideRecordForm run={run} workspaceId={workspaceId} trend={trend} />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function EvaluationDashboardPanel({ initialWorkspaceId = "" }: { initialWorkspaceId?: string }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [dashboard, setDashboard] = useState<EvaluationDashboard | null>(null);
  const [assuranceMetrics, setAssuranceMetrics] = useState<AssuranceMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urlState, setUrlState] = useState<EvaluationUrlState>(DEFAULT_EVALUATION_URL_STATE);
  const [currentSearch, setCurrentSearch] = useState("");

  const updateUrlState = useCallback((patch: Partial<EvaluationUrlState>) => {
    const href = evaluationUrlHref({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      patch,
    });
    window.history.replaceState(window.history.state, "", href);
    setCurrentSearch(window.location.search);
    setUrlState(parseEvaluationUrlState(window.location.search));
  }, []);

  useEffect(() => {
    const restoreUrlState = () => {
      setCurrentSearch(window.location.search);
      setUrlState(parseEvaluationUrlState(window.location.search));
    };
    restoreUrlState();
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
  }, []);

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
      setMetricsError(false);
      try {
        const requestedSelection = new URLSearchParams();
        if (urlState.runId) requestedSelection.set("run", urlState.runId);
        if (urlState.projectId) requestedSelection.set("project", urlState.projectId);
        const requestedSearch = requestedSelection.size ? `?${requestedSelection.toString()}` : "";
        const body = await readJson(
          await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/evaluations${requestedSearch}`, {
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
  }, [urlState.projectId, urlState.runId, workspaceId]);

  const agentOptions = useMemo(() => {
    if (!dashboard) return [];
    const labels = new Map(dashboard.agents.map(agent => [agent.agentId, agent.displayName || agent.externalId]));
    for (const run of dashboard.runs) {
      if (run.attribution.status === "attributed" && !labels.has(run.attribution.agentId)) {
        labels.set(run.attribution.agentId, run.attribution.agentId);
      }
    }
    return [...labels].sort((left, right) => left[1].localeCompare(right[1]));
  }, [dashboard]);

  const workflowOptions = useMemo(
    () =>
      dashboard
        ? [
            ...new Set(dashboard.runs.map(run => run.workflowKey).filter((value): value is string => Boolean(value))),
          ].sort((left, right) => left.localeCompare(right))
        : [],
    [dashboard],
  );

  const orderedRuns = useMemo(() => {
    if (!dashboard) return [];
    const query = urlState.query.toLocaleLowerCase();
    const cutoff =
      urlState.date === "all" ? null : Date.now() - Number.parseInt(urlState.date, 10) * 24 * 60 * 60 * 1_000;
    return dashboard.runs
      .filter(run => {
        if (urlState.runId && run.runId !== urlState.runId) return false;
        if (urlState.projectId && run.projectId !== urlState.projectId) return false;
        if (
          query &&
          ![
            run.projectName,
            run.suiteName,
            run.runId,
            run.workflowKey,
            run.evidencePacketDigest,
            run.attribution.status === "attributed" ? run.attribution.agentId : null,
          ]
            .filter((value): value is string => Boolean(value))
            .some(value => value.toLocaleLowerCase().includes(query))
        ) {
          return false;
        }
        if (
          urlState.agentId &&
          (run.attribution.status !== "attributed" || run.attribution.agentId !== urlState.agentId)
        ) {
          return false;
        }
        if (urlState.workflowKey && run.workflowKey !== urlState.workflowKey) return false;
        if (urlState.status !== "all" && runPresentationStatus(run) !== urlState.status) return false;
        if (cutoff !== null) {
          const timestamp = new Date(run.completedAt ?? run.createdAt).getTime();
          if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
        }
        return true;
      })
      .sort((left, right) => {
        const actionDifference = Number(runNeedsDecision(right)) - Number(runNeedsDecision(left));
        if (actionDifference !== 0) return actionDifference;
        return (
          new Date(right.completedAt ?? right.createdAt).getTime() -
          new Date(left.completedAt ?? left.createdAt).getTime()
        );
      });
  }, [dashboard, urlState]);

  const filtersActive =
    urlState.query !== "" ||
    urlState.projectId !== "" ||
    urlState.agentId !== "" ||
    urlState.workflowKey !== "" ||
    urlState.status !== "all" ||
    urlState.date !== "all" ||
    urlState.runId !== null;

  return (
    <div className="space-y-5">
      <section className="surface-card rounded-2xl p-6">
        <h2 className="text-2xl font-semibold">Human review results</h2>
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
            <div className="surface-card rounded-2xl p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field
                  label="Search results"
                  value={urlState.query}
                  placeholder="Project, suite, run, or packet"
                  onChange={event => updateUrlState({ query: event.target.value, runId: null })}
                />
                <SelectField
                  label="Agent"
                  value={urlState.agentId}
                  onChange={event => updateUrlState({ agentId: event.target.value, runId: null })}
                >
                  <option value="">All agents</option>
                  {agentOptions.map(([agentId, label]) => (
                    <option key={agentId} value={agentId}>
                      {label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Workflow"
                  value={urlState.workflowKey}
                  onChange={event => updateUrlState({ workflowKey: event.target.value, runId: null })}
                >
                  <option value="">All workflows</option>
                  {workflowOptions.map(workflowKey => (
                    <option key={workflowKey} value={workflowKey}>
                      {workflowKey}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Outcome"
                  value={urlState.status}
                  onChange={event =>
                    updateUrlState({ status: event.target.value as EvaluationUrlState["status"], runId: null })
                  }
                >
                  <option value="all">All outcomes</option>
                  <option value="needs_action">Needs action</option>
                  <option value="failed">Failed</option>
                  <option value="completed">Completed</option>
                  <option value="waiting">Waiting</option>
                </SelectField>
                <SelectField
                  label="Date"
                  value={urlState.date}
                  onChange={event =>
                    updateUrlState({ date: event.target.value as EvaluationUrlState["date"], runId: null })
                  }
                >
                  <option value="all">Any time</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                </SelectField>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/55">
                <p>
                  Showing {orderedRuns.length} of {dashboard.runs.length} results
                </p>
                {filtersActive ? (
                  <button type="button" className="link" onClick={() => updateUrlState(DEFAULT_EVALUATION_URL_STATE)}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
            {orderedRuns.length > 0 ? (
              orderedRuns.map(run => (
                <RunCard
                  key={run.runId}
                  run={run}
                  workspaceId={workspaceId}
                  trend={dashboard.deciderTrend}
                  evidenceHref={
                    run.evidencePacketAvailable ? evidenceHrefForRun(workspaceId, run.runId, currentSearch) : null
                  }
                />
              ))
            ) : (
              <div className="surface-card rounded-2xl p-6">
                <h3 className="font-semibold">No results match these filters</h3>
                <p className="mt-2 text-sm text-base-content/55">Clear one or more filters to see other runs.</p>
              </div>
            )}
          </section>

          <details className="surface-card rounded-2xl p-6">
            <summary className="cursor-pointer text-sm font-semibold">Operations and policy details</summary>
            <div className="mt-5 space-y-6">
              {assuranceMetrics ? <AssuranceMetricsSummary snapshot={assuranceMetrics} /> : null}
              {metricsError ? (
                <p className="text-xs text-amber-100/80" role="status">
                  Assurance operations metrics are temporarily unavailable.
                </p>
              ) : null}
              <ModelEvidencePanel profiles={dashboard.modelProfiles} />
              <AdaptiveCoverageSummary agents={dashboard.agents} />
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
                      <dt className="text-xs text-base-content/55">{label}</dt>
                      <dd className="mt-2 font-mono text-xl">{value}</dd>
                    </div>
                  ))}
                </dl>
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
                            <dt className="text-xs text-base-content/55">Per panel</dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxPanelAtomic)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">Daily</dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxDailyAtomic)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">Monthly</dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxMonthlyAtomic)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">Maximum humans</dt>
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
