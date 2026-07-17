"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Chip } from "~~/components/tokenless/ui/Chip";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";
import { REVIEWER_EXPERTISE } from "~~/lib/tokenless/reviewerExpertiseOptions";

type QualificationProvenance = {
  key: string;
  value: string | number | boolean | string[];
  source: string;
  assertedBy: string;
  verifiedAt: string;
  expiresAt?: string;
};

type ArtifactLease = {
  artifactId: string;
  leaseId: string;
  expiresAt: string;
};

type ReviewOption = ArtifactLease & { key: "A" | "B" };

type ReviewCase = {
  caseId: string;
  position: number;
  title: string;
  instructions: string;
  options: ReviewOption[];
  context: ArtifactLease[];
  objectiveReference: string | null;
  failureTags?: Array<{ key: string; label: string }>;
};

export type AssignmentTask = {
  assignmentId: string;
  runId: string;
  source: "customer_invited" | "rateloop_network";
  runManifestHash: string;
  policyHash: string;
  qualificationProvenance: QualificationProvenance[];
  rubric: {
    prompt: string;
    failureTags: Array<{ key: string; label: string; description?: string }>;
    rationale: { mode: "optional" | "required"; minLength?: number; maxLength: number };
  };
  cases: ReviewCase[];
};

type ReviewDraft = {
  selectedOption: "A" | "B" | null;
  failureTags: string[];
  rationale: string;
};

export type AssuranceServerAcceptance = {
  accepted: true;
  replay: boolean;
  responseCount: number;
  compensation: "unpaid";
  settlementStatus: "not_applicable";
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const PRIVATE_REVIEW_JSON_OPTIONS = { fallbackMessage: "The private review request failed." };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : value;
}

function formatQualificationValue(value: QualificationProvenance["value"]) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function qualificationLabel(key: string) {
  const expertiseKey = key.startsWith("expertise:") ? key.slice("expertise:".length) : key;
  return (
    REVIEWER_EXPERTISE.find(value => value.key === expertiseKey)?.label ??
    key.replaceAll("_", " ").replaceAll(":", " · ")
  );
}

function provenanceSourceLabel(source: string) {
  return source.replaceAll("_", " ").replaceAll(":", " · ");
}

function artifactUrl(assignmentId: string, artifact: ArtifactLease) {
  return `/api/account/assurance/assignments/${encodeURIComponent(assignmentId)}/artifacts/${encodeURIComponent(
    artifact.artifactId,
  )}?leaseId=${encodeURIComponent(artifact.leaseId)}`;
}

function emptyDrafts(cases: ReviewCase[]) {
  return Object.fromEntries(
    cases.map(reviewCase => [reviewCase.caseId, { selectedOption: null, failureTags: [], rationale: "" }]),
  ) as Record<string, ReviewDraft>;
}

export function HumanAssuranceRaterClient({
  initialAssignmentId = "",
  initialServerAcceptance = null,
  initialTask = null,
  initialTermsHash = "",
}: {
  initialAssignmentId?: string | string[];
  initialServerAcceptance?: AssuranceServerAcceptance | null;
  initialTask?: AssignmentTask | null;
  initialTermsHash?: string | string[];
}) {
  const [assignmentId, setAssignmentId] = useState(firstValue(initialAssignmentId));
  const [termsHash, setTermsHash] = useState(firstValue(initialTermsHash));
  const [confidentialityAccepted, setConfidentialityAccepted] = useState(false);
  const [task, setTask] = useState<AssignmentTask | null>(initialTask);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() =>
    initialTask ? emptyDrafts(initialTask.cases) : {},
  );
  const [busyAction, setBusyAction] = useState<"assignment" | "recovery" | "response" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const [serverAcceptance, setServerAcceptance] = useState<AssuranceServerAcceptance | null>(initialServerAcceptance);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);

  const leaseDeadline = useMemo(() => {
    const values = task?.cases.flatMap(reviewCase => [
      ...reviewCase.options.map(option => option.expiresAt),
      ...reviewCase.context.map(context => context.expiresAt),
    ]);
    if (!values?.length) return null;
    return values.sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
  }, [task]);

  const completeDraft = Boolean(
    task?.cases.length &&
      task.cases.every(reviewCase => {
        const draft = drafts[reviewCase.caseId];
        const rationaleLength = draft?.rationale.trim().length ?? 0;
        const minimum = Math.max(10, task.rubric.rationale.minLength ?? 0);
        const maximum = Math.min(2_000, task.rubric.rationale.maxLength);
        return draft?.selectedOption && rationaleLength >= minimum && rationaleLength <= maximum;
      }),
  );
  const activeCase = task?.cases[activeCaseIndex] ?? null;
  const activeCaseComplete = Boolean(
    task &&
      activeCase &&
      drafts[activeCase.caseId]?.selectedOption &&
      (drafts[activeCase.caseId]?.rationale.trim().length ?? 0) >= Math.max(10, task.rubric.rationale.minLength ?? 0) &&
      (drafts[activeCase.caseId]?.rationale.trim().length ?? 0) <= Math.min(2_000, task.rubric.rationale.maxLength),
  );

  async function loadAssignment(id: string) {
    const body = await readJson(
      await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/task`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
      PRIVATE_REVIEW_JSON_OPTIONS,
    );
    const nextTask = body as AssignmentTask;
    setTask(nextTask);
    setDrafts(emptyDrafts(nextTask.cases));
    setActiveCaseIndex(0);
    setServerAcceptance(null);
    setCanRecover(false);
  }

  async function openAssignment(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const id = assignmentId.trim();
    setBusyAction("assignment");
    setError(null);
    setCanRecover(false);
    try {
      await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/accept`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confidentialityTermsHash: termsHash.trim() }),
        }),
        PRIVATE_REVIEW_JSON_OPTIONS,
      );
      await loadAssignment(id);
    } catch (cause) {
      const recoverable =
        cause instanceof HttpJsonError &&
        (cause.code === "assignment_expired" || cause.code === "artifact_lease_expired" || cause.status === 410);
      setCanRecover(recoverable);
      setError(cause instanceof Error ? cause.message : "Unable to open this assignment.");
    } finally {
      setBusyAction(null);
    }
  }

  async function recoverAssignment() {
    const id = assignmentId.trim();
    setBusyAction("recovery");
    setError(null);
    try {
      await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/recover`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confidentialityTermsHash: termsHash.trim() }),
        }),
        PRIVATE_REVIEW_JSON_OPTIONS,
      );
      setCanRecover(false);
      await openAssignment();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This assignment can no longer be recovered. Ask the customer for a new private assignment.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  function updateDraft(caseId: string, update: Partial<ReviewDraft>) {
    setDrafts(current => ({
      ...current,
      [caseId]: { ...current[caseId], ...update } as ReviewDraft,
    }));
  }

  function toggleFailureTag(caseId: string, tag: string) {
    const selected = drafts[caseId]?.failureTags ?? [];
    updateDraft(caseId, {
      failureTags: selected.includes(tag) ? selected.filter(value => value !== tag) : [...selected, tag],
    });
  }

  async function submitResponses() {
    if (!task || !completeDraft || serverAcceptance) return;
    setBusyAction("response");
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(task.assignmentId)}/responses`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotencyKey: `response:web:${task.assignmentId.slice(-96)}:${task.runManifestHash.slice(-16)}`,
            responses: task.cases.map(reviewCase => {
              const draft = drafts[reviewCase.caseId]!;
              const option = reviewCase.options.find(value => value.key === draft.selectedOption);
              if (!option) throw new Error("A selected case option is unavailable.");
              return {
                caseId: reviewCase.caseId,
                displayedOption: option.key,
                selectedArtifactId: option.artifactId,
                failureTagKeys: draft.failureTags,
                rationale: draft.rationale,
              };
            }),
          }),
        }),
        PRIVATE_REVIEW_JSON_OPTIONS,
      );
      if (
        body.accepted !== true ||
        typeof body.replay !== "boolean" ||
        typeof body.responseCount !== "number" ||
        !Number.isSafeInteger(body.responseCount) ||
        body.compensation !== "unpaid" ||
        body.settlementStatus !== "not_applicable"
      ) {
        throw new Error("The response acceptance was incomplete.");
      }
      setServerAcceptance(body as AssuranceServerAcceptance);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The server did not accept this response batch.");
    } finally {
      setBusyAction(null);
    }
  }

  function advanceReview() {
    if (!task || !activeCase || !activeCaseComplete || serverAcceptance) return;
    if (activeCaseIndex < task.cases.length - 1) {
      setActiveCaseIndex(index => index + 1);
      return;
    }
    void submitResponses();
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:py-10">
      <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Private assignment</p>
        <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
          {task ? "Complete your assigned review" : "Open your assigned review"}
        </h1>
        <p className="mt-3 text-base text-base-content/60">
          {task ? "Compare each blinded pair and explain your choice." : "Use the details from your invitation."}
        </p>
      </div>

      <div className="mt-8">
        <main className="space-y-6">
          {!task ? (
            <>
              <Card as="section" variant="marketing" className="p-5 sm:p-7">
                <h2 className="text-xl font-semibold">Assignment details</h2>
                <form className="mt-4 space-y-4" onSubmit={openAssignment}>
                  <label className="block text-sm text-base-content/60">
                    Assignment ID
                    <input
                      className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
                      value={assignmentId}
                      onChange={event => setAssignmentId(event.target.value)}
                      placeholder="haas_…"
                      required
                    />
                  </label>
                  <label className="block text-sm text-base-content/60">
                    Confidentiality terms hash
                    <input
                      className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] font-mono text-sm"
                      value={termsHash}
                      onChange={event => setTermsHash(event.target.value)}
                      placeholder="sha256:…"
                      pattern="sha256:[0-9a-f]{64}"
                      required
                    />
                  </label>
                  <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-4 text-sm leading-6 text-base-content/65">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm mt-1"
                      checked={confidentialityAccepted}
                      onChange={event => setConfidentialityAccepted(event.target.checked)}
                    />
                    <span>
                      I received and accept the confidentiality terms referenced by this exact hash. I will not copy,
                      share, or reuse assigned material outside this review.
                    </span>
                  </label>
                  <Button
                    type="submit"
                    className="w-full px-6"
                    disabled={
                      busyAction !== null ||
                      !confidentialityAccepted ||
                      assignmentId.trim().length < 8 ||
                      !/^sha256:[0-9a-f]{64}$/.test(termsHash.trim())
                    }
                  >
                    {busyAction === "assignment" ? "Checking assignment…" : "Accept terms and open assignment"}
                  </Button>
                </form>
                {canRecover ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-4 min-h-12 w-full text-sm"
                    disabled={busyAction !== null}
                    onClick={() => void recoverAssignment()}
                  >
                    {busyAction === "recovery" ? "Restoring access…" : "Retry expired assignment access"}
                  </Button>
                ) : null}
                <details className="mt-4 rounded-lg border border-white/10 px-4 py-3 text-sm text-base-content/60">
                  <summary className="cursor-pointer font-medium text-base-content/75">Privacy and access</summary>
                  <ul className="mt-3 space-y-2 text-xs leading-5">
                    <li>Only your assigned, blinded cases are returned.</li>
                    <li>Private artifact access is short-lived and logged.</li>
                    <li>Do not include personal data in your rationale.</li>
                  </ul>
                </details>
              </Card>
            </>
          ) : (
            <ReviewerShell
              advanceDisabled={
                busyAction !== null ||
                serverAcceptance !== null ||
                (activeCaseIndex === task.cases.length - 1 ? !completeDraft : !activeCaseComplete)
              }
              advanceLabel={
                serverAcceptance
                  ? "Review recorded"
                  : activeCaseIndex === task.cases.length - 1
                    ? "Submit review"
                    : "Next case"
              }
              busyLabel={busyAction === "response" ? "Submitting…" : null}
              caseIndex={activeCaseIndex}
              laneHeader={
                <>
                  <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                    Private assignment
                  </p>
                  <p className="mt-1 text-sm text-base-content/60">Short-lived, logged access</p>
                </>
              }
              onAdvance={advanceReview}
              onSelectFirst={() => activeCase && updateDraft(activeCase.caseId, { selectedOption: "A" })}
              onSelectSecond={() => activeCase && updateDraft(activeCase.caseId, { selectedOption: "B" })}
              rationaleRef={rationaleRef}
              totalCases={task.cases.length}
            >
              <Card className="rounded-2xl p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                      Blinded assignment
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">Choose A or B for every case</h2>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm rateloop-secondary-action text-xs"
                    onClick={() => {
                      setTask(null);
                      setDrafts({});
                      setActiveCaseIndex(0);
                      setServerAcceptance(null);
                    }}
                  >
                    Close private review
                  </button>
                </div>
                <div className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
                  <div className="border-l-2 border-[var(--rateloop-blue)] pl-3">
                    <span className="text-xs text-base-content/45">Assignment</span>
                    <strong className="mt-1 block break-all font-mono text-xs">{task.assignmentId}</strong>
                  </div>
                  <div className="border-l-2 border-[var(--rateloop-yellow)] pl-3">
                    <span className="text-xs text-base-content/45">Private asset access</span>
                    <strong className="mt-1 block text-xs">
                      {leaseDeadline ? formatDate(leaseDeadline) : "Unavailable"}
                    </strong>
                  </div>
                  <div className="border-l-2 border-[var(--rateloop-pink)] pl-3">
                    <span className="text-xs text-base-content/45">Compensation evidence</span>
                    <strong className="mt-1 block text-xs">No paid voucher attached</strong>
                  </div>
                </div>
                <div className="mt-5 border-t border-white/10 pt-5">
                  <p className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs leading-5 text-base-content/60">
                    Panels may include undisclosed calibration items. They use the same instructions and compensation as
                    every other assigned case.
                  </p>
                  <p className="mt-4 font-mono text-xs uppercase tracking-widest text-base-content/45">
                    Assignment qualification
                  </p>
                  <p className="mt-2 text-xs leading-5 text-base-content/50">
                    Source: {task.source.replaceAll("_", " ")}. Only evidence selected for this frozen policy is shown.
                  </p>
                  {task.qualificationProvenance.length ? (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {task.qualificationProvenance.map(value => (
                        <li key={value.key} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
                          <strong className="block text-base-content/75">{qualificationLabel(value.key)}</strong>
                          <span className="mt-1 block text-base-content/50">
                            {formatQualificationValue(value.value)} · {provenanceSourceLabel(value.source)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-base-content/45">No additional qualification claims were used.</p>
                  )}
                </div>
              </Card>

              {activeCase
                ? (() => {
                    const reviewCase = activeCase;
                    const draft = drafts[reviewCase.caseId] ?? {
                      selectedOption: null,
                      failureTags: [],
                      rationale: "",
                    };
                    const failureTags = reviewCase.failureTags?.length
                      ? reviewCase.failureTags
                      : task.rubric.failureTags;
                    return (
                      <Card as="article" key={reviewCase.caseId} className="rounded-2xl p-5 sm:p-7">
                        <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">
                          Case {String(activeCaseIndex + 1).padStart(2, "0")}
                        </p>
                        <h3 className="mt-2 text-2xl font-semibold">{reviewCase.title}</h3>
                        <p className="mt-3 text-sm leading-6 text-base-content/60">{reviewCase.instructions}</p>
                        {reviewCase.objectiveReference ? (
                          <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-base-content/55">
                            Objective reference: {reviewCase.objectiveReference}
                          </p>
                        ) : null}
                        <fieldset className="mt-6">
                          <legend className="text-sm font-semibold">{task.rubric.prompt}</legend>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {reviewCase.options.map(option => (
                              <label
                                key={option.key}
                                className={`rounded-lg border p-4 transition-colors ${
                                  draft.selectedOption === option.key
                                    ? "border-[var(--rateloop-green)] bg-emerald-300/10"
                                    : "border-white/10 bg-black/20 hover:border-white/25"
                                }`}
                              >
                                <span className="flex items-center justify-between gap-3">
                                  <span className="flex items-center gap-3 font-semibold">
                                    <input
                                      type="radio"
                                      name={`choice-${reviewCase.caseId}`}
                                      value={option.key}
                                      checked={draft.selectedOption === option.key}
                                      disabled={serverAcceptance !== null}
                                      onChange={() => updateDraft(reviewCase.caseId, { selectedOption: option.key })}
                                    />
                                    Candidate {option.key}
                                  </span>
                                  {serverAcceptance ? (
                                    <span className="text-xs text-base-content/40">Access closed</span>
                                  ) : (
                                    <a
                                      href={artifactUrl(task.assignmentId, option)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-xs font-semibold underline underline-offset-4"
                                    >
                                      Open private artifact
                                    </a>
                                  )}
                                </span>
                                <span className="mt-3 block break-all font-mono text-[11px] text-base-content/40">
                                  {option.artifactId}
                                </span>
                              </label>
                            ))}
                          </div>
                        </fieldset>

                        <fieldset className="mt-6 border-t border-white/10 pt-5">
                          <legend className="text-sm font-semibold">Failure tags</legend>
                          <p className="mt-1 text-xs leading-5 text-base-content/45">
                            Select every issue that materially affected your decision.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {failureTags.map(tag => (
                              <Chip
                                key={tag.key}
                                checked={draft.failureTags.includes(tag.key)}
                                disabled={serverAcceptance !== null}
                                onChange={() => toggleFailureTag(reviewCase.caseId, tag.key)}
                              >
                                {tag.label}
                              </Chip>
                            ))}
                          </div>
                        </fieldset>

                        <label className="mt-6 block text-sm font-semibold">
                          Decision rationale
                          <textarea
                            ref={rationaleRef}
                            className="textarea mt-2 min-h-32 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] text-sm leading-6"
                            value={draft.rationale}
                            onChange={event => updateDraft(reviewCase.caseId, { rationale: event.target.value })}
                            minLength={Math.max(10, task.rubric.rationale.minLength ?? 0)}
                            maxLength={Math.min(2_000, task.rubric.rationale.maxLength)}
                            disabled={serverAcceptance !== null}
                            placeholder="Identify the concrete difference that determined your choice."
                            required
                          />
                        </label>
                      </Card>
                    );
                  })()
                : null}

              {serverAcceptance ? (
                <Card className="rounded-2xl p-5 sm:p-7">
                  <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm leading-6 text-emerald-100">
                    {serverAcceptance.replay ? "The server confirmed" : "The server accepted"}{" "}
                    {serverAcceptance.responseCount} assigned response
                    {serverAcceptance.responseCount === 1 ? "" : "s"} and completed the assignment. This was an unpaid
                    invited review, so no settlement reference is expected.
                  </p>
                </Card>
              ) : null}
            </ReviewerShell>
          )}

          {error ? (
            <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {error}
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
