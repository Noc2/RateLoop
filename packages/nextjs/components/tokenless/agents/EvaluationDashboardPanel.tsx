"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AgentText } from "./AgentText";
import { useAgentFormatter, useAgentLocale, useAgentTranslations } from "./AgentsLocaleProvider";
import { AdaptiveCoverageSummary } from "~~/components/tokenless/agents/AdaptiveCoverageSummary";
import { ModelEvidencePanel } from "~~/components/tokenless/agents/ModelEvidencePanel";
import { agentTabHref } from "~~/components/tokenless/agents/agentWorkspaceState";
import {
  evaluationRunNeedsDecision,
  evaluationRunPresentationStatus,
  evaluationRunResultState,
  evaluationRunTerminalOutcome,
} from "~~/components/tokenless/agents/evaluationRunPresentation";
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
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
import type { AssuranceMetricsSnapshot } from "~~/lib/tokenless/assuranceMetrics";
import type { DeciderDecisionTrend, EvaluationDashboard, EvaluationRun } from "~~/lib/tokenless/evaluationDashboard";
import { readJson } from "~~/lib/tokenless/http";
import type { OversightRunCaseView } from "~~/lib/tokenless/oversightCaseView";

type Workspace = { workspaceId: string; name: string; role: string };
type Translate = (key: string, values?: Record<string, number | string>) => string;

function percent(bps: number | null, copy: Translate, locale: string) {
  return bps === null
    ? copy("suppressed")
    : `${(bps / 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function percentagePointsSquared(value: string | null, copy: Translate, locale: string) {
  if (value === null) return copy("notAvailable");
  try {
    const roundedHundredths = (BigInt(value) + 50n) / 100n;
    return (Number(roundedHundredths) / 100).toLocaleString(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return copy("notAvailable");
  }
}

function usdc(atomic: string, locale: string, copy: Translate) {
  try {
    const amount = BigInt(atomic);
    const whole = amount / 1_000_000n;
    const fractional = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
    const decimal =
      new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
    return `${whole.toLocaleString(locale)}${fractional ? `${decimal}${fractional}` : ""} USDC`;
  } catch {
    return copy("atomicUnits", { value: atomic });
  }
}

function decisionLabel(decision: EvaluationRun["clientDecision"], copy: Translate) {
  return decision ? copy(`decision.${decision}`) : null;
}

function humanDuration(seconds: number, copy: Translate) {
  if (seconds < 60) return copy("durationSeconds", { count: seconds });
  if (seconds < 3_600) return copy("durationMinutes", { count: Math.round(seconds / 60) });
  if (seconds < 86_400) return copy("durationHours", { count: Math.round(seconds / 3_600) });
  return copy("durationDays", { count: Math.round(seconds / 86_400) });
}

function evidenceHrefForRun(workspaceId: string, runId: string, currentSearch: string) {
  const route = new URL(
    agentTabHref("evaluations", workspaceId, new URLSearchParams(currentSearch)),
    "https://rateloop.local",
  );
  route.search = updateEvidenceUrlSearch(route.search, { runId, packetId: null });
  route.hash = "evidence-packets-heading";
  return `${route.pathname}${route.search}${route.hash}`;
}

function AssuranceMetricsSummary({ snapshot }: { snapshot: AssuranceMetricsSnapshot }) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const locale = useAgentLocale();
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
  const sampling =
    totals.eligible > 0
      ? `${((totals.requested / totals.eligible) * 100).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}%`
      : copy("noData");
  const disagreement =
    totals.comparable > 0
      ? `${((totals.disagreements / totals.comparable) * 100).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })}%`
      : copy("noData");
  const latency =
    totals.latencyCount > 0
      ? humanDuration(Math.round(totals.latencyMilliseconds / totals.latencyCount / 1_000), copy)
      : copy("noData");
  const anchor =
    snapshot.evidenceAnchor.state === "absent"
      ? copy("noAnchor")
      : `${copy(`anchor.${snapshot.evidenceAnchor.state}`)} · ${humanDuration(snapshot.evidenceAnchor.lagSeconds, copy)}`;
  const overrideRate =
    snapshot.overrideDecisions.overrideRateBps === null
      ? copy("noData")
      : copy("overrideRateValue", {
          percent: (snapshot.overrideDecisions.overrideRateBps / 100).toLocaleString(locale, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }),
          count: snapshot.overrideDecisions.decided,
        });
  return (
    <Card as="section" className="rounded-2xl p-6" aria-labelledby="assurance-metrics-heading">
      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
        <AgentText id="last30Days" />
      </p>
      <h2 id="assurance-metrics-heading" className="mt-2 text-xl font-semibold">
        <AgentText id="translated099" />
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [copy("samplingRate"), sampling],
          [copy("meanVerdictLatency"), latency],
          [copy("disagreementRate"), disagreement],
          [copy("overrideRate"), overrideRate],
          [copy("latestEvidenceAnchor"), anchor],
        ].map(([label, value]) => (
          <Card as="div" variant="nested" key={label} className="rounded-xl p-4">
            <dt className="text-xs text-base-content/55">{label}</dt>
            <dd className="mt-2 font-mono text-sm">{value}</dd>
          </Card>
        ))}
      </dl>
      <p className="mt-3 text-xs text-base-content/55">
        {snapshot.reviewsRequested} <AgentText id="translated100" /> {snapshot.reviewsCompleted}{" "}
        <AgentText id="translated101" /> {snapshot.blocked} <AgentText id="translated102" /> {snapshot.approvalRequired}{" "}
        <AgentText id="translated103" />
      </p>
    </Card>
  );
}

function SampleNote({ run }: { run: EvaluationRun }) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  if (run.sampleStatus === "suppressed") {
    return (
      <p className="mt-2 text-xs leading-5 text-warning/80" role="status">
        {copy(evaluationRunTerminalOutcome(run.status) ? "suppressedSampleTerminal" : "suppressedSampleWaiting", {
          count: run.minimumAggregationSize,
        })}
      </p>
    );
  }
  if (run.sampleStatus === "small") {
    return (
      <p className="mt-2 text-xs leading-5 text-warning/80">
        <AgentText id="translated106" />
        {run.validResponses}
        <AgentText id="translated107" />
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-base-content/55">
      {run.validResponses} <AgentText id="translated108" />
    </p>
  );
}

/**
 * Signals a decider must see before the decision buttons: reviewer
 * disagreement, calibration (gold) failures and mechanism health, and how old
 * the evidence is. Rendered above every decision and override control.
 */
function DecisionSignals({ run }: { run: EvaluationRun }) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const locale = useAgentLocale();
  const share = run.candidateSelectionShareBps;
  const dissentBps = share === null ? null : Math.min(share, 10_000 - share);
  const evidenceAgeHours = run.completedAt
    ? Math.max(0, Math.round((Date.now() - new Date(run.completedAt).getTime()) / 3_600_000))
    : null;
  const signals: Array<[string, string]> = [
    [copy("reviewerDissent"), percent(dissentBps, copy, locale)],
    [
      copy("calibrationFailureRate"),
      run.mechanismHealth?.goldFailureRateBps === null || run.mechanismHealth === null
        ? copy("noCalibrationData")
        : percent(run.mechanismHealth.goldFailureRateBps, copy, locale),
    ],
    [
      copy("quorumCaseUnanimity"),
      run.mechanismHealth?.unanimityRateBps === null || run.mechanismHealth === null
        ? copy("noData")
        : percent(run.mechanismHealth.unanimityRateBps, copy, locale),
    ],
    [
      copy("timeSinceEvidence"),
      evidenceAgeHours === null
        ? copy("notCompleted")
        : evidenceAgeHours < 48
          ? copy("durationHours", { count: evidenceAgeHours })
          : copy("durationDays", { count: Math.round(evidenceAgeHours / 24) }),
    ],
  ];
  return (
    <div className="mt-3 rounded-xl border border-base-content/10 bg-base-content/[0.02] p-3" role="note">
      <p className="text-xs font-semibold text-base-content/55">
        <AgentText id="beforeDecide" />
      </p>
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

function deciderTrendLabel(trend: DeciderDecisionTrend | undefined, copy: Translate) {
  if (!trend) return null;
  const parts: string[] = [];
  if (trend.clientDecisions.total > 0) {
    const share = Math.round((trend.clientDecisions.goCount / trend.clientDecisions.total) * 100);
    parts.push(copy("goTrend", { percent: share, count: trend.clientDecisions.total }));
  }
  if (trend.overrides.total > 0) {
    const share = Math.round((trend.overrides.acceptedCount / trend.overrides.total) * 100);
    parts.push(copy("acceptedTrend", { percent: share, count: trend.overrides.total }));
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
  const ui = useAgentTranslations("ui");
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const errors = useAgentTranslations("errors");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { capture, clear, fieldErrors, formError } = useFormErrors();
  const explanationMissing = run.explanationRequired && note.trim().length < 10;
  const trendLabel = deciderTrendLabel(trend, copy);

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
    } catch {
      capture(errors("recordDecision"), errors("recordDecision"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-base-content/55">
        <AgentText id="signOff" />
      </p>
      {trendLabel ? <p className="mt-1 text-xs text-base-content/55">{trendLabel}</p> : null}
      {run.explanationRequired ? (
        <div className="mt-2 rounded-lg border border-warning/20 bg-warning/[0.06] p-3">
          <p className="text-xs font-semibold text-warning/90">
            <AgentText id="explainDecision" />
          </p>
          <p className="mt-1 text-xs leading-5 text-warning/70">
            <AgentText id="translated109" />
          </p>
          <TextareaField
            label={<AgentText id="attribute007" />}
            className="mt-2 w-full border-base-content/10 bg-[var(--rateloop-field)] text-sm"
            placeholder={ui("reasonsRunPlaceholder")}
            hint={
              explanationMissing
                ? copy("signOffCharactersRemaining", { count: 10 - note.trim().length })
                : copy("signOffReady")
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
            {decisionLabel(choice, copy)}
          </button>
        ))}
      </div>
      {formError ? (
        <p className="mt-2 text-xs text-error" role="alert">
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
  const ui = useAgentTranslations("ui");
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const errors = useAgentTranslations("errors");
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
    } catch {
      capture(errors("recordOverride"), errors("recordOverride"));
    } finally {
      setBusy(false);
    }
  }

  const trendLabel = deciderTrendLabel(trend, copy);
  const reasonsTooShort = reasons.trim().length < 10;
  return (
    <form className="mt-4 border-t border-base-content/10 pt-4" onSubmit={event => event.preventDefault()}>
      <p className="text-sm font-semibold text-base-content/65">
        <AgentText id="recordAction" />
      </p>
      <p className="mt-1 text-xs text-base-content/55">
        <AgentText id="translated110" />
      </p>
      {trendLabel ? <p className="mt-1 text-xs text-base-content/55">{trendLabel}</p> : null}
      <DecisionSignals run={run} />
      {recorded ? (
        <p className="mt-2 text-xs text-success" role="status">
          <AgentText id="translated111" /> {copy(`override.${recorded}`)}
          <AgentText id="translated112" />
        </p>
      ) : null}
      <TextareaField
        label={<AgentText id="attribute007" />}
        className="mt-3 w-full border-base-content/10 bg-[var(--rateloop-field)] text-sm"
        placeholder={ui("reasonsPlaceholder")}
        hint={
          reasonsTooShort
            ? copy("outcomeCharactersRemaining", { count: 10 - reasons.trim().length })
            : copy("outcomeReady")
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
        label={<AgentText id="attribute008" />}
        className="mt-2 w-full border-base-content/10 bg-[var(--rateloop-field)] text-sm"
        placeholder={ui("correctiveActionPlaceholder")}
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
            {copy(`override.${outcome}`)}
          </button>
        ))}
      </div>
      {formError ? (
        <p className="mt-2 text-xs text-error" role="alert">
          {formError}
        </p>
      ) : null}
    </form>
  );
}

function OversightCaseDetail({ run, workspaceId }: { run: EvaluationRun; workspaceId: string }) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const format = useAgentFormatter();
  const locale = useAgentLocale();
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
    <details
      className="mt-4 border-t border-base-content/10 pt-4"
      onToggle={event => event.currentTarget.open && void load()}
    >
      <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
        {copy(run.failureSummary ? "failedCaseDetails" : "caseDetails")}
      </summary>
      {state === "loading" ? (
        <p className="mt-3 text-xs text-base-content/55">
          <AgentText id="loadingCase" />
        </p>
      ) : null}
      {state === "denied" ? (
        <p className="mt-3 text-xs text-base-content/55">
          <AgentText id="translated113" />
        </p>
      ) : null}
      {state === "error" ? (
        <p className="mt-3 text-xs text-error" role="alert">
          <AgentText id="translated114" />
        </p>
      ) : null}
      {view && !view.detailAvailable ? (
        <p className="mt-3 text-xs leading-5 text-base-content/55">{copy("caseDetailUnavailable")}</p>
      ) : null}
      {view?.detailAvailable ? (
        <div className="mt-3 space-y-3">
          {view.note ? (
            <p className="text-xs leading-5 text-base-content/55">
              {locale === "en" ? view.note : copy("caseNoteFallback")}
            </p>
          ) : null}
          {view.cases.some(caseView => caseView.responses.length > 0) ? (
            <p className="text-xs leading-5 text-base-content/55">
              <AgentText id="translated115" />
            </p>
          ) : null}
          {view.cases.map(caseView => (
            <article
              key={caseView.caseId}
              className="rounded-xl border border-base-content/10 bg-base-content/[0.02] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold">
                  {caseView.title}
                  {caseView.isCalibration ? (
                    <span className="ml-2 rounded bg-base-content/[0.08] px-1.5 py-0.5 text-[10px] uppercase">
                      <AgentText id="translated116" />
                    </span>
                  ) : null}
                </h4>
                <p className="text-xs text-base-content/55">
                  {caseView.choiceCounts.candidate} <AgentText id="translated117" /> {caseView.choiceCounts.baseline}{" "}
                  <AgentText id="translated118" />
                  {caseView.disagreementBps !== null
                    ? ` · ${copy("dissentValue", { value: percent(caseView.disagreementBps, copy, locale) })}`
                    : ""}
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-base-content/60">{caseView.instructions}</p>
              <p className="mt-2 flex flex-wrap gap-2 text-xs">
                {caseView.artifacts.map(artifact => (
                  <a
                    key={artifact.artifactId}
                    className="rounded-md bg-base-content/[0.06] px-2 py-1 capitalize text-[var(--rateloop-blue)]"
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
                    <li
                      key={`${caseView.caseId}-${index}`}
                      className="rounded-lg bg-base-content/[0.04] p-3 text-xs leading-5"
                    >
                      <p className="text-base-content/55">
                        {response.reviewerPseudonym} <AgentText id="translated119" /> {response.choice}
                        {response.failureTagKeys.length > 0 ? ` · ${response.failureTagKeys.join(", ")}` : ""}
                      </p>
                      {response.rationale ? (
                        <p className="mt-1 whitespace-pre-wrap text-base-content/70">{response.rationale}</p>
                      ) : (
                        <p className="mt-1 text-base-content/55">
                          <AgentText id="noRationale" />
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-base-content/55">
                  <AgentText id="noResponses" />
                </p>
              )}
            </article>
          ))}
          {view.overrideDecisions.length > 0 ? (
            <div className="rounded-xl border border-base-content/10 bg-base-content/[0.02] p-4">
              <h4 className="text-sm font-semibold">
                <AgentText id="overrideHistory" />
              </h4>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-base-content/60">
                {view.overrideDecisions.map(decision => (
                  <li key={decision.recordId}>
                    <span>{copy(`override.${decision.outcome}`)}</span>
                    {decision.current ? "" : ` (${copy("superseded")})`} ·{" "}
                    {format.dateTime(new Date(decision.decidedAt), { dateStyle: "medium", timeStyle: "short" })} —{" "}
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
  onDecided,
}: {
  run: EvaluationRun;
  workspaceId: string;
  trend?: DeciderDecisionTrend;
  evidenceHref: string | null;
  onDecided: (runId: string, decision: NonNullable<EvaluationRun["clientDecision"]>) => void;
}) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const format = useAgentFormatter();
  const locale = useAgentLocale();
  const share = run.candidateSelectionShareBps;
  const [overrideOpen, setOverrideOpen] = useState(false);
  const decision = decisionLabel(run.clientDecision, copy);
  const decidable = evaluationRunNeedsDecision(run);
  const status = evaluationRunPresentationStatus(run);
  const presentationStatus =
    status === "needs_action"
      ? { label: copy("status.needsAction"), className: "bg-warning/10 text-warning" }
      : status === "completed"
        ? { label: copy("status.completed"), className: "bg-success/10 text-success" }
        : status === "failed"
          ? { label: copy("status.failed"), className: "bg-error/10 text-error" }
          : { label: copy("status.waiting"), className: "bg-base-content/[0.06] text-base-content/65" };
  const resultState = evaluationRunResultState(run);
  const currentResult =
    resultState === "candidate"
      ? copy("candidateChoice", { percent: percent(share, copy, locale) })
      : resultState === "insufficient"
        ? copy("insufficientResponses")
        : resultState === "failed"
          ? copy("notAvailable")
          : copy("waitingForResponses");
  return (
    <Card as="article" className="rounded-2xl p-5" aria-labelledby={`evaluation-${run.runId}`}>
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
          <p className="text-2xl font-semibold">{decision ?? currentResult}</p>
          <SampleNote run={run} />
          {run.failureSummary ? (
            <div className="mt-3 rounded-xl border border-error/20 bg-error/[0.06] p-3">
              <h4 className="text-sm font-semibold text-error">
                <AgentText id="whyFailed" />
              </h4>
              <p className="mt-1 text-sm leading-6 text-error/80">{copy("failureSummaryFallback")}</p>
            </div>
          ) : null}
          {decidable ? (
            <>
              <DecisionSignals run={run} />
              <ClientDecisionButtons
                run={run}
                workspaceId={workspaceId}
                trend={trend}
                onDecided={clientDecision => onDecided(run.runId, clientDecision)}
              />
            </>
          ) : null}
        </div>
        {run.candidateSelectionIntervalBps ? (
          <div className="rounded-xl border border-base-content/10 bg-base-content/[0.025] p-4 text-sm">
            <p className="text-xs text-base-content/55">
              <AgentText id="confidenceInterval" />
            </p>
            <p className="mt-1 font-mono">
              {percent(run.candidateSelectionIntervalBps.lower, copy, locale)}–
              {percent(run.candidateSelectionIntervalBps.upper, copy, locale)}
            </p>
            <p className="mt-3 text-xs text-base-content/55">
              {run.distinctReviewers} <AgentText id="translated120" />
            </p>
          </div>
        ) : null}
      </div>

      {evidenceHref ? (
        <div className="mt-4">
          <Link className="btn btn-outline btn-sm" href={evidenceHref}>
            <AgentText id="translated121" />
          </Link>
        </div>
      ) : null}

      <details className="mt-4 border-t border-base-content/10 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-base-content/65">
          <AgentText id="translated122" />
        </summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="cases" />
            </dt>
            <dd className="mt-1 font-mono">{run.caseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="calibrationItems" />
            </dt>
            <dd className="mt-1 font-mono">{run.calibrationCaseCount}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="reviewers" />
            </dt>
            <dd className="mt-1 font-mono">{run.distinctReviewers}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="reviewerSource" />
            </dt>
            <dd className="mt-1">{copy(`reviewerSource.${run.reviewerSource}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="compensation" />
            </dt>
            <dd className="mt-1">{copy(`compensation.${run.compensation}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="evidencePacket" />
            </dt>
            <dd className="mt-1">{copy(run.evidencePacketAvailable ? "evidenceAvailable" : "evidenceNotGenerated")}</dd>
          </div>
          <div>
            <dt className="text-xs text-base-content/55">
              <AgentText id="created" />
            </dt>
            <dd className="mt-1">
              {format.dateTime(new Date(run.createdAt), { dateStyle: "medium", timeStyle: "short" })}
            </dd>
          </div>
          {run.attribution.status === "attributed" ? (
            <>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="agentId" />
                </dt>
                <dd className="mt-1 break-all font-mono">{run.attribution.agentId}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="agentVersion" />
                </dt>
                <dd className="mt-1 break-all font-mono">{run.attribution.versionId}</dd>
              </div>
            </>
          ) : null}
          {run.mechanismHealth ? (
            <>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="quorumUnanimity" />
                </dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.unanimityRateBps, copy, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="calibrationFailure" />
                </dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.goldFailureRateBps, copy, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="comparableDrift" />
                </dt>
                <dd className="mt-1 font-mono">{percent(run.mechanismHealth.comparableDriftBps, copy, locale)}</dd>
              </div>
              <div>
                <dt className="text-xs text-base-content/55">
                  <AgentText id="qualityVariance" />
                </dt>
                <dd className="mt-1 font-mono">
                  {percentagePointsSquared(run.mechanismHealth.rbtsScoreVarianceBps2, copy, locale)}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
        {run.attribution.status === "unattributed" ? (
          <p className="mt-4 text-xs leading-5 text-base-content/55">
            <AgentText id="translated123" />
          </p>
        ) : null}
        <code className="mt-3 block break-all text-[11px] text-base-content/55">{run.runId}</code>
      </details>
      {["completed", "failed", "dead"].includes(run.status) ? (
        <OversightCaseDetail run={run} workspaceId={workspaceId} />
      ) : null}
      {run.status === "completed" ? (
        <div className="mt-4 border-t border-base-content/10 pt-4">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            aria-controls={`override-record-${run.runId}`}
            aria-expanded={overrideOpen}
            onClick={() => setOverrideOpen(current => !current)}
          >
            {overrideOpen ? <AgentText id="dynamic054" /> : copy("recordOverride")}
          </button>
          {overrideOpen ? (
            <div id={`override-record-${run.runId}`}>
              <OverrideRecordForm run={run} workspaceId={workspaceId} trend={trend} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

export function EvaluationDashboardPanel({ initialWorkspaceId = "" }: { initialWorkspaceId?: string }) {
  const copy = useAgentTranslations("evidencePanels.evaluation");
  const ui = useAgentTranslations("ui");
  const errors = useAgentTranslations("errors");
  const locale = useAgentLocale();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [dashboard, setDashboard] = useState<EvaluationDashboard | null>(null);
  const [assuranceMetrics, setAssuranceMetrics] = useState<AssuranceMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urlState, setUrlState] = useState<EvaluationUrlState>(DEFAULT_EVALUATION_URL_STATE);
  const [currentSearch, setCurrentSearch] = useState("");

  const handleRunDecided = useCallback(
    (runId: string, clientDecision: NonNullable<EvaluationRun["clientDecision"]>) => {
      setDashboard(current =>
        current
          ? {
              ...current,
              runs: current.runs.map(run => (run.runId === runId ? { ...run, clientDecision } : run)),
            }
          : current,
      );
    },
    [],
  );

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
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadEvaluations"));
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, [errors, initialWorkspaceId]);

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
      } catch {
        if (!controller.signal.aborted) {
          setError(errors("loadEvaluations"));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [errors, urlState.projectId, urlState.runId, workspaceId]);

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
        if (urlState.status !== "all" && evaluationRunPresentationStatus(run) !== urlState.status) return false;
        if (cutoff !== null) {
          const timestamp = new Date(run.completedAt ?? run.createdAt).getTime();
          if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
        }
        return true;
      })
      .sort((left, right) => {
        const actionDifference = Number(evaluationRunNeedsDecision(right)) - Number(evaluationRunNeedsDecision(left));
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
      {error ? (
        <div className="rounded-xl border border-error/20 bg-error/[0.06] p-4 text-sm text-error" role="alert">
          {error}
        </div>
      ) : null}
      <AsyncSection loading={loading} loadingLabel={copy("loadingEvaluations")}>
        {null}
      </AsyncSection>
      {!loading && workspaces.length === 0 ? (
        <Card as="div" className="rounded-2xl p-6">
          <h3 className="font-semibold">
            <AgentText id="createWorkspaceFirst" />
          </h3>
          <p className="mt-2 text-sm text-base-content/55">
            <AgentText id="evaluationsWorkspace" />
          </p>
        </Card>
      ) : null}

      {!loading && dashboard?.runs.length === 0 ? (
        <Card as="section" className="rounded-2xl p-6" aria-labelledby="evaluations-empty-heading">
          <h3 id="evaluations-empty-heading" className="font-semibold">
            <AgentText id="translated124" />
          </h3>
          <p className="mt-2 text-sm text-base-content/55">
            <AgentText id="resultsAfterReview" />
          </p>
        </Card>
      ) : null}

      {dashboard && dashboard.runs.length > 0 ? (
        <>
          <section className="space-y-3" aria-labelledby="evaluation-runs-heading">
            <h2 id="evaluation-runs-heading" className="text-xl font-semibold">
              <AgentText id="translated125" />
            </h2>
            <Card as="div" className="rounded-2xl p-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Field
                  label={<AgentText id="attribute009" />}
                  value={urlState.query}
                  placeholder={ui("searchPlaceholder")}
                  onChange={event => updateUrlState({ query: event.target.value, runId: null })}
                />
                <SelectField
                  label={<AgentText id="attribute010" />}
                  value={urlState.agentId}
                  onChange={event => updateUrlState({ agentId: event.target.value, runId: null })}
                >
                  <option value="">
                    <AgentText id="allAgents" />
                  </option>
                  {agentOptions.map(([agentId, label]) => (
                    <option key={agentId} value={agentId}>
                      {label}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={<AgentText id="attribute002" />}
                  value={urlState.workflowKey}
                  onChange={event => updateUrlState({ workflowKey: event.target.value, runId: null })}
                >
                  <option value="">
                    <AgentText id="allWorkflows" />
                  </option>
                  {workflowOptions.map(workflowKey => (
                    <option key={workflowKey} value={workflowKey}>
                      {workflowKey}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={<AgentText id="attribute011" />}
                  value={urlState.status}
                  onChange={event =>
                    updateUrlState({ status: event.target.value as EvaluationUrlState["status"], runId: null })
                  }
                >
                  <option value="all">
                    <AgentText id="allOutcomes" />
                  </option>
                  <option value="needs_action">
                    <AgentText id="needsAction" />
                  </option>
                  <option value="failed">
                    <AgentText id="failed" />
                  </option>
                  <option value="completed">
                    <AgentText id="completed" />
                  </option>
                  <option value="waiting">
                    <AgentText id="waiting" />
                  </option>
                </SelectField>
                <SelectField
                  label={<AgentText id="attribute012" />}
                  value={urlState.date}
                  onChange={event =>
                    updateUrlState({ date: event.target.value as EvaluationUrlState["date"], runId: null })
                  }
                >
                  <option value="all">
                    <AgentText id="anyTime" />
                  </option>
                  <option value="7">
                    <AgentText id="last7Days" />
                  </option>
                  <option value="30">
                    <AgentText id="last30Days" />
                  </option>
                </SelectField>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/55">
                <p>
                  <AgentText id="translated085" /> {orderedRuns.length} <AgentText id="translated063" />{" "}
                  {dashboard.runs.length} <AgentText id="translated126" />
                </p>
                {filtersActive ? (
                  <button type="button" className="link" onClick={() => updateUrlState(DEFAULT_EVALUATION_URL_STATE)}>
                    <AgentText id="translated089" />
                  </button>
                ) : null}
              </div>
            </Card>
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
                  onDecided={handleRunDecided}
                />
              ))
            ) : (
              <Card as="div" className="rounded-2xl p-6">
                <h3 className="font-semibold">
                  <AgentText id="noResults" />
                </h3>
                <p className="mt-2 text-sm text-base-content/55">
                  <AgentText id="clearFilters" />
                </p>
              </Card>
            )}
          </section>

          <Card as="details" className="rounded-2xl p-6">
            <summary className="cursor-pointer text-sm font-semibold">
              <AgentText id="operations" />
            </summary>
            <div className="mt-5 space-y-6">
              {assuranceMetrics ? <AssuranceMetricsSummary snapshot={assuranceMetrics} /> : null}
              {metricsError ? (
                <p className="text-xs text-warning/80" role="status">
                  <AgentText id="translated127" />
                </p>
              ) : null}
              <ModelEvidencePanel profiles={dashboard.modelProfiles} />
              <AdaptiveCoverageSummary agents={dashboard.agents} />
              <section aria-labelledby="evaluation-summary-heading">
                <h2 id="evaluation-summary-heading" className="text-base font-semibold">
                  <AgentText id="translated128" />
                </h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    [copy("runs"), dashboard.summary.totalRuns],
                    [copy("completedRuns"), dashboard.summary.completedRuns],
                    [copy("evidenceBacked"), dashboard.summary.evidenceBackedRuns],
                    [copy("validResponses"), dashboard.summary.validResponses],
                  ].map(([label, value]) => (
                    <Card as="div" variant="nested" key={label} className="rounded-xl p-4">
                      <dt className="text-xs text-base-content/55">{label}</dt>
                      <dd className="mt-2 font-mono text-xl">{value}</dd>
                    </Card>
                  ))}
                </dl>
              </section>
              <section aria-labelledby="publishing-limits-heading">
                <h2 id="publishing-limits-heading" className="text-base font-semibold">
                  <AgentText id="translated129" />
                </h2>
                {!dashboard.canViewPublishingPolicies ? (
                  <p className="mt-3 text-sm text-base-content/55">
                    <AgentText id="ownersOnly" />
                  </p>
                ) : dashboard.publishingPolicies?.length === 0 ? (
                  <p className="mt-3 text-sm text-base-content/55">
                    <AgentText id="noPublishingPolicy" />
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {dashboard.publishingPolicies?.map(policy => (
                      <Card as="article" variant="nested" key={policy.policyId} className="rounded-xl p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-medium">
                            {policy.name} · v{policy.version}
                          </h3>
                          <span className="rounded-md bg-base-content/[0.06] px-2 py-1 text-xs">
                            {copy(policy.enabled && !policy.revokedAt ? "active" : "inactive")}
                          </span>
                        </div>
                        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div>
                            <dt className="text-xs text-base-content/55">
                              <AgentText id="perPanel" />
                            </dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxPanelAtomic, locale, copy)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">
                              <AgentText id="daily" />
                            </dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxDailyAtomic, locale, copy)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">
                              <AgentText id="monthly" />
                            </dt>
                            <dd className="mt-1 font-mono">{usdc(policy.maxMonthlyAtomic, locale, copy)}</dd>
                          </div>
                          <div>
                            <dt className="text-xs text-base-content/55">
                              <AgentText id="maximumHumans" />
                            </dt>
                            <dd className="mt-1 font-mono">{policy.maxPanelSize}</dd>
                          </div>
                        </dl>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
