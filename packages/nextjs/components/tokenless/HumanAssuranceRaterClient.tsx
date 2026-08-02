"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChoiceInput, Field, TextareaField } from "~~/components/tokenless/forms/Field";
import { CrowdForecastField } from "~~/components/tokenless/review/CrowdForecastField";
import { DeadlineChip } from "~~/components/tokenless/review/DeadlineChip";
import { PrivateArtifactPreview } from "~~/components/tokenless/review/PrivateArtifactPreview";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Chip } from "~~/components/tokenless/ui/Chip";
import { PageHeading } from "~~/components/tokenless/ui/PageHeading";
import { Link } from "~~/i18n/navigation";
import { readBrowserSession, subscribeToBrowserAuthSessionChanges } from "~~/lib/auth/client";
import { HttpJsonError, readJson } from "~~/lib/tokenless/http";
import { directPrivateReviewForecastRequired } from "~~/lib/tokenless/reviewCapabilities";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "~~/lib/tokenless/reviewDrafts";
import { loadReviewReceipt, saveReviewReceipt } from "~~/lib/tokenless/reviewReceipts";

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
  dsaReferencePanel?: {
    artifactId: string;
    contentHash: string;
    contentType: string;
    language: string;
    mappingCommitment: string;
    choices: readonly ["policy_matches", "policy_does_not_match"];
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
        forecastRequired: boolean;
        settlement: null;
      }
    | {
        taskKind: "dsa_reference_panel";
        compensationMode?: never;
        forecastRequired?: never;
        settlement?: never;
      }
  );

const DIRECT_PRIVATE_ASSIGNMENT_PATTERN = /^hpua_[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DSA_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const DSA_BLINDED_CASE_ID_PATTERN = /^dsa_case_[a-z0-9]{16,80}$/u;
const DSA_CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const DSA_LANGUAGE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateDsaReferencePanelTask(task: Record<string, unknown>): AssignmentTask {
  const reviewCase = task.case;
  const responseContract = task.responseContract;
  if (!isRecord(reviewCase) || !isRecord(responseContract)) {
    throw new Error("The DSA reference-panel task is incomplete.");
  }
  const content = reviewCase.content;
  const policy = reviewCase.policy;
  const reference = reviewCase.reference;
  const rationale = responseContract.rationale;
  if (
    typeof task.assignmentId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(task.assignmentId) ||
    reviewCase.schemaVersion !== "rateloop.dsa-blinded-case.v1" ||
    typeof reviewCase.blindedCaseId !== "string" ||
    !DSA_BLINDED_CASE_ID_PATTERN.test(reviewCase.blindedCaseId) ||
    !isRecord(content) ||
    typeof content.artifactId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(content.artifactId) ||
    !Number.isSafeInteger(content.artifactVersion) ||
    Number(content.artifactVersion) <= 0 ||
    typeof content.contentHash !== "string" ||
    !SHA256_PATTERN.test(content.contentHash) ||
    typeof content.contentType !== "string" ||
    !DSA_CONTENT_TYPE_PATTERN.test(content.contentType) ||
    typeof content.language !== "string" ||
    !DSA_LANGUAGE_PATTERN.test(content.language) ||
    !isRecord(policy) ||
    typeof policy.categoryCode !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(policy.categoryCode) ||
    typeof policy.policyHash !== "string" ||
    !SHA256_PATTERN.test(policy.policyHash) ||
    !Number.isSafeInteger(policy.policyVersion) ||
    Number(policy.policyVersion) <= 0 ||
    typeof policy.question !== "string" ||
    !policy.question.trim() ||
    policy.question.length > 2_000 ||
    !isRecord(reference) ||
    typeof reference.populationId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(reference.populationId) ||
    !Number.isSafeInteger(reference.populationVersion) ||
    Number(reference.populationVersion) <= 0 ||
    typeof reference.frameId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(reference.frameId) ||
    !Number.isSafeInteger(reference.frameVersion) ||
    Number(reference.frameVersion) <= 0 ||
    typeof reference.sampleId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(reference.sampleId) ||
    !Number.isSafeInteger(reference.sampleVersion) ||
    Number(reference.sampleVersion) <= 0 ||
    !Number.isSafeInteger(reference.position) ||
    Number(reference.position) < 0 ||
    typeof reviewCase.mappingCommitment !== "string" ||
    !SHA256_PATTERN.test(reviewCase.mappingCommitment) ||
    responseContract.schemaVersion !== "rateloop.dsa-named-panel-response.v1" ||
    typeof responseContract.caseId !== "string" ||
    !DSA_IDENTIFIER_PATTERN.test(responseContract.caseId) ||
    !Array.isArray(responseContract.choices) ||
    responseContract.choices.length !== 2 ||
    responseContract.choices[0] !== "policy_matches" ||
    responseContract.choices[1] !== "policy_does_not_match" ||
    !isRecord(rationale) ||
    rationale.required !== true ||
    !Number.isSafeInteger(rationale.maximumLength) ||
    Number(rationale.maximumLength) <= 0 ||
    Number(rationale.maximumLength) > 2_000
  ) {
    throw new Error("The DSA reference-panel task is incomplete.");
  }
  return {
    assignmentId: task.assignmentId,
    runId: reviewCase.blindedCaseId,
    source: "customer_invited",
    runManifestHash: reviewCase.mappingCommitment,
    policyHash: policy.policyHash,
    qualificationProvenance: [],
    rubric: {
      prompt: policy.question,
      failureTags: [],
      rationale: { mode: "required", minLength: 1, maxLength: Number(rationale.maximumLength) },
    },
    cases: [
      {
        caseId: responseContract.caseId,
        position: 0,
        title: "",
        instructions: "",
        options: [],
        context: [],
        objectiveReference: null,
        dsaReferencePanel: {
          artifactId: content.artifactId,
          contentHash: content.contentHash,
          contentType: content.contentType,
          language: content.language,
          mappingCommitment: reviewCase.mappingCommitment,
          choices: ["policy_matches", "policy_does_not_match"],
        },
      },
    ],
    taskKind: "dsa_reference_panel",
  };
}

export function validateLoadedAssignmentTask(value: unknown): AssignmentTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The private assignment task is incomplete.");
  }
  const task = value as Record<string, unknown>;
  if ("case" in task || "responseContract" in task) return validateDsaReferencePanelTask(task);
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
      task.forecastRequired !== directPrivateReviewForecastRequired("unpaid") ||
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
  predictionPercent: number | null;
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
  terminalKind?: "content_self_identification_gap";
  reportId?: string;
  reportHash?: `sha256:${string}`;
} & (
  | { compensation: "unpaid"; settlementStatus: "not_applicable" }
  | { compensation: "paid"; settlementStatus: "pending" }
);

function isAssuranceServerAcceptance(value: unknown): value is AssuranceServerAcceptance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const acceptance = value as Record<string, unknown>;
  const isContentSelfIdentificationGap = acceptance.terminalKind === "content_self_identification_gap";
  return (
    acceptance.accepted === true &&
    typeof acceptance.replay === "boolean" &&
    Number.isSafeInteger(acceptance.responseCount) &&
    (acceptance.terminalKind === undefined ||
      (isContentSelfIdentificationGap &&
        acceptance.responseCount === 0 &&
        acceptance.compensation === "unpaid" &&
        acceptance.settlementStatus === "not_applicable" &&
        typeof acceptance.reportId === "string" &&
        /^dsapa_selfid_[0-9a-f]{40}$/u.test(acceptance.reportId) &&
        typeof acceptance.reportHash === "string" &&
        SHA256_PATTERN.test(acceptance.reportHash))) &&
    ((acceptance.compensation === "unpaid" && acceptance.settlementStatus === "not_applicable") ||
      (acceptance.compensation === "paid" && acceptance.settlementStatus === "pending"))
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export function reviewerAssignmentHref(currentHref: string, assignmentId: string, termsHash: string) {
  const current = new URL(currentHref, "https://rateloop.local");
  const id = assignmentId.trim();
  const terms = termsHash.trim();
  if (
    current.pathname !== "/human/review" ||
    id.length < 8 ||
    id.length > 256 ||
    !/^sha256:[0-9a-f]{64}$/u.test(terms)
  ) {
    return null;
  }
  current.searchParams.set("assignment", id);
  current.searchParams.set("terms", terms);
  return `${current.pathname}${current.search}${current.hash}`;
}

function persistReviewerAssignment(assignmentId: string, termsHash: string) {
  if (typeof window === "undefined") return;
  const href = reviewerAssignmentHref(window.location.href, assignmentId, termsHash);
  if (href) window.history.replaceState(window.history.state, "", href);
}

export const PRIVATE_UNPAID_REVIEW_PRIVACY_CONTEXT = "private_unpaid" as const;

type TermsTranslator = (
  key:
    | "assignedContent"
    | "confidentiality"
    | "export"
    | "exportAllowed"
    | "exportDenied"
    | "privateMaterial"
    | "viewPolicy",
) => string;

function privateTermsSummary(terms: DirectAssignmentTerms, t: TermsTranslator) {
  const classifications = Array.isArray(terms.policy.dataClassifications)
    ? terms.policy.dataClassifications.filter((value): value is string => typeof value === "string")
    : [];
  const exportAllowed = terms.policy.exportAllowed === true;
  return (
    <section
      className="mt-5 rounded-lg border border-base-content/10 bg-base-content/[0.03] p-4 text-sm"
      aria-label={t("confidentiality")}
    >
      <p className="font-semibold">{t("confidentiality")}</p>
      <p className="mt-2 leading-6 text-base-content/65">{terms.purpose}</p>
      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-base-content/55">{t("privateMaterial")}</dt>
          <dd className="mt-1">{classifications.length ? classifications.join(", ") : t("assignedContent")}</dd>
        </div>
        <div>
          <dt className="text-base-content/55">{t("export")}</dt>
          <dd className="mt-1">{exportAllowed ? t("exportAllowed") : t("exportDenied")}</dd>
        </div>
      </dl>
      <details className="mt-3 text-xs text-base-content/60">
        <summary className="cursor-pointer font-semibold text-base-content/75">{t("viewPolicy")}</summary>
        <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-base-content/[0.04] p-3 font-mono text-[11px] leading-5">
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

function dsaArtifactUrl(assignmentId: string, artifactId: string) {
  return `/api/account/assurance/assignments/${encodeURIComponent(assignmentId)}/artifacts/${encodeURIComponent(
    artifactId,
  )}`;
}

function emptyDrafts(cases: ReviewCase[]) {
  return Object.fromEntries(
    cases.map(reviewCase => [
      reviewCase.caseId,
      { selectedOption: null, predictionPercent: null, failureTags: [], rationale: "" },
    ]),
  ) as Record<string, ReviewDraft>;
}

function requiredRationaleLength(task: AssignmentTask) {
  if (task.taskKind === "dsa_reference_panel") return 1;
  return task.rubric.rationale.mode === "required" ? Math.max(10, task.rubric.rationale.minLength ?? 0) : 0;
}

function caseCompletionIssue(task: AssignmentTask, draft: ReviewDraft | undefined, dsaArtifactReady = true) {
  if (task.taskKind === "dsa_reference_panel" && !dsaArtifactReady) {
    return "Wait for the content under review to load before submitting.";
  }
  if (!draft?.selectedOption)
    return task.taskKind === "binary_review"
      ? "Choose Approve or Reject."
      : task.taskKind === "dsa_reference_panel"
        ? "Choose whether the content matches the policy."
        : "Choose an answer.";
  if (
    task.taskKind === "binary_review" &&
    task.forecastRequired &&
    (!Number.isSafeInteger(draft.predictionPercent) ||
      draft.predictionPercent === null ||
      draft.predictionPercent < 1 ||
      draft.predictionPercent > 99)
  ) {
    return "Enter a crowd forecast from 1% to 99%.";
  }
  const rationaleLength = draft.rationale.trim().length;
  const minimum = requiredRationaleLength(task);
  const maximum = Math.min(2_000, task.rubric.rationale.maxLength);
  if (rationaleLength < minimum) return `Add at least ${minimum} characters of decision rationale.`;
  if (rationaleLength > maximum) return `Shorten the decision rationale to ${maximum} characters.`;
  return null;
}

function localizedCaseCompletionIssue(
  issue: string | null,
  translate: (key: string, values?: Record<string, number>) => string,
) {
  if (!issue) return null;
  if (issue === "Wait for the content under review to load before submitting.") return translate("dsaArtifactRequired");
  if (issue === "Choose Approve or Reject.") return translate("chooseBinary");
  if (issue === "Choose whether the content matches the policy.") return translate("chooseDsaPolicy");
  if (issue === "Choose an answer.") return translate("chooseAnswer");
  if (issue === "Enter a crowd forecast from 1% to 99%.") return translate("forecastRange");

  const minimum = issue.match(/^Add at least (\d+) characters of decision rationale\.$/u)?.[1];
  if (minimum) return translate("rationaleMinimum", { count: Number(minimum) });
  const maximum = issue.match(/^Shorten the decision rationale to (\d+) characters\.$/u)?.[1];
  if (maximum) return translate("rationaleMaximum", { count: Number(maximum) });
  return translate("completeBeforeContinue");
}

function isPrivatePredictionPercent(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 99);
}

function isPrivateDrafts(value: unknown): value is Record<string, ReviewDraft> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    draft =>
      Boolean(draft && typeof draft === "object") &&
      [null, "A", "B"].includes((draft as ReviewDraft).selectedOption) &&
      isPrivatePredictionPercent((draft as ReviewDraft).predictionPercent) &&
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
  assignmentTitle,
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
  const t = useTranslations("review.assignment");
  const format = useFormatter();
  const resolvedAssignmentTitle = assignmentTitle ?? t("assignedTitle");
  const privateReviewJsonOptions = useMemo(() => ({ fallbackMessage: t("requestFailed") }), [t]);
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
  const [draftExpiresAt, setDraftExpiresAt] = useState<string | null>(assignmentExpiresAt);
  const [activeCaseIndex, setActiveCaseIndex] = useState(0);
  const [reviewingResponses, setReviewingResponses] = useState(false);
  const [restoredDraftKey, setRestoredDraftKey] = useState<string | null>(null);
  const [activePrincipalId, setActivePrincipalId] = useState(principalId);
  const [sessionCheckError, setSessionCheckError] = useState<string | null>(null);
  const [autoOpenRequested, setAutoOpenRequested] = useState(false);
  const [pendingDsaAcceptance, setPendingDsaAcceptance] = useState(false);
  const [dsaConflictConfirmed, setDsaConflictConfirmed] = useState(
    validatedInitialTask?.taskKind === "dsa_reference_panel",
  );
  const [dsaLeaseExpiresAt, setDsaLeaseExpiresAt] = useState<string | null>(null);
  const [dsaArtifactReady, setDsaArtifactReady] = useState(false);
  const [dsaSelfIdentificationConfirming, setDsaSelfIdentificationConfirming] = useState(false);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const activePrincipalRef = useRef(principalId);
  const taskRef = useRef(task);
  const privateStateEpochRef = useRef(0);
  const openAssignmentRef = useRef<(event?: FormEvent<HTMLFormElement>, afterRecovery?: boolean) => Promise<void>>(
    async () => {},
  );

  useEffect(() => {
    if (!task || !activePrincipalId || serverAcceptance) return;
    const receipt = loadReviewReceipt(
      "private",
      task.assignmentId,
      (value): value is AssuranceServerAcceptance =>
        isAssuranceServerAcceptance(value) &&
        (task.taskKind === "dsa_reference_panel" || value.compensation === "unpaid"),
      { principalId: activePrincipalId },
    );
    if (receipt) setServerAcceptance(receipt);
  }, [activePrincipalId, serverAcceptance, task]);

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
          setDraftExpiresAt(null);
          setCanRecover(false);
          setAssignmentClosed(false);
          setAssignmentUnavailable(false);
          setTermsRequired(null);
          setAssignmentTerms(null);
          setPendingDsaAcceptance(false);
          setDsaConflictConfirmed(false);
          setDsaLeaseExpiresAt(null);
          setDsaArtifactReady(false);
          setDsaSelfIdentificationConfirming(false);
          setBusyAction(null);
          setConfidentialityAccepted(false);
          setError(null);
          setSessionCheckError(nextPrincipalId === null ? t("signedOut") : t("sessionChanged"));
        }
      } catch {
        if (active && currentRead === sessionReadSequence) {
          setSessionCheckError(t("sessionFailed"));
        }
      }
    };
    void refreshPrincipal();
    const unsubscribe = subscribeToBrowserAuthSessionChanges(refreshPrincipal);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [t]);

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
          privateReviewJsonOptions,
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
        setDraftExpiresAt(body.responseDeadline);
        setError(null);
        if (
          presentation === "embedded" &&
          body.termsAccepted &&
          (body.state === "accepted" || body.state === "ready")
        ) {
          setAutoOpenRequested(true);
        }
      } catch {
        if (!active) return;
        setTermsRequired(true);
        setCanRecover(false);
        setError(t("accessFailed"));
      }
    })();
    return () => {
      active = false;
    };
  }, [activePrincipalId, assignmentId, presentation, privateReviewJsonOptions, t, task, termsHash]);

  const leaseDeadline = useMemo(() => {
    if (task?.taskKind === "dsa_reference_panel") return dsaLeaseExpiresAt;
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
  }, [dsaLeaseExpiresAt, task]);
  const privateDraftStorage = useMemo(
    () => ({ principalId: activePrincipalId, expiresAt: draftExpiresAt }),
    [activePrincipalId, draftExpiresAt],
  );
  const privateDraftKey = activePrincipalId && task ? `${activePrincipalId}:${task.assignmentId}` : null;

  const completeDraft = Boolean(
    task?.cases.length &&
      task.cases.every(reviewCase => caseCompletionIssue(task, drafts[reviewCase.caseId], dsaArtifactReady) === null),
  );
  const activeCase = task?.cases[activeCaseIndex] ?? null;
  const activeCaseIssue =
    task && activeCase ? caseCompletionIssue(task, drafts[activeCase.caseId], dsaArtifactReady) : t("unavailable");
  const activeCaseComplete = activeCaseIssue === null;

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
    setPendingDsaAcceptance(false);
    setDsaConflictConfirmed(nextTask.taskKind === "dsa_reference_panel");
    setDsaArtifactReady(false);
    setDsaSelfIdentificationConfirming(false);
    if (nextTask.taskKind !== "dsa_reference_panel") setDsaLeaseExpiresAt(null);
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
      privateReviewJsonOptions,
    );
    if (privateStateEpoch !== privateStateEpochRef.current) return;
    applyLoadedTask(body);
  }

  async function acceptDsaReferencePanel(id: string, privateStateEpoch: number) {
    const accepted = await readJson(
      await fetch(`/api/account/assurance/assignments/${encodeURIComponent(id)}/dsa-reference-panel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conflictDeclaration: { hasConflict: false, relationships: [] } }),
      }),
      privateReviewJsonOptions,
    );
    if (privateStateEpoch !== privateStateEpochRef.current) return;
    if (
      typeof accepted.assignmentId !== "string" ||
      accepted.assignmentId !== id ||
      typeof accepted.leaseExpiresAt !== "string" ||
      !Number.isFinite(Date.parse(accepted.leaseExpiresAt))
    ) {
      throw new Error("The DSA reference-panel acceptance was incomplete.");
    }
    setDsaLeaseExpiresAt(accepted.leaseExpiresAt);
    setDsaConflictConfirmed(true);
    setPendingDsaAcceptance(false);
    await loadAssignment(id);
  }

  async function confirmDsaReferencePanel() {
    if (!pendingDsaAcceptance || !dsaConflictConfirmed) return;
    const id = assignmentId.trim();
    const privateStateEpoch = privateStateEpochRef.current;
    setBusyAction("assignment");
    setError(null);
    try {
      await acceptDsaReferencePanel(id, privateStateEpoch);
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      persistReviewerAssignment(id, termsHash.trim());
    } catch {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setError(t("dsaAcceptFailed"));
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
    }
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
        privateReviewJsonOptions,
      );
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      if (
        opened.acceptance &&
        typeof opened.acceptance === "object" &&
        typeof (opened.acceptance as Record<string, unknown>).assignmentExpiresAt === "string"
      ) {
        setDraftExpiresAt((opened.acceptance as Record<string, unknown>).assignmentExpiresAt as string);
      }
      if (opened.nextAction === "accept_dsa_reference_panel") {
        if (!dsaConflictConfirmed) {
          setPendingDsaAcceptance(true);
          persistReviewerAssignment(id, termsHash.trim());
          return;
        }
        await acceptDsaReferencePanel(id, privateStateEpoch);
      } else if (opened.task && typeof opened.task === "object") {
        applyLoadedTask(opened.task);
      } else {
        await loadAssignment(id);
      }
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      persistReviewerAssignment(id, termsHash.trim());
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
      setPendingDsaAcceptance(false);
      setError(t("openFailed"));
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
        privateReviewJsonOptions,
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
      setError(t("recoveryFailed"));
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
    }
  }

  function updateDraft(caseId: string, update: Partial<ReviewDraft>) {
    setError(null);
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
      const dsaCase = task.taskKind === "dsa_reference_panel" ? task.cases[0] : null;
      const dsaDraft = dsaCase ? drafts[dsaCase.caseId] : null;
      const dsaChoice =
        dsaDraft?.selectedOption === "A"
          ? dsaCase?.dsaReferencePanel?.choices[0]
          : dsaDraft?.selectedOption === "B"
            ? dsaCase?.dsaReferencePanel?.choices[1]
            : null;
      if (task.taskKind === "dsa_reference_panel" && !dsaChoice) throw new Error(t("optionUnavailable"));
      const requestBody =
        task.taskKind === "dsa_reference_panel"
          ? {
              idempotencyKey: `response:web:${task.assignmentId.slice(-96)}:${task.runManifestHash.slice(-16)}`,
              dsaResponse: {
                choice: dsaChoice,
                rationale: dsaDraft?.rationale ?? "",
              },
            }
          : {
              idempotencyKey: `response:web:${task.assignmentId.slice(-96)}:${task.runManifestHash.slice(-16)}`,
              responses: task.cases.map(reviewCase => {
                const draft = drafts[reviewCase.caseId]!;
                const option = reviewCase.options.find(value => value.key === draft.selectedOption);
                const selectedArtifactId = reviewCase.binaryReview?.suggestion.artifactId ?? option?.artifactId;
                if (!selectedArtifactId || !draft.selectedOption) {
                  throw new Error(t("optionUnavailable"));
                }
                return {
                  caseId: reviewCase.caseId,
                  displayedOption: draft.selectedOption,
                  selectedArtifactId,
                  predictedPositiveBps:
                    task.taskKind === "binary_review" && task.forecastRequired && draft.predictionPercent !== null
                      ? draft.predictionPercent * 100
                      : undefined,
                  failureTagKeys: draft.failureTags,
                  rationale: draft.rationale,
                };
              }),
            };
      const body = await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(task.assignmentId)}/responses`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }),
        privateReviewJsonOptions,
      );
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      if (
        !isAssuranceServerAcceptance(body) ||
        (task.taskKind !== "dsa_reference_panel" && body.compensation !== "unpaid")
      ) {
        throw new Error(t("acceptanceIncomplete"));
      }
      const acceptance = body;
      saveReviewReceipt("private", task.assignmentId, acceptance, { principalId: activePrincipalId! });
      setServerAcceptance(acceptance);
      clearReviewDraft("private", task.assignmentId, privateDraftStorage);
    } catch {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setError(task.taskKind === "dsa_reference_panel" ? t("dsaSubmitFailed") : t("submitFailed"));
    } finally {
      if (privateStateEpoch === privateStateEpochRef.current) setBusyAction(null);
    }
  }

  async function submitDsaSelfIdentificationReport() {
    if (task?.taskKind !== "dsa_reference_panel" || !dsaArtifactReady || serverAcceptance) return;
    const privateStateEpoch = privateStateEpochRef.current;
    setBusyAction("response");
    setError(null);
    try {
      const body = await readJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(task.assignmentId)}/responses`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dsaGapReport: { reason: "content_self_identification" } }),
        }),
        privateReviewJsonOptions,
      );
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      if (
        !isAssuranceServerAcceptance(body) ||
        body.terminalKind !== "content_self_identification_gap" ||
        body.compensation !== "unpaid"
      ) {
        throw new Error(t("acceptanceIncomplete"));
      }
      saveReviewReceipt("private", task.assignmentId, body, { principalId: activePrincipalId! });
      setServerAcceptance(body);
      setDsaSelfIdentificationConfirming(false);
      clearReviewDraft("private", task.assignmentId, privateDraftStorage);
    } catch {
      if (privateStateEpoch !== privateStateEpochRef.current) return;
      setError(t("dsaSelfIdentificationSubmitFailed"));
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
    if (!activeCase || !activeCaseComplete) {
      setError(localizedCaseCompletionIssue(activeCaseIssue, t));
      if (activeCaseIssue?.includes("rationale")) rationaleRef.current?.focus();
      return;
    }
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
        <PageHeading
          heading={task ? t("headingComplete") : t("headingOpen")}
          subtitle={
            task
              ? task.taskKind === "binary_review"
                ? t("binaryDescription")
                : task.taskKind === "dsa_reference_panel"
                  ? t("dsaDescription")
                  : t("comparisonDescription")
              : t("invitationDescription")
          }
        />
      ) : null}

      <div className={presentation === "embedded" ? "" : "mt-8"}>
        <div className="space-y-6">
          {!task ? (
            pendingDsaAcceptance ? (
              <Card as="section" className="rounded-2xl p-5 sm:p-7" aria-labelledby="dsa-conflict-title">
                <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                  {t("dsaLane")}
                </p>
                <h2 id="dsa-conflict-title" className="mt-2 text-2xl font-semibold">
                  {t("dsaConflictTitle")}
                </h2>
                <p className="mt-3 text-sm leading-6 text-base-content/65">{t("dsaConflictDescription")}</p>
                <DeadlineChip deadline={draftExpiresAt} label={t("submitDeadline")} />
                <label
                  htmlFor="dsa-reference-panel-conflict-confirmation"
                  className="mt-5 flex items-start gap-3 rounded-lg border border-base-content/10 p-4 text-sm leading-6 text-base-content/70"
                >
                  <ChoiceInput
                    id="dsa-reference-panel-conflict-confirmation"
                    type="checkbox"
                    className="checkbox checkbox-sm mt-1"
                    checked={dsaConflictConfirmed}
                    onChange={event => setDsaConflictConfirmed(event.target.checked)}
                  />
                  <span>{t("dsaConflictConfirmation")}</span>
                </label>
                <Button
                  type="button"
                  className="mt-5 w-full px-6 sm:w-auto"
                  disabled={!dsaConflictConfirmed || busyAction !== null}
                  onClick={() => void confirmDsaReferencePanel()}
                >
                  {busyAction === "assignment" ? t("dsaOpening") : t("dsaOpen")}
                </Button>
                {onContinue ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 w-full sm:ml-3 sm:w-auto"
                    onClick={onContinue}
                  >
                    {t("returnQueue")}
                  </Button>
                ) : (
                  <Link href="/human/review" className="mt-4 block text-sm font-semibold underline underline-offset-4">
                    {t("returnQueue")}
                  </Link>
                )}
              </Card>
            ) : presentation === "embedded" ? (
              <Card as="article" className="rounded-2xl p-5 sm:p-6">
                <form onSubmit={openAssignment}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
                        {t("privateAssignment")}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">{resolvedAssignmentTitle}</h2>
                    </div>
                    <span className="rounded-full border border-base-content/10 px-3 py-1.5 text-xs text-base-content/60">
                      {t("unpaid")}
                    </span>
                  </div>
                  {assignmentExpiresAt ? (
                    <p className="mt-4 text-sm text-base-content/55">
                      {t("completeBy", {
                        date: format.dateTime(new Date(assignmentExpiresAt), {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </p>
                  ) : null}
                  <p className="mt-4 text-sm leading-6 text-base-content/65">{t("accessDescription")}</p>
                  {assignmentTerms ? privateTermsSummary(assignmentTerms, t) : null}
                  {assignmentClosed || assignmentUnavailable ? (
                    <div role="status" className="mt-5 rounded-lg border border-base-content/10 p-4 text-sm">
                      <p>{assignmentClosed ? t("windowClosed") : t("noLongerAvailable")}</p>
                      {onContinue ? (
                        <Button type="button" variant="secondary" className="mt-3 w-full" onClick={onContinue}>
                          {t("returnQueue")}
                        </Button>
                      ) : (
                        <Link
                          href="/human/review"
                          className="mt-3 inline-flex font-semibold underline underline-offset-4"
                        >
                          {t("returnQueue")}
                        </Link>
                      )}
                    </div>
                  ) : termsRequired === null ? (
                    <p
                      role="status"
                      className="mt-5 rounded-lg border border-base-content/10 p-4 text-sm text-base-content/60"
                    >
                      {t("checkingAccess")}
                    </p>
                  ) : termsRequired ? (
                    <label
                      htmlFor="private-review-confidentiality-acceptance-embedded"
                      className="mt-5 flex items-start gap-3 rounded-lg border border-base-content/10 p-4 text-sm leading-6 text-base-content/70"
                    >
                      <ChoiceInput
                        id="private-review-confidentiality-acceptance-embedded"
                        type="checkbox"
                        className="checkbox checkbox-sm mt-1"
                        checked={confidentialityAccepted}
                        onChange={event => setConfidentialityAccepted(event.target.checked)}
                      />
                      <span>{t("acceptance")}</span>
                    </label>
                  ) : (
                    <p
                      role="status"
                      className="mt-5 rounded-lg border border-base-content/10 p-4 text-sm text-base-content/65"
                    >
                      {busyAction === "assignment" ? t("loadingReview") : t("accessConfirmed")}
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
                        ? t("openingReview")
                        : termsRequired === false
                          ? t("openReview")
                          : t("acceptBegin")}
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
                      {busyAction === "recovery" ? t("restoring") : t("restoreReview")}
                    </Button>
                  ) : null}
                </form>
              </Card>
            ) : (
              <>
                <Card as="section" variant="marketing" className="p-5 sm:p-7">
                  <h2 className="text-xl font-semibold">{t("details")}</h2>
                  <form className="mt-4 space-y-4" onSubmit={openAssignment}>
                    {hasInvitationCredentials && !manualCredentialEntry ? (
                      <div className="rounded-lg border border-base-content/10 bg-base-content/[0.02] p-4">
                        <p className="text-sm font-semibold">{t("invitationLoaded")}</p>
                        <p className="mt-1 text-xs text-base-content/55">{t("linkIdentifies")}</p>
                        <button
                          type="button"
                          className="mt-3 text-xs font-medium underline underline-offset-4"
                          onClick={() => setManualCredentialEntry(true)}
                        >
                          {t("useDifferent")}
                        </button>
                      </div>
                    ) : manualCredentialEntry ? (
                      <div className="space-y-4">
                        <Field
                          label={t("assignmentId")}
                          className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)] font-mono text-sm"
                          value={assignmentId}
                          onChange={event => setAssignmentId(event.target.value)}
                          placeholder="haas_…"
                          required
                        />
                        <Field
                          label={t("termsHash")}
                          className="rounded-lg border-base-content/10 bg-[var(--rateloop-field)] font-mono text-sm"
                          value={termsHash}
                          onChange={event => setTermsHash(event.target.value)}
                          placeholder="sha256:…"
                          format="sha256Digest"
                          required
                        />
                      </div>
                    ) : (
                      <div className="rounded-lg border border-base-content/10 bg-base-content/[0.02] p-4">
                        <p className="text-sm font-semibold">{t("openInvitation")}</p>
                        <p className="mt-1 text-xs text-base-content/55">{t("invitationIncludes")}</p>
                        <button
                          type="button"
                          className="mt-3 text-xs font-medium underline underline-offset-4"
                          onClick={() => setManualCredentialEntry(true)}
                        >
                          {t("enterManually")}
                        </button>
                      </div>
                    )}
                    <section
                      className="rounded-lg border border-base-content/10 bg-base-content/[0.03] p-4 text-sm text-base-content/65"
                      aria-labelledby="private-review-access-title"
                    >
                      <h3 id="private-review-access-title" className="font-medium text-base-content/80">
                        {t("accessRules")}
                      </h3>
                      <ul className="mt-3 space-y-2 text-xs leading-5">
                        <li>{t("accessRuleCases")}</li>
                        <li>{t("accessRuleLogged")}</li>
                        <li>{t("accessRulePrivacy")}</li>
                      </ul>
                    </section>
                    {assignmentTerms ? privateTermsSummary(assignmentTerms, t) : null}
                    {assignmentClosed || assignmentUnavailable ? (
                      <div
                        role="status"
                        className="rounded-lg border border-base-content/10 bg-base-content/[0.02] p-4 text-sm"
                      >
                        <p className="font-semibold">{assignmentClosed ? t("closedTitle") : t("unavailableTitle")}</p>
                        <p className="mt-1 text-xs leading-5 text-base-content/55">
                          {assignmentClosed ? t("closedDescription") : t("unavailableDescription")}
                        </p>
                        <Link
                          href="/human/review"
                          className="mt-3 inline-flex text-xs font-semibold underline underline-offset-4"
                        >
                          {t("returnQueue")}
                        </Link>
                      </div>
                    ) : termsRequired === null ? (
                      <p
                        role="status"
                        className="rounded-lg border border-base-content/10 p-4 text-sm text-base-content/60"
                      >
                        {t("checkingTerms")}
                      </p>
                    ) : termsRequired ? (
                      <label
                        htmlFor="private-review-confidentiality-acceptance"
                        className="flex items-start gap-3 rounded-lg border border-base-content/10 p-4 text-sm leading-6 text-base-content/70"
                      >
                        <ChoiceInput
                          id="private-review-confidentiality-acceptance"
                          type="checkbox"
                          className="checkbox checkbox-sm mt-1"
                          checked={confidentialityAccepted}
                          onChange={event => setConfidentialityAccepted(event.target.checked)}
                        />
                        <span>{t("acceptance")}</span>
                      </label>
                    ) : (
                      <p
                        role="status"
                        className="rounded-lg border border-base-content/10 p-4 text-sm text-base-content/65"
                      >
                        {t("termsAccepted")}
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
                          ? t("openingAssignment")
                          : termsRequired === false
                            ? t("openAssignment")
                            : t("acceptOpen")}
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
                      {busyAction === "recovery" ? t("restoring") : t("restoreAssignment")}
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
                dsaSelfIdentificationConfirming ||
                (task.taskKind === "dsa_reference_panel" && !dsaArtifactReady) ||
                (reviewingResponses ? !completeDraft : false)
              }
              advanceHint={serverAcceptance || reviewingResponses ? null : activeCaseIssue}
              advanceLabel={
                serverAcceptance
                  ? t("recorded")
                  : reviewingResponses
                    ? t("submitReview")
                    : activeCaseIndex === task.cases.length - 1
                      ? task.cases.length === 1
                        ? t("submitReview")
                        : t("reviewAnswers")
                      : t("nextCase")
              }
              backDisabled={busyAction !== null || serverAcceptance !== null || dsaSelfIdentificationConfirming}
              backLabel={reviewingResponses ? t("backLast") : t("previousCase")}
              busyLabel={busyAction === "response" ? t("submitting") : null}
              caseIndex={activeCaseIndex}
              laneHeader={
                <>
                  <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-green)]">
                    {task.taskKind === "binary_review"
                      ? t("binaryLane")
                      : task.taskKind === "dsa_reference_panel"
                        ? t("dsaLane")
                        : t("comparisonLane")}
                  </p>
                  <p className="mt-1 text-sm font-semibold">{resolvedAssignmentTitle}</p>
                  <DeadlineChip deadline={draftExpiresAt} label={t("submitDeadline")} />
                  <DeadlineChip deadline={leaseDeadline} label={t("accessDeadline")} />
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
                    {t("finalCheck")}
                  </p>
                  <h2 id="private-review-summary" className="mt-2 text-2xl font-semibold">
                    {t("reviewEvery")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-base-content/60">{t("submissionCloses")}</p>
                  <ol className="mt-5 space-y-3">
                    {task.cases.map((reviewCase, index) => {
                      const draft = drafts[reviewCase.caseId];
                      return (
                        <li
                          key={reviewCase.caseId}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-base-content/10 bg-base-content/[0.03] p-4"
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
                                : t("candidate", { option: draft?.selectedOption ?? "—" })}
                              {(draft?.failureTags.length ?? 0) > 0
                                ? ` · ${t("failureCount", { count: draft!.failureTags.length })}`
                                : ""}
                            </p>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={() => returnToCase(index)}>
                            {t("editCase", { case: index + 1 })}
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
                    predictionPercent: null,
                    failureTags: [],
                    rationale: "",
                  };
                  const failureTags = reviewCase.failureTags?.length ? reviewCase.failureTags : task.rubric.failureTags;
                  return (
                    <Card as="article" key={reviewCase.caseId} className="rounded-2xl p-5 sm:p-7">
                      <p className="font-mono text-xs uppercase tracking-widest text-base-content/55">
                        {t("caseLabel", { current: String(activeCaseIndex + 1).padStart(2, "0") })}
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold">
                        {reviewCase.dsaReferencePanel ? t("dsaCaseTitle") : reviewCase.title}
                      </h2>
                      {reviewCase.instructions.trim() &&
                      reviewCase.instructions.trim() !== task.rubric.prompt.trim() ? (
                        <p className="mt-3 text-sm leading-6 text-base-content/60">{reviewCase.instructions}</p>
                      ) : null}
                      {reviewCase.objectiveReference ? (
                        <p className="mt-3 rounded-lg border border-base-content/10 bg-base-content/[0.03] p-3 text-xs leading-5 text-base-content/55">
                          {t("objectiveReference", { reference: reviewCase.objectiveReference })}
                        </p>
                      ) : null}
                      {reviewCase.dsaReferencePanel ? (
                        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.25rem]">
                          <PrivateArtifactPreview
                            label={t("dsaContent")}
                            artifactUrl={dsaArtifactUrl(task.assignmentId, reviewCase.dsaReferencePanel.artifactId)}
                            onAvailabilityChange={availability => setDsaArtifactReady(availability === "ready")}
                            onRefreshAccess={() => openAssignmentRef.current()}
                          />
                          <fieldset className="lg:sticky lg:top-4 lg:self-start">
                            <legend className="text-sm font-semibold">{task.rubric.prompt}</legend>
                            <p className="mt-1 text-xs leading-5 text-base-content/55">{t("dsaRatingPrivacy")}</p>
                            <div className="mt-3 grid gap-3">
                              {(
                                [
                                  ["A", t("dsaPolicyMatches")],
                                  ["B", t("dsaPolicyDoesNotMatch")],
                                ] as const
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  htmlFor={`choice-${reviewCase.caseId}-${key}`}
                                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                                    draft.selectedOption === key
                                      ? "border-[var(--rateloop-green)] bg-success/10"
                                      : "border-base-content/10 bg-base-content/[0.03] hover:border-base-content/25"
                                  }`}
                                >
                                  <span className="flex items-center gap-3 font-semibold">
                                    <ChoiceInput
                                      id={`choice-${reviewCase.caseId}-${key}`}
                                      aria-label={label}
                                      type="radio"
                                      name={`choice-${reviewCase.caseId}`}
                                      value={key}
                                      checked={draft.selectedOption === key}
                                      disabled={serverAcceptance !== null || dsaSelfIdentificationConfirming}
                                      onClick={() => updateDraft(reviewCase.caseId, { selectedOption: key })}
                                      onChange={() => updateDraft(reviewCase.caseId, { selectedOption: key })}
                                    />
                                    {label}
                                  </span>
                                </label>
                              ))}
                            </div>
                            <div className="mt-5 border-t border-base-content/10 pt-4">
                              {dsaSelfIdentificationConfirming ? (
                                <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
                                  <p className="text-sm font-semibold">{t("dsaSelfIdentificationConfirmTitle")}</p>
                                  <p className="mt-2 text-xs leading-5 text-base-content/70">
                                    {t("dsaSelfIdentificationConfirmDescription")}
                                  </p>
                                  <div className="mt-4 grid gap-2">
                                    <Button
                                      type="button"
                                      disabled={busyAction !== null || !dsaArtifactReady}
                                      onClick={() => void submitDsaSelfIdentificationReport()}
                                    >
                                      {busyAction === "response"
                                        ? t("dsaSelfIdentificationSubmitting")
                                        : t("dsaSelfIdentificationConfirm")}
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      disabled={busyAction !== null}
                                      onClick={() => setDsaSelfIdentificationConfirming(false)}
                                    >
                                      {t("dsaSelfIdentificationCancel")}
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    className="w-full"
                                    disabled={serverAcceptance !== null || busyAction !== null || !dsaArtifactReady}
                                    onClick={() => setDsaSelfIdentificationConfirming(true)}
                                  >
                                    {t("dsaSelfIdentificationAction")}
                                  </Button>
                                  <p className="mt-2 text-xs leading-5 text-base-content/60">
                                    {t("dsaSelfIdentificationHelp")}
                                  </p>
                                </>
                              )}
                            </div>
                          </fieldset>
                        </div>
                      ) : reviewCase.binaryReview ? (
                        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.25rem]">
                          <div className="space-y-3">
                            {(
                              [
                                [t("source"), reviewCase.binaryReview.source],
                                [t("agentOutput"), reviewCase.binaryReview.suggestion],
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
                            <p className="mt-1 text-xs leading-5 text-base-content/55">{t("ratingPrivacy")}</p>
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
                                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                                    draft.selectedOption === key
                                      ? "border-[var(--rateloop-green)] bg-success/10"
                                      : "border-base-content/10 bg-base-content/[0.03] hover:border-base-content/25"
                                  }`}
                                >
                                  <span className="flex items-center gap-3 font-semibold">
                                    <ChoiceInput
                                      id={`choice-${reviewCase.caseId}-${key}`}
                                      aria-label={label}
                                      type="radio"
                                      name={`choice-${reviewCase.caseId}`}
                                      value={key}
                                      checked={draft.selectedOption === key}
                                      disabled={serverAcceptance !== null}
                                      onClick={() => updateDraft(reviewCase.caseId, { selectedOption: key })}
                                      onChange={() => updateDraft(reviewCase.caseId, { selectedOption: key })}
                                    />
                                    {label}
                                  </span>
                                </label>
                              ))}
                            </div>
                            {task.forecastRequired && draft.selectedOption ? (
                              <CrowdForecastField
                                positiveLabel={reviewCase.binaryReview.positiveLabel}
                                privacyContext={PRIVATE_UNPAID_REVIEW_PRIVACY_CONTEXT}
                                value={draft.predictionPercent}
                                disabled={serverAcceptance !== null}
                                onChange={predictionPercent => updateDraft(reviewCase.caseId, { predictionPercent })}
                              />
                            ) : null}
                          </fieldset>
                        </div>
                      ) : (
                        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17.25rem]">
                          <div className="space-y-3">
                            {reviewCase.options.map(option => (
                              <PrivateArtifactPreview
                                key={option.key}
                                label={t("candidate", { option: option.key })}
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
                                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                                    draft.selectedOption === option.key
                                      ? "border-[var(--rateloop-green)] bg-success/10"
                                      : "border-base-content/10 bg-base-content/[0.03] hover:border-base-content/25"
                                  }`}
                                >
                                  <ChoiceInput
                                    id={`choice-${reviewCase.caseId}-${option.key}`}
                                    aria-label={t("candidate", { option: option.key })}
                                    type="radio"
                                    name={`choice-${reviewCase.caseId}`}
                                    value={option.key}
                                    checked={draft.selectedOption === option.key}
                                    disabled={serverAcceptance !== null}
                                    onClick={() => updateDraft(reviewCase.caseId, { selectedOption: option.key })}
                                    onChange={() => updateDraft(reviewCase.caseId, { selectedOption: option.key })}
                                  />
                                  <span className="ml-3 font-semibold">{t("candidate", { option: option.key })}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                        </div>
                      )}

                      {failureTags.length > 0 ? (
                        <fieldset className="mt-6 border-t border-base-content/10 pt-5">
                          <legend className="text-sm font-semibold">{t("failureTags")}</legend>
                          <p className="mt-1 text-xs leading-5 text-base-content/55">{t("failureHelp")}</p>
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
                        <TextareaField
                          ref={rationaleRef}
                          label={t("rationale")}
                          className="mt-2 min-h-32 rounded-lg border-base-content/10 bg-[var(--rateloop-field)] text-sm leading-6"
                          value={draft.rationale}
                          onChange={event => updateDraft(reviewCase.caseId, { rationale: event.target.value })}
                          minLength={requiredRationaleLength(task)}
                          maxLength={Math.min(2_000, task.rubric.rationale.maxLength)}
                          disabled={serverAcceptance !== null}
                          placeholder={
                            task.taskKind === "binary_review"
                              ? t("binaryRationale")
                              : task.taskKind === "dsa_reference_panel"
                                ? t("dsaRationale")
                                : t("comparisonRationale")
                          }
                          required={task.rubric.rationale.mode === "required"}
                        />
                      ) : null}
                    </Card>
                  );
                })()
              ) : null}

              {serverAcceptance ? (
                <Card className="rounded-2xl p-5 sm:p-7" aria-label={t("receipt")}>
                  <p role="status" className="rounded-lg bg-success/10 p-3 text-sm leading-6 text-success">
                    {serverAcceptance.terminalKind === "content_self_identification_gap" ? (
                      t("dsaSelfIdentificationRecorded")
                    ) : (
                      <>
                        {serverAcceptance.replay ? t("alreadyRecorded") : t("submitted")}{" "}
                        {serverAcceptance.compensation === "paid" ? t("paidPrivateClosed") : t("privateClosed")}
                      </>
                    )}
                  </p>
                  <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-base-content/55">{t("receiptId")}</dt>
                      <dd className="mt-1 break-all font-mono text-xs">{task.assignmentId}</dd>
                    </div>
                    <div>
                      <dt className="text-base-content/55">
                        {serverAcceptance.terminalKind === "content_self_identification_gap"
                          ? t("dsaSelfIdentificationReceipt")
                          : t("responses")}
                      </dt>
                      <dd className="mt-1">
                        {serverAcceptance.terminalKind === "content_self_identification_gap"
                          ? t("dsaSelfIdentificationOneReport")
                          : serverAcceptance.responseCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-base-content/55">{t("compensation")}</dt>
                      <dd className="mt-1">
                        {serverAcceptance.compensation === "paid" ? t("paidSettlementPending") : t("unpaidSettlement")}
                      </dd>
                    </div>
                  </dl>
                  {onContinue ? (
                    <Button type="button" className="mt-4 w-full sm:w-auto" onClick={onContinue}>
                      {t("nextAssignment")}
                    </Button>
                  ) : null}
                </Card>
              ) : null}
            </ReviewerShell>
          )}

          {error ? (
            <p role="alert" className="rounded-lg bg-error/10 p-4 text-sm leading-6 text-error">
              {error}
            </p>
          ) : null}
          {sessionCheckError ? (
            <p role="alert" className="rounded-lg bg-error/10 p-4 text-sm leading-6 text-error">
              {sessionCheckError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
