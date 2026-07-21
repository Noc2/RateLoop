"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DeadlineChip } from "~~/components/tokenless/review/DeadlineChip";
import { PrivateArtifactPreview } from "~~/components/tokenless/review/PrivateArtifactPreview";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Chip } from "~~/components/tokenless/ui/Chip";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "~~/lib/tokenless/reviewDrafts";

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
  binaryReview?: {
    positiveLabel: string;
    negativeLabel: string;
    source: ArtifactLease & { contentType: string | null };
    suggestion: ArtifactLease & { contentType: string | null };
  };
};

type AssignmentTaskBase = {
  assignmentId: string;
  runId: string;
  source: "customer_invited" | "rateloop_network";
  runManifestHash: string;
  policyHash: string;
  qualificationProvenance: QualificationProvenance[];
  rubric: {
    prompt: string;
    failureTags: Array<{ key: string; label: string; description?: string }>;
    rationale: { mode: "off" | "optional" | "required"; minLength?: number; maxLength: number };
  };
  cases: ReviewCase[];
};

export type AssignmentTask = AssignmentTaskBase &
  (
    | {
        taskKind?: "comparison";
        compensationMode?: never;
        forecastRequired?: never;
        settlement?: never;
      }
    | {
        taskKind: "binary_review";
        compensationMode: "unpaid";
        forecastRequired: false;
        settlement: null;
      }
  );

const DIRECT_PRIVATE_ASSIGNMENT_PATTERN = /^hpua_[0-9a-f]{40}$/u;

export function validateLoadedAssignmentTask(value: unknown): AssignmentTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The private assignment task is incomplete.");
  }
  const task = value as Record<string, unknown>;
  if (
    typeof task.assignmentId !== "string" ||
    typeof task.runId !== "string" ||
    (task.source !== "customer_invited" && task.source !== "rateloop_network") ||
    !Array.isArray(task.cases) ||
    !task.rubric ||
    typeof task.rubric !== "object" ||
    Array.isArray(task.rubric)
  ) {
    throw new Error("The private assignment task is incomplete.");
  }
  const isDirectPrivate =
    DIRECT_PRIVATE_ASSIGNMENT_PATTERN.test(task.assignmentId) || task.taskKind === "binary_review";
  if (isDirectPrivate) {
    if (
      task.taskKind !== "binary_review" ||
      task.compensationMode !== "unpaid" ||
      task.forecastRequired !== false ||
      task.settlement !== null
    ) {
      throw new Error("This private assignment has unsupported compensation or settlement capabilities.");
    }
  } else if (
    (task.taskKind !== undefined && task.taskKind !== "comparison") ||
    "compensationMode" in task ||
    "forecastRequired" in task ||
    "settlement" in task
  ) {
    throw new Error("This private assignment has ambiguous compensation or settlement capabilities.");
  }
  return task as AssignmentTask;
}

type ReviewDraft = {
  selectedOption: "A" | "B" | null;
  failureTags: string[];
  rationale: string;
};

type DirectAssignmentAccess = {
  assignmentId: string;
  state: "accepted" | "closed" | "ready" | "recoverable";
  termsAccepted: boolean;
  terms: DirectAssignmentTerms;
  responseDeadline: string;
};

type DirectAssignmentTerms = {
  groupName: string;
  purpose: string;
  policy: Record<string, unknown>;
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

function privateTermsSummary(terms: DirectAssignmentTerms) {
  const classifications = Array.isArray(terms.policy.dataClassifications)
    ? terms.policy.dataClassifications.filter((value): value is string => typeof value === "string")
    : [];
  const exportAllowed = terms.policy.exportAllowed === true;
  return (
    <section
      className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4 text-sm"
      aria-label="Confidentiality terms"
    >
      <p className="font-semibold">Confidentiality terms</p>
      <p className="mt-2 leading-6 text-base-content/65">{terms.purpose}</p>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-base-content/45">Private material</dt>
          <dd className="mt-1">{classifications.length ? classifications.join(", ") : "Assigned private content"}</dd>
        </div>
        <div>
          <dt className="text-base-content/45">Export</dt>
          <dd className="mt-1">{exportAllowed ? "Allowed by this policy" : "Not allowed"}</dd>
        </div>
      </dl>
      <details className="mt-3 text-xs text-base-content/60">
        <summary className="cursor-pointer font-semibold text-base-content/75">View exact policy</summary>
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-5">
          {JSON.stringify(terms.policy, null, 2)}
        </pre>
      </details>
    </section>
  );
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

function requiredRationaleLength(task: AssignmentTask) {
  return task.rubric.rationale.mode === "required" ? Math.max(10, task.rubric.rationale.minLength ?? 0) : 0;
}

function isPrivateDrafts(value: unknown): value is Record<string, ReviewDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    draft =>
      Boolean(draft && typeof draft === "object") &&
      [null, "A", "B"].includes((draft as ReviewDraft).selectedOption) &&
      Array.isArray((draft as ReviewDraft).failureTags) &&
      (draft as ReviewDraft).failureTags.every(tag => typeof tag === "string") &&
      typeof (draft as ReviewDraft).rationale === "string",
  );
}

export function HumanAssuranceRaterClient({
  principalId = null,
  initialAssignmentId = "",
  initialServerAcceptance = null,
  initialTask = null,
  initialTermsHash = "",
  presentation = "standalone",
  assignmentTitle = "Assigned private review",
  assignmentExpiresAt = null,
  onContinue,
}: {
  principalId?: string | null;
  initialAssignmentId?: string | string[];
  initialServerAcceptance?: AssuranceServerAcceptance | null;
  initialTask?: AssignmentTask | null;
  initialTermsHash?: string | string[];
  presentation?: "standalone" | "embedded";
  assignmentTitle?: string;
  assignmentExpiresAt?: string | null;
  onContinue?: () => void;
}) {
  const initialAssignment = firstValue(initialAssignmentId);
  const initialTerms = firstValue(initialTermsHash);
  const validatedInitialTask = initialTask === null ? null : validateLoadedAssignmentTask(initialTask);
  const hasInvitationCredentials =
    initialAssignment.trim().length >= 8 && /^sha256:[0-9a-f]{64}$/.test(initialTerms.trim());
  const [assignmentId, setAssignmentId] = useState(initialAssignment);
  const [termsHash, setTermsHash] = useState(initialTerms);
  const [manualCredentialEntry, setManualCredentialEntry] = useState(false);
  const [confidentialityAccepted, setConfidentialityAccepted] = useState(false);
  const [termsRequired, setTermsRequired] = useState<boolean | null>(() =>
    /^hpua_[0-9a-f]{40}$/u.test(initialAssignment.trim()) ? null : true,
  );
  const [assignmentTerms, setAssignmentTerms] = useState<DirectAssignmentTerms | null>(null);
  const [assignmentClosed, setAssignmentClosed] = useState(false);
  const [assignmentUnavailable, setAssignmentUnavailable] = useState(false);
  const [task, setTask] = useState<AssignmentTask | null>(validatedInitialTask);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() =>
    validatedInitialTask ? emptyDrafts(validatedInitialTask.cases) : {},
  );
  const [busyAction, setBusyAction] = useState<"assignment" | "recovery" | "response" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRecover, setCanRecover] = useState(false);
  const [serverAcceptance, setServerAcceptance] = useState<AssuranceServerAcceptance | null>(initialServerAcceptance);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [reviewingResponses, setReviewingResponses] = useState(false);
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null);
  const [activePrincipalId, setActivePrincipalId] = useState(principalId);
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const [autoOpenRequested, setAutoOpenRequested] = useState(false);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const activePrincipalRef = useRef(principalId);
  const taskRef = useRef(task);
  const privateStateEpochRef = useRef(0);
  const openAssignmentRef = useRef<(event?: FormEvent<HTMLFormElement>, afterRecovery?: boolean) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  useEffect(() => {
    let active = true;
    let sessionReadSequence = 0;
    const refreshPrincipal = async () => {
      const currentRead = ++sessionReadSequence;
      try {
        const session = await readBrowserSession();
        if (!active || currentRead !== sessionReadSequence) return;
        const previousPrincipalId = activePrincipalRef.current;
        const nextPrincipalId = session?.principalId ?? null;
        const principalChanged = previousPrincipalId !== null && previousPrincipalId !== nextPrincipalId;
        const privateStateMustClose = principalChanged || (nextPrincipalId === null && taskRef.current !== null);
        activePrincipalRef.current = nextPrincipalId;
        setActivePrincipalId(nextPrincipalId);
        setSessionCheckError(null);
        if (privateStateMustClose) {
          const loadedTask = taskRef.current;
          if (loadedTask && previousPrincipalId) {
            clearReviewDraft("private", loadedTask.assignmentId, { principalId: previousPrincipalId });
          }
          privateStateEpochRef.current += 1;
          taskRef.current = null;
          setTask(null);
          setDrafts({});
          setRestoredDraftKey(null);
          setActiveCaseIndex(0);
          setReviewingResponses(false);
          setServerAcceptance(null);
          setCanRecover(false);
          setAssignmentClosed(false);
          setAssignmentUnavailable(false);
          setTermsRequired(null);
          setAssignmentTerms(null);
          setBusyAction(null);
          setConfidentialityAccepted(false);
          setError(null);
          setSessionCheckError(
            nextPrincipalId === null
              ? "You signed out. Sign in and reopen this assignment."
              : "Your session changed. Reopen this assignment to continue.",
          );
        }
      } catch {
        if (active && currentRead === sessionReadSequence) {
          setSessionCheckError("Could not verify your session. Refocus this tab to retry.");
        }
      }
    };
    void refreshPrincipal();
    const unsubscribe = subscribeToBrowserAuthSessionChanges(refreshPrincipal);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const id = assignmentId.trim();
    const terms = termsHash.trim();
    if (task || !activePrincipalId || !/^hpua_[0-9a-f]{40}$/u.test(id) || !/^sha256:[0-9a-f]{64}$/u.test(terms)) {
      if (!/^hpua_[0-9a-f]{40}$/u.test(id)) setTermsRequired(true);
      return;
    }
    let active = true;
    setTermsRequired(null);
    void (async () => {
      try {
        const body = (await readJson(
          await fetch(
            `/api/account/assurance/assignments/${encodeURIComponent(id)}/accept?terms=${encodeURIComponent(terms)}`,
            { cache: "no-store", credentials: "same-origin" },
          ),
          PRIVATE_REVIEW_JSON_OPTIONS,
        )) as DirectAssignmentAccess;
        if (!active) return;
        if (
          body.assignmentId !== id ||
          !["accepted", "closed", "ready", "recoverable"].includes(body.state) ||
          typeof body.termsAccepted !== "boolean" ||
          !body.terms ||
          typeof body.terms.groupName !== "string" ||
          typeof body.terms.purpose !== "string" ||
          !body.terms.policy ||
          typeof body.terms.policy !== "object" ||
          Array.isArray(body.terms.policy)
        ) {
          throw new Error("The assignment access status was incomplete.");
        }
        setTermsRequired(!body.termsAccepted);
        setAssignmentTerms(body.terms);
        setConfidentialityAccepted(body.termsAccepted);
        setAssignmentClosed(body.state === "closed");
        setAssignmentUnavailable(false);
        setCanRecover(body.state === "recoverable");
        setError(null);
        if (
          presentation === "embedded" &&
          body.termsAccepted &&
          (body.state === "accepted" || body.state === "ready")
        ) {
          setAutoOpenRequested(true);
        }
      } catch (cause) {
        if (!active) return;
        setTermsRequired(true);
        setCanRecover(false);
        setError(cause instanceof Error ? cause.message : "Unable to check assignment access.");
      }
    })();
    return () => {
      active = false;
    };
  }, [activePrincipalId, assignmentId, presentation, task, termsHash]);

  const leaseDeadline = useMemo(() => {
    const values = task?.cases.flatMap(reviewCase => {
      const binaryArtifacts = reviewCase.binaryReview
        ? [reviewCase.binaryReview.source.expiresAt, reviewCase.binaryReview.suggestion.expiresAt]
        : [];
      return [
        ...reviewCase.options.map(option => option.expiresAt),
        ...reviewCase.context.map(context => context.expiresAt),
        ...binaryArtifacts,
      ];
    });
    if (!values?.length) return null;
    return values.sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
  }, [task]);
  const privateDraftStorage = useMemo(
    () => ({ principalId: activePrincipalId, expiresAt: leaseDeadline }),
    [activePrincipalId, leaseDeadline],
  );
  const privateDraftKey = activePrincipalId && task ? `${activePrincipalId}:${task.assignmentId}` : null;

  const completeDraft = Boolean(
    task?.cases.length &&
      task.cases.every(reviewCase => {
        const draft = drafts[reviewCase.caseId];
        const rationaleLength = draft?.rationale.trim().length ?? 0;
        const minimum = requiredRationaleLength(task);
        const maximum = Math.min(2_000, task.rubric.rationale.maxLength);
        return draft?.selectedOption && rationaleLength >= minimum && rationaleLength <= maximum;
      }),
  );
  const activeCase = task?.cases[activeCaseIndex] ?? null;
  const activeCaseComplete = Boolean(
    task &&
      activeCase &&
      drafts[activeCase.caseId]?.selectedOption &&
      (drafts[activeCase.caseId]?.rationale.trim().length ?? 0) >= requiredRationaleLength(task) &&
      (drafts[activeCase.caseId]?.rationale.trim().length ?? 0) <= Math.min(2_000, task.rubric.rationale.maxLength),
  );

  useEffect(() => {
    if (!task || serverAcceptance) return;
    const restored = loadReviewDraft("private", task.assignmentId, isPrivateDrafts, privateDraftStorage);
    const next = emptyDrafts(task.cases);
    if (restored) {
      for (const reviewCase of task.cases) {
        if (restored[reviewCase.caseId]) next[reviewCase.caseId] = restored[reviewCase.caseId];
      }
    }
    setDrafts(next);
    setRestoredDraftKey(privateDraftKey);
  }, [privateDraftKey, privateDraftStorage, serverAcceptance, task]);

  useEffect(() => {
    if (!task || serverAcceptance || !privateDraftKey || restoredDraftKey !== privateDraftKey) return;
    saveReviewDraft("private", task.assignmentId, drafts, privateDraftStorage);
  }, [drafts, privateDraftKey, privateDraftStorage, restoredDraftKey, serverAcceptance, task]);

  function applyLoadedTask(value: unknown) {
    const nextTask = validateLoadedAssignmentTask(value);
    const refreshingCurrentTask = taskRef.current?.assignmentId === nextTask.assignmentId;
    taskRef.current = nextTask;
    setTask(nextTask);
    if (!refreshingCurrentTask) {
      setDrafts(emptyDrafts(nextTask.cases));
      setActiveCaseIndex(0);
      setReviewingResponses(false);
      setServerAcceptance(null);
    }
    setCanRecover(false);
    setAssignmentClosed(false);
    setAssignmentUnavailable(false);
  }

  async function loadAssignment(id: string) {
    const privateStateEpoch = privateStateEpochRef.current;
    const body = await readJson(
      await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/task`, {
        cache: "no-store",
        credentials: "same-origin",
      }),
      PRIVATE_REVIEW_JSON_OPTIONS,
    );
    if (privateStateEpoch !== privateStateEpochRef.current) return;
    applyLoadedTask(body);
  }

  async function openAssignment(event?: FormEvent<HTMLFormElement>, afterRecovery = false) {
    event?.preventDefault();
    if ((!afterRecovery && canRecover) || assignmentClosed || assignmentUnavailable || termsRequired === null) return;
    const id = assignmentId.trim();
    const privateStateEpoch = privateStateEpochRef.current;
    setBusyAction("assignment");
    setError(null);
    setCanRecover(false);
    try {
      const opened = await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/accept?includeTask=1`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confidentialityTermsAccepted: termsRequired === true && confidentialityAccepted,
            confidentialityTermsHash: termsHash.trim(),
          }),
        }),
        PRIVATE_REVIEW_JSON_OPTIONS,
      );
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      if (opened.task && typeof opened.task === "object") applyLoadedTask(opened.task);
      else await loadAssignment(id);
    } catch (cause) {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      const recoverable = cause instanceof HttpJsonError && cause.code === "assignment_expired";
      const closed = cause instanceof HttpJsonError && cause.code === "assignment_closed";
      if (cause instanceof HttpJsonError && cause.code === "confidentiality_acceptance_required") {
        setTermsRequired(true);
        setConfidentialityAccepted(false);
      }
      if (recoverable) clearReviewDraft("private", id, privateDraftStorage);
      setCanRecover(recoverable);
      setAssignmentClosed(closed);
      setAssignmentUnavailable(false);
      setError(cause instanceof Error ? cause.message : "Unable to open this assignment.");
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
    }
  }

  openAssignmentRef.current = openAssignment;

  useEffect(() => {
    if (
      !autoOpenRequested ||
      task ||
      busyAction !== null ||
      termsRequired !== false ||
      assignmentClosed ||
      assignmentUnavailable
    ) {
      return;
    }
    setAutoOpenRequested(false);
    void openAssignmentRef.current();
  }, [assignmentClosed, assignmentUnavailable, autoOpenRequested, busyAction, task, termsRequired]);

  async function recoverAssignment() {
    const id = assignmentId.trim();
    const privateStateEpoch = privateStateEpochRef.current;
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
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setCanRecover(false);
      if (termsRequired && !confidentialityAccepted) return;
      await openAssignment(undefined, true);
    } catch (cause) {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setCanRecover(false);
      setAssignmentClosed(cause instanceof HttpJsonError && cause.code === "assignment_closed");
      setAssignmentUnavailable(!(cause instanceof HttpJsonError && cause.code === "assignment_closed"));
      setError(
        cause instanceof Error
          ? cause.message
          : "This assignment can no longer be recovered. Ask the customer for a new private assignment.",
      );
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
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
    const privateStateEpoch = privateStateEpochRef.current;
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
              const selectedArtifactId = reviewCase.binaryReview?.suggestion.artifactId ?? option?.artifactId;
              if (!selectedArtifactId || !draft.selectedOption) {
                throw new Error("A selected case option is unavailable.");
              }
              return {
                caseId: reviewCase.caseId,
                displayedOption: draft.selectedOption,
                selectedArtifactId,
                failureTagKeys: draft.failureTags,
                rationale: draft.rationale,
              };
            }),
          }),
        }),
        PRIVATE_REVIEW_JSON_OPTIONS,
      );
      if (privateStateEpoch !== privateStateEpochRef.current) return;
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
      clearReviewDraft("private", task.assignmentId, privateDraftStorage);
    } catch (cause) {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setError(cause instanceof Error ? cause.message : "The server did not accept this response batch.");
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
    }
  }

  function advanceReview() {
    if (!task || serverAcceptance) return;
    if (reviewingResponses) {
      void submitResponses();
      return;
    }
    if (!activeCase || !activeCaseComplete) return;
    if (activeCaseIndex < task.cases.length - 1) {
      setActiveCaseIndex(index => index + 1);
      return;
    }
    if (completeDraft) {
      if (task.cases.length === 1) void submitResponses();
      else setReviewingResponses(true);
    }
  }

  function returnToCase(index: number) {
    setReviewingResponses(false);
    setActiveCaseIndex(index);
  }

  return (
    <div className={presentation === "embedded" ? "w-full" : "mx-auto w-full max-w-4xl px-4 py-8 sm:py-10"}>
      {presentation === "standalone" ? (
        <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Private assignment</p>
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
            {task ? "Complete your assigned review" : "Open your assigned review"}
          </h1>
          <p className="mt-3 text-base text-base-content/60">
            {task
              ? task.taskKind === "binary_review"
                ? "Review the source and decide whether the agent output meets the criterion."
                : "Compare each blinded pair and explain your choice."
              : "Use the details from your invitation."}
          </p>
        </div>
      ) : null}

      <div className={presentation === "embedded" ? "" : "mt-8"}>
        <div className="space-y-6">
          {!task ? (
            presentation === "embedded" ? (
              <Card as="article" className="rounded-2xl p-5 sm:p-6">
                <form onSubmit={openAssignment}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
                        Private assignment
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">{assignmentTitle}</h2>
                    </div>
                    <span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-base-content/60">
                      Unpaid review
                    </span>
                  </div>
                  {assignmentExpiresAt ? (
                    <p className="mt-4 text-sm text-base-content/55">Complete by {formatDate(assignmentExpiresAt)}</p>
                  ) : null}
                  <p className="mt-4 text-sm leading-6 text-base-content/65">
                    Only this assigned review becomes visible. Access is account-bound, short-lived, and logged.
                  </p>
                  {assignmentTerms ? privateTermsSummary(assignmentTerms) : null}
                  {assignmentClosed || assignmentUnavailable ? (
                    <p role="status" className="mt-5 rounded-lg border border-white/10 p-4 text-sm">
                      {assignmentClosed ? "This review window has closed." : "This assignment is no longer available."}
                    </p>
                  ) : termsRequired === null ? (
                    <p
                      role="status"
                      className="mt-5 rounded-lg border border-white/10 p-4 text-sm text-base-content/60"
                    >
                      Checking access…
                    </p>
                  ) : termsRequired ? (
                    <label className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm leading-6 text-base-content/70">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm mt-1"
                        checked={confidentialityAccepted}
                        onChange={event => setConfidentialityAccepted(event.target.checked)}
                      />
                      <span>
                        I accept the current confidentiality terms and will not copy or share this private material.
                      </span>
                    </label>
                  ) : (
                    <p
                      role="status"
                      className="mt-5 rounded-lg border border-white/10 p-4 text-sm text-base-content/65"
                    >
                      {busyAction === "assignment" ? "Loading the review…" : "Private access is confirmed."}
                    </p>
                  )}
                  {!canRecover &&
                  !assignmentClosed &&
                  !assignmentUnavailable &&
                  (termsRequired !== false || error !== null) ? (
                    <Button
                      type="submit"
                      className="mt-5 w-full px-6"
                      disabled={
                        busyAction !== null ||
                        termsRequired === null ||
                        (termsRequired && !confidentialityAccepted) ||
                        assignmentId.trim().length < 8 ||
                        !/^sha256:[0-9a-f]{64}$/.test(termsHash.trim())
                      }
                    >
                      {busyAction === "assignment"
                        ? "Opening review…"
                        : termsRequired === false
                          ? "Open review"
                          : "Accept terms and begin"}
                    </Button>
                  ) : null}
                  {canRecover ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-5 w-full px-6"
                      disabled={busyAction !== null}
                      onClick={() => void recoverAssignment()}
                    >
                      {busyAction === "recovery" ? "Restoring access…" : "Restore review access"}
                    </Button>
                  ) : null}
                </form>
              </Card>
            ) : (
              <>
                <Card as="section" variant="marketing" className="p-5 sm:p-7">
                  <h2 className="text-xl font-semibold">Assignment details</h2>
                  <form className="mt-4 space-y-4" onSubmit={openAssignment}>
                    {hasInvitationCredentials && !manualCredentialEntry ? (
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-sm font-semibold">Invitation details loaded</p>
                        <p className="mt-1 text-xs text-base-content/55">This link identifies your assigned review.</p>
                        <button
                          type="button"
                          className="mt-3 text-xs font-medium underline underline-offset-4"
                          onClick={() => setManualCredentialEntry(true)}
                        >
                          Use different details
                        </button>
                      </div>
                    ) : manualCredentialEntry ? (
                      <div className="space-y-4">
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
                      </div>
                    ) : (
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                        <p className="text-sm font-semibold">Open your invitation link</p>
                        <p className="mt-1 text-xs text-base-content/55">
                          It includes the assignment and exact confidentiality terms.
                        </p>
                        <button
                          type="button"
                          className="mt-3 text-xs font-medium underline underline-offset-4"
                          onClick={() => setManualCredentialEntry(true)}
                        >
                          Enter details manually
                        </button>
                      </div>
                    )}
                    <section
                      className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-base-content/65"
                      aria-labelledby="private-review-access-title"
                    >
                      <h3 id="private-review-access-title" className="font-medium text-base-content/80">
                        Privacy and access
                      </h3>
                      <ul className="mt-3 space-y-2 text-xs leading-5">
                        <li>Only your assigned, blinded cases are returned.</li>
                        <li>Private artifact access is short-lived and logged.</li>
                        <li>Do not copy, share, or reuse assigned material, or put personal data in your rationale.</li>
                      </ul>
                    </section>
                    {assignmentTerms ? privateTermsSummary(assignmentTerms) : null}
                    {assignmentClosed || assignmentUnavailable ? (
                      <div role="status" className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
                        <p className="font-semibold">
                          {assignmentClosed ? "Review window closed" : "Assignment unavailable"}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-base-content/55">
                          {assignmentClosed
                            ? "This assignment can no longer accept a response."
                            : "This assignment could not be restored. Open Review work for another assignment."}
                        </p>
                        <Link
                          href="/human?scope=private"
                          className="mt-3 inline-flex text-xs font-semibold underline underline-offset-4"
                        >
                          Return to Review work
                        </Link>
                      </div>
                    ) : termsRequired === null ? (
                      <p role="status" className="rounded-lg border border-white/10 p-4 text-sm text-base-content/60">
                        Checking confidentiality terms…
                      </p>
                    ) : termsRequired ? (
                      <label className="flex items-start gap-3 rounded-lg border border-white/10 p-4 text-sm leading-6 text-base-content/70">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm mt-1"
                          checked={confidentialityAccepted}
                          onChange={event => setConfidentialityAccepted(event.target.checked)}
                        />
                        <span>
                          I accept this reviewer group&apos;s current confidentiality terms and will follow the privacy
                          rules above.
                        </span>
                      </label>
                    ) : (
                      <p role="status" className="rounded-lg border border-white/10 p-4 text-sm text-base-content/65">
                        Confidentiality terms already accepted for this reviewer group.
                      </p>
                    )}
                    {!canRecover && !assignmentClosed && !assignmentUnavailable ? (
                      <Button
                        type="submit"
                        className="w-full px-6"
                        disabled={
                          busyAction !== null ||
                          termsRequired === null ||
                          (termsRequired && !confidentialityAccepted) ||
                          assignmentId.trim().length < 8 ||
                          !/^sha256:[0-9a-f]{64}$/.test(termsHash.trim())
                        }
                      >
                        {busyAction === "assignment"
                          ? "Opening assignment…"
                          : termsRequired === false
                            ? "Open assignment"
                            : "Accept terms and open assignment"}
                      </Button>
                    ) : null}
                  </form>
                  {canRecover ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-4 min-h-12 w-full text-sm"
                      disabled={busyAction !== null}
                      onClick={() => void recoverAssignment()}
                    >
                      {busyAction === "recovery" ? "Restoring access…" : "Restore assignment access"}
                    </Button>
                  ) : null}
                </Card>
              </>
            )
          ) : (
            <ReviewerShell
              advanceDisabled={
                busyAction !== null ||
                serverAcceptance !== null ||
                (reviewingResponses
                  ? !completeDraft
                  : activeCaseIndex === task.cases.length - 1
                    ? !completeDraft
                    : !activeCaseComplete)
              }
              advanceLabel={
                serverAcceptance
                  ? "Review recorded"
                  : reviewingResponses
                    ? "Submit review"
                    : activeCaseIndex === task.cases.length - 1
                      ? task.cases.length === 1
                        ? "Submit review"
                        : "Review answers"
                      : "Next case"
              }
              backDisabled={busyAction !== null || serverAcceptance !== null}
              backLabel={reviewingResponses ? "Back to last case" : "Previous case"}
              busyLabel={busyAction === "response" ? "Submitting…" : null}
              caseIndex={activeCaseIndex}
              laneHeader={
                <>
                  <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                    Private · unpaid
                  </p>
                  <p className="mt-1 text-sm font-semibold">{assignmentTitle}</p>
                  <DeadlineChip deadline={leaseDeadline} label="Access" />
                </>
              }
              onAdvance={advanceReview}
              onBack={
                reviewingResponses
                  ? () => returnToCase(task.cases.length - 1)
                  : activeCaseIndex > 0
                    ? () => setActiveCaseIndex(index => index - 1)
                    : undefined
              }
              onSelectFirst={() => activeCase && updateDraft(activeCase.caseId, { selectedOption: "A" })}
              onSelectSecond={() => activeCase && updateDraft(activeCase.caseId, { selectedOption: "B" })}
              rationaleRef={rationaleRef}
              shortcutsEnabled={!reviewingResponses}
              totalCases={task.cases.length}
            >
              {serverAcceptance ? null : reviewingResponses ? (
                <Card as="section" className="rounded-2xl p-5 sm:p-7" aria-labelledby="private-review-summary">
                  <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                    Final check
                  </p>
                  <h2 id="private-review-summary" className="mt-2 text-2xl font-semibold">
                    Review every answer before submitting
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-base-content/60">
                    Submission closes this assignment. Open any case below to make a correction first.
                  </p>
                  <ol className="mt-5 space-y-3">
                    {task.cases.map((reviewCase, index) => {
                      const draft = drafts[reviewCase.caseId];
                      return (
                        <li
                          key={reviewCase.caseId}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-4"
                        >
                          <div>
                            <p className="text-sm font-semibold">
                              {index + 1}. {reviewCase.title}
                            </p>
                            <p className="mt-1 text-xs text-base-content/55">
                              {reviewCase.binaryReview
                                ? draft?.selectedOption === "A"
                                  ? reviewCase.binaryReview.positiveLabel
                                  : reviewCase.binaryReview.negativeLabel
                                : `Candidate ${draft?.selectedOption}`}
                              {(draft?.failureTags.length ?? 0) > 0
                                ? ` · ${draft!.failureTags.length} failure tag${draft!.failureTags.length === 1 ? "" : "s"}`
                                : ""}
                            </p>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={() => returnToCase(index)}>
                            Edit case {index + 1}
                          </Button>
                        </li>
                      );
                    })}
                  </ol>
                </Card>
              ) : activeCase ? (
                (() => {
                  const reviewCase = activeCase;
                  const draft = drafts[reviewCase.caseId] ?? {
                    selectedOption: null,
                    failureTags: [],
                    rationale: "",
                  };
                  const failureTags = reviewCase.failureTags?.length ? reviewCase.failureTags : task.rubric.failureTags;
                  return (
                    <Card as="article" key={reviewCase.caseId} className="rounded-2xl p-5 sm:p-7">
                      <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">
                        Case {String(activeCaseIndex + 1).padStart(2, "0")}
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold">{reviewCase.title}</h3>
                      {reviewCase.instructions.trim() &&
                      reviewCase.instructions.trim() !== task.rubric.prompt.trim() ? (
                        <p className="mt-3 text-sm leading-6 text-base-content/60">{reviewCase.instructions}</p>
                      ) : null}
                      {reviewCase.objectiveReference ? (
                        <p className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-base-content/55">
                          Objective reference: {reviewCase.objectiveReference}
                        </p>
                      ) : null}
                      {reviewCase.binaryReview ? (
                        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.25rem]">
                          <div className="space-y-3">
                            {(
                              [
                                ["Source", reviewCase.binaryReview.source],
                                ["Agent output", reviewCase.binaryReview.suggestion],
                              ] as const
                            ).map(([label, artifact]) => (
                              <PrivateArtifactPreview
                                key={label}
                                label={label}
                                artifactUrl={artifactUrl(task.assignmentId, artifact)}
                                onRefreshAccess={() => openAssignmentRef.current()}
                              />
                            ))}
                          </div>
                          <fieldset className="lg:sticky lg:top-4 lg:self-start">
                            <legend className="text-sm font-semibold">{task.rubric.prompt}</legend>
                            <div className="mt-3 grid gap-3">
                              {(
                                [
                                  ["A", reviewCase.binaryReview.positiveLabel],
                                  ["B", reviewCase.binaryReview.negativeLabel],
                                ] as const
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  htmlFor={`choice-${reviewCase.caseId}-${key}`}
                                  className={`rounded-lg border p-4 transition-colors ${
                                    draft.selectedOption === key
                                      ? "border-[var(--rateloop-green)] bg-emerald-300/10"
                                      : "border-white/10 bg-black/20 hover:border-white/25"
                                  }`}
                                >
                                  <span className="flex items-center gap-3 font-semibold">
                                    <input
                                      id={`choice-${reviewCase.caseId}-${key}`}
                                      aria-label={label}
                                      type="radio"
                                      name={`choice-${reviewCase.caseId}`}
                                      value={key}
                                      checked={draft.selectedOption === key}
                                      disabled={serverAcceptance !== null}
                                      onChange={() => updateDraft(reviewCase.caseId, { selectedOption: key })}
                                    />
                                    {label}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      ) : (
                        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.25rem]">
                          <div className="space-y-3">
                            {reviewCase.options.map(option => (
                              <PrivateArtifactPreview
                                key={option.key}
                                label={`Candidate ${option.key}`}
                                artifactUrl={artifactUrl(task.assignmentId, option)}
                                onRefreshAccess={() => openAssignmentRef.current()}
                              />
                            ))}
                          </div>
                          <fieldset className="lg:sticky lg:top-4 lg:self-start">
                            <legend className="text-sm font-semibold">{task.rubric.prompt}</legend>
                            <div className="mt-3 grid gap-3">
                              {reviewCase.options.map(option => (
                                <label
                                  key={option.key}
                                  htmlFor={`choice-${reviewCase.caseId}-${option.key}`}
                                  className={`rounded-lg border p-4 transition-colors ${
                                    draft.selectedOption === option.key
                                      ? "border-[var(--rateloop-green)] bg-emerald-300/10"
                                      : "border-white/10 bg-black/20 hover:border-white/25"
                                  }`}
                                >
                                  <input
                                    id={`choice-${reviewCase.caseId}-${option.key}`}
                                    aria-label={`Candidate ${option.key}`}
                                    type="radio"
                                    name={`choice-${reviewCase.caseId}`}
                                    value={option.key}
                                    checked={draft.selectedOption === option.key}
                                    disabled={serverAcceptance !== null}
                                    onChange={() => updateDraft(reviewCase.caseId, { selectedOption: option.key })}
                                  />
                                  <span className="ml-3 font-semibold">Candidate {option.key}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      )}

                      {failureTags.length > 0 ? (
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
                      ) : null}

                      {task.rubric.rationale.mode !== "off" ? (
                        <label className="mt-6 block text-sm font-semibold">
                          Decision rationale
                          <textarea
                            ref={rationaleRef}
                            className="textarea mt-2 min-h-32 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)] text-sm leading-6"
                            value={draft.rationale}
                            onChange={event => updateDraft(reviewCase.caseId, { rationale: event.target.value })}
                            minLength={requiredRationaleLength(task)}
                            maxLength={Math.min(2_000, task.rubric.rationale.maxLength)}
                            disabled={serverAcceptance !== null}
                            placeholder={
                              task.taskKind === "binary_review"
                                ? "Explain the concrete evidence behind your rating."
                                : "Identify the concrete difference that determined your choice."
                            }
                            required={task.rubric.rationale.mode === "required"}
                          />
                        </label>
                      ) : null}
                    </Card>
                  );
                })()
              ) : null}

              {serverAcceptance ? (
                <Card className="rounded-2xl p-5 sm:p-7">
                  <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm leading-6 text-emerald-100">
                    {serverAcceptance.replay ? "Review already recorded." : "Review submitted."} Private content is now
                    closed. This assignment was unpaid.
                  </p>
                  {onContinue ? (
                    <Button type="button" className="mt-4 w-full sm:w-auto" onClick={onContinue}>
                      Review next assignment
                    </Button>
                  ) : null}
                </Card>
              ) : null}
            </ReviewerShell>
          )}

          {error ? (
            <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {error}
            </p>
          ) : null}
          {sessionCheckError ? (
            <p role="alert" className="rounded-lg bg-red-400/10 p-4 text-sm leading-6 text-red-100">
              {sessionCheckError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
