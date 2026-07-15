"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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

type EligibilityState = {
  status: "not_started" | "eligible" | "review" | "blocked" | "expired";
  capabilities?: string[];
  blockedReason?: string | null;
  evidenceExpiresAt?: string;
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

class AssuranceRequestError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new AssuranceRequestError(
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : "The private review request failed.",
      typeof body.code === "string" ? body.code : null,
      response.status,
    );
  }
  return body;
}

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
  const [eligibility, setEligibility] = useState<EligibilityState | null>(null);
  const [task, setTask] = useState<AssignmentTask | null>(initialTask);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() =>
    initialTask ? emptyDrafts(initialTask.cases) : {},
  );
  const [busyAction, setBusyAction] = useState<"assignment" | "recovery" | "response" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const [serverAcceptance, setServerAcceptance] = useState<AssuranceServerAcceptance | null>(initialServerAcceptance);

  useEffect(() => {
    let active = true;
    void fetch("/api/rater/eligibility", { cache: "no-store", credentials: "same-origin" })
      .then(readJson)
      .then(body => {
        if (active) setEligibility(body as EligibilityState);
      })
      .catch(() => {
        if (active) setEligibility({ status: "not_started" });
      });
    return () => {
      active = false;
    };
  }, []);

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

  async function loadAssignment(id: string) {
    const body = await readJson(
      await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/task`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    const nextTask = body as AssignmentTask;
    setTask(nextTask);
    setDrafts(emptyDrafts(nextTask.cases));
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
      );
      await loadAssignment(id);
    } catch (cause) {
      const recoverable =
        cause instanceof AssuranceRequestError &&
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Private review queue</p>
        <h1 className="display-section mt-3 text-4xl sm:text-5xl">Compare work. Explain the difference.</h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-base-content/60">
          RateLoop shows only assignments selected for your signed-in account. Candidate order is blinded;
          qualification, confidentiality, and access leases are checked before any private artifact is shown.
        </p>
      </div>

      <div className="mt-9 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="space-y-6">
          {!task ? (
            <>
              <section className="rateloop-surface-card p-5 sm:p-7">
                <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">
                  01 · Open an assigned review
                </p>
                <h2 className="mt-2 text-2xl font-semibold">Confirm the private assignment</h2>
                <p className="mt-4 text-sm leading-6 text-base-content/60">
                  The customer supplies the assignment ID and exact confidentiality-terms hash. RateLoop will not
                  substitute another assignment, policy, or reviewer.
                </p>
                <form className="mt-5 space-y-4" onSubmit={openAssignment}>
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
                  <button
                    type="submit"
                    className="rateloop-gradient-action w-full px-6"
                    disabled={
                      busyAction !== null ||
                      !confidentialityAccepted ||
                      assignmentId.trim().length < 8 ||
                      !/^sha256:[0-9a-f]{64}$/.test(termsHash.trim())
                    }
                  >
                    {busyAction === "assignment" ? "Checking assignment…" : "Accept terms and open assignment"}
                  </button>
                </form>
                {canRecover ? (
                  <button
                    type="button"
                    className="mt-4 w-full rounded-lg border border-white/15 px-5 py-3 text-sm font-semibold hover:bg-white/[0.04]"
                    disabled={busyAction !== null}
                    onClick={() => void recoverAssignment()}
                  >
                    {busyAction === "recovery" ? "Restoring access…" : "Retry expired assignment access"}
                  </button>
                ) : null}
                <p className="mt-4 text-xs leading-5 text-base-content/45">
                  No assignment waiting? The customer controls its named roster and capacity. Redeeming an invitation
                  qualifies your account; it does not guarantee work.
                </p>
              </section>
            </>
          ) : (
            <section className="space-y-6">
              <div className="rateloop-surface-card p-5 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                      Blinded assignment
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">Choose A or B for every case</h2>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-white/10 px-3 py-2 text-xs text-base-content/60 hover:bg-white/[0.04]"
                    onClick={() => {
                      setTask(null);
                      setDrafts({});
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
                  <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">
                    Assignment qualification
                  </p>
                  <p className="mt-2 text-xs leading-5 text-base-content/50">
                    Source: {task.source.replaceAll("_", " ")}. Only evidence selected for this frozen policy is shown.
                  </p>
                  {task.qualificationProvenance.length ? (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {task.qualificationProvenance.map(value => (
                        <li key={value.key} className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
                          <strong className="block text-base-content/75">{value.key.replaceAll("_", " ")}</strong>
                          <span className="mt-1 block text-base-content/50">
                            {formatQualificationValue(value.value)} · {value.source}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-base-content/45">No additional qualification claims were used.</p>
                  )}
                </div>
              </div>

              {task.cases.map((reviewCase, caseIndex) => {
                const draft = drafts[reviewCase.caseId] ?? {
                  selectedOption: null,
                  failureTags: [],
                  rationale: "",
                };
                const failureTags = reviewCase.failureTags?.length ? reviewCase.failureTags : task.rubric.failureTags;
                return (
                  <article key={reviewCase.caseId} className="rateloop-surface-card p-5 sm:p-7">
                    <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">
                      Case {String(caseIndex + 1).padStart(2, "0")}
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
                          <label
                            key={tag.key}
                            className={`rounded-full border px-3 py-2 text-xs transition-colors ${
                              draft.failureTags.includes(tag.key)
                                ? "border-[var(--rateloop-pink)] bg-pink-300/10 text-pink-100"
                                : "border-white/10 text-base-content/55 hover:border-white/25"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={draft.failureTags.includes(tag.key)}
                              disabled={serverAcceptance !== null}
                              onChange={() => toggleFailureTag(reviewCase.caseId, tag.key)}
                            />
                            {tag.label}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <label className="mt-6 block text-sm font-semibold">
                      Decision rationale
                      <textarea
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
                  </article>
                );
              })}

              <div className="rateloop-surface-card p-5 sm:p-7">
                <button
                  type="button"
                  className="rateloop-gradient-action w-full px-6"
                  disabled={!completeDraft || busyAction !== null || serverAcceptance !== null}
                  onClick={() => void submitResponses()}
                >
                  {busyAction === "response"
                    ? "Submitting assigned review…"
                    : serverAcceptance
                      ? "Response batch accepted"
                      : "Submit assigned review"}
                </button>
                {serverAcceptance ? (
                  <p role="status" className="mt-4 rounded-lg bg-emerald-300/10 p-3 text-sm leading-6 text-emerald-100">
                    {serverAcceptance.replay ? "The server confirmed" : "The server accepted"}{" "}
                    {serverAcceptance.responseCount} assigned response
                    {serverAcceptance.responseCount === 1 ? "" : "s"} and completed the assignment. This was an unpaid
                    invited review, so no settlement reference is expected.
                  </p>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-base-content/45">
                    Choose A or B and satisfy the frozen rationale length for every case (within the 10-2000 character
                    safety limit). The assignment completes only if the server persists the entire batch.
                  </p>
                )}
              </div>
            </section>
          )}

          {error ? (
            <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {error}
            </p>
          ) : null}
        </main>

        <aside className="rateloop-surface-card sticky top-24 h-fit p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Capability status</p>
          <h2 className="mt-2 text-xl font-semibold">
            {eligibility?.status === "eligible" ? "Capability evidence current" : "Private reviews first"}
          </h2>
          <p className="mt-3 text-sm leading-6 text-base-content/60">
            Customer invitations can qualify you for private unpaid work. Paid human-assurance assignments remain
            unavailable until their frozen policy snapshot is bound through settlement and receipts.
          </p>
          {eligibility?.capabilities?.length ? (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Current eligibility capabilities">
              {eligibility.capabilities.map(capability => (
                <li key={capability} className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[11px]">
                  {capability.replaceAll("_", " ")}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg bg-white/[0.04] p-3 text-xs leading-5 text-base-content/50">
              No capability evidence is shown for this session. This does not block a customer-invited unpaid review.
            </p>
          )}
          <Link href="/human?tab=profile&section=paid-work" className="rateloop-gradient-action mt-5 w-full px-5">
            Review eligibility
          </Link>

          <div className="mt-6 border-t border-white/10 pt-5">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-yellow)]">
              Privacy & access
            </p>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-base-content/55">
              <li>Only your assigned, blinded cases are returned.</li>
              <li>Artifact leases are short-lived and access is logged.</li>
              <li>Do not enter personal data in the rationale.</li>
              <li>The A/B mapping is not disclosed in the review interface.</li>
            </ul>
          </div>

          <div className="mt-6 border-t border-white/10 pt-5 text-xs leading-5 text-base-content/50">
            <strong className="text-base-content/70">Receipts and appeals</strong>
            <p className="mt-2">
              Server acceptance acknowledges the response batch. Payment receipts and payment-related appeal references
              appear only after settlement, when applicable.
            </p>
            <p className="mt-2 font-mono">RateLoop review environment</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
