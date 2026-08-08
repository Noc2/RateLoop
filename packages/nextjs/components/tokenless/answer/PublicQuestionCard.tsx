"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shouldInspectReservedVoucher } from "./publicSubmissionReceipt";
import { useFormatter, useTranslations } from "next-intl";
import type { Hex } from "viem";
import {
  type PublicQuestionMedia,
  QuestionMedia,
  type QuestionMediaReviewState,
  questionMediaIdentity,
} from "~~/components/tokenless/answer/QuestionMedia";
import { ChoiceInput, Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { CrowdForecastField, isCrowdForecastPercent } from "~~/components/tokenless/review/CrowdForecastField";
import { DeadlineChip } from "~~/components/tokenless/review/DeadlineChip";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Button } from "~~/components/tokenless/ui/Button";
import { Card } from "~~/components/tokenless/ui/Card";
import { Link } from "~~/i18n/navigation";
import { readBrowserSession } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";
import {
  publicTaskDomId,
  publicTaskIdentity,
  queuedCommitMatchesPublicTask,
} from "~~/lib/tokenless/publicTaskIdentity";
import {
  type TokenlessRaterRoundSecrets,
  createIndexedDbTokenlessCommitQueue,
  createTokenlessRaterRoundSecrets,
  dueTokenlessCommits,
  enqueueTokenlessCommit,
  exportTokenlessRecoveryPackage,
  isTokenlessPredictionBps,
  recordTokenlessCommitRelayFailure,
  sealTokenlessReveal,
  signTokenlessCommit,
} from "~~/lib/tokenless/rater";
import {
  type DeviceRecoveryRecord,
  createDeviceRecoveryRecord,
  generateDeviceRecoverySecret,
  serializeDeviceRecoveryBackup,
  storeDeviceRecovery,
} from "~~/lib/tokenless/rater/deviceRecovery";
import {
  PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH,
  PUBLIC_RATER_RESPONSE_CATEGORIES,
  type PublicRaterResponseCategory,
  createPublicRaterResponse,
} from "~~/lib/tokenless/rater/publicResponse";
import { buildPublicVoucherRequest } from "~~/lib/tokenless/rater/publicVoucherRequest";
import type { TokenlessQueuedCommit } from "~~/lib/tokenless/rater/queue";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "~~/lib/tokenless/reviewDrafts";
import { loadReviewReceipt, saveReviewReceipt } from "~~/lib/tokenless/reviewReceipts";
import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

export const PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT = "public_paid" as const;
const MEDIA_PENDING = { status: "pending" } as const satisfies QuestionMediaReviewState;

type PublicAnswerTaskBase = {
  operationKey: string;
  chainId: number;
  panelAddress: `0x${string}`;
  roundId: string;
  contentId: `0x${string}`;
  question: {
    kind: "binary" | "head_to_head";
    prompt: string;
    negativeLabel?: string;
    positiveLabel?: string;
    optionA?: { key: string; label: string };
    optionB?: { key: string; label: string };
    media?: PublicQuestionMedia;
    rationale?: { mode: "off" } | { mode: "optional" | "required"; minLength?: number; maxLength?: number };
  };
  voucherDeadline: string;
  alreadyVouchered: boolean;
  earnings: {
    guaranteedBaseAtomic: string;
    possibleBonusAtomic: string;
    possibleSurpriseBonusAtomic: string;
    attemptCompensationAtomic: string;
  };
  disclosureBeacon: { network: "quicknet-t"; round: number };
  scoringBeacon: { network: "quicknet-t"; round: number };
};

export type PublicAnswerTask = PublicAnswerTaskBase &
  (
    | { reviewerSource: "customer_invited"; assignmentId: string; issuanceId: string }
    | {
        reviewerSource: "rateloop_network";
        assignmentId: string;
        assignmentStatus: "reserved" | "accepted";
        assignmentExpiresAt: string;
        confidentialityTermsHash: `sha256:${string}`;
        selectionBindingHash: `sha256:${string}`;
      }
  );

export type PaidTaskAccess =
  | { state: "ready" }
  | { state: "payout_wallet_required" }
  | { state: "eligibility_required"; eligibilityStatus: string };

function readAnswerJson(response: Response, fallbackMessage: string) {
  return readJson(response, { errorFields: ["message"], fallbackMessage });
}

function randomNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function ThumbIcon({ down = false }: { down?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={down ? "rotate(180 12 12)" : undefined}
        d="M7.5 10.5 10 4.75c.5-1.15 2.25-.8 2.25.45v3.3h4.4a2 2 0 0 1 1.95 2.45l-1.1 5a2 2 0 0 1-1.95 1.55H7.5m0-7v7m0-7H4.75v7H7.5"
      />
    </svg>
  );
}

function usdc(value: string) {
  return formatUsdcAtomic(value, { includeUnit: false, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type PublicReviewDraft = {
  answer: "yes" | "no" | null;
  prediction: number | null;
  feedbackCategory: PublicRaterResponseCategory;
  feedbackBody: string;
  sourceUrl: string;
};

type PreparedPublicSubmission = {
  binding: string;
  principalId: string;
  recoveryBackup: string;
  recoveryRecord: DeviceRecoveryRecord;
  response: ReturnType<typeof createPublicRaterResponse>;
  secrets: TokenlessRaterRoundSecrets;
};

type PublicSubmissionReceipt = {
  commitId: string;
  confirmedAt: string | null;
  transactionHash: string | null;
};

function publicSubmissionBinding(
  task: PublicAnswerTask,
  draft: Pick<PublicReviewDraft, "answer" | "prediction" | "feedbackCategory" | "feedbackBody" | "sourceUrl">,
) {
  return JSON.stringify({
    operationKey: task.operationKey,
    chainId: task.chainId,
    panelAddress: task.panelAddress,
    roundId: task.roundId,
    contentId: task.contentId,
    reviewerSource: task.reviewerSource,
    voucherDeadline: task.voucherDeadline,
    alreadyVouchered: task.alreadyVouchered,
    disclosureBeacon: task.disclosureBeacon,
    scoringBeacon: task.scoringBeacon,
    rationale: task.question.rationale,
    ...draft,
  });
}

function isPublicReviewDraft(value: unknown): value is PublicReviewDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PublicReviewDraft>;
  return (
    [null, "yes", "no"].includes(draft.answer ?? null) &&
    (draft.prediction === null || isPublicPredictionPercent(draft.prediction)) &&
    typeof draft.feedbackCategory === "string" &&
    PUBLIC_RATER_RESPONSE_CATEGORIES.includes(draft.feedbackCategory as PublicRaterResponseCategory) &&
    typeof draft.feedbackBody === "string" &&
    typeof draft.sourceUrl === "string"
  );
}

function isPublicPredictionPercent(value: number | null | undefined): value is number {
  return isCrowdForecastPercent(value) && isTokenlessPredictionBps(value * 100);
}

function isPublicSubmissionReceipt(value: unknown): value is PublicSubmissionReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.commitId === "string" &&
    (receipt.confirmedAt === null || typeof receipt.confirmedAt === "string") &&
    (receipt.transactionHash === null || typeof receipt.transactionHash === "string")
  );
}

export function PublicQuestionCard({
  task,
  paidAccess,
  onSubmitted,
  principalId,
  shortcutsEnabled = true,
}: {
  task: PublicAnswerTask;
  paidAccess: PaidTaskAccess;
  onSubmitted: () => void;
  principalId: string;
  shortcutsEnabled?: boolean;
}) {
  const t = useTranslations("review.public");
  const forecastT = useTranslations("review.forecast");
  const format = useFormatter();
  const taskScope = useMemo(
    () => ({
      operationKey: task.operationKey,
      chainId: task.chainId,
      panelAddress: task.panelAddress,
      roundId: task.roundId,
    }),
    [task.chainId, task.operationKey, task.panelAddress, task.roundId],
  );
  const taskIdentity = publicTaskIdentity(taskScope);
  const termsControlId = publicTaskDomId(taskScope, "terms");
  const recordsHeadingId = publicTaskDomId(taskScope, "records");
  const recoveryConfirmationId = publicTaskDomId(taskScope, "recovery-confirmed");
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [preparedSubmission, setPreparedSubmission] = useState<PreparedPublicSubmission | null>(null);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(task.question.rationale?.mode === "required");
  const [feedbackCategory, setFeedbackCategory] = useState<PublicRaterResponseCategory>("opinion");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [savedCommit, setSavedCommit] = useState<TokenlessQueuedCommit | null>(null);
  const [submissionReceipt, setSubmissionReceipt] = useState<PublicSubmissionReceipt | null>(null);
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const [draftRestored, setDraftRestored] = useState(false);
  const [acceptedAssignmentId, setAcceptedAssignmentId] = useState<string | null>(null);
  const [networkTermsAccepted, setNetworkTermsAccepted] = useState(false);
  const mediaIdentity = task.question.media ? questionMediaIdentity(task.question.media) : null;
  const [mediaReview, setMediaReview] = useState<{
    identity: string | null;
    state: QuestionMediaReviewState;
  }>(() => ({ identity: mediaIdentity, state: mediaIdentity ? MEDIA_PENDING : { status: "ready" } }));
  const [mediaRetryAttempt, setMediaRetryAttempt] = useState(0);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const feedbackEnabled = task.question.rationale?.mode !== "off";
  const preparationBinding = publicSubmissionBinding(task, {
    answer,
    prediction,
    feedbackCategory,
    feedbackBody,
    sourceUrl,
  });
  const activePreparedSubmission = preparedSubmission?.binding === preparationBinding ? preparedSubmission : null;
  const currentMediaReview = mediaReview.identity === mediaIdentity ? mediaReview.state : MEDIA_PENDING;
  const mediaReady = mediaIdentity === null || currentMediaReview.status === "ready";
  const publicDraftStorage = useMemo(() => ({ principalId }), [principalId]);
  const retryAvailable = Boolean(
    savedCommit &&
      Date.parse(savedCommit.commitDeadline) > retryClock &&
      Date.parse(savedCommit.nextAttemptAt) <= retryClock,
  );
  const networkAssignment =
    task.reviewerSource === "rateloop_network"
      ? {
          assignmentId: task.assignmentId,
          assignmentExpiresAt: task.assignmentExpiresAt,
          confidentialityTermsHash: task.confidentialityTermsHash,
          selectionBindingHash: task.selectionBindingHash,
        }
      : null;
  // Derived on every render so a genuine server-side status change is never ignored, while this
  // reviewer's own acceptance is remembered per assignment rather than per `task` object identity.
  const networkAssignmentStatus: "reserved" | "accepted" =
    task.reviewerSource !== "rateloop_network"
      ? "accepted"
      : acceptedAssignmentId === task.assignmentId
        ? "accepted"
        : task.assignmentStatus;
  const networkAssignmentReady = networkAssignment === null || networkAssignmentStatus === "accepted";

  const handleMediaReview = useCallback(
    (state: QuestionMediaReviewState) => setMediaReview({ identity: mediaIdentity, state }),
    [mediaIdentity],
  );

  function retryMedia() {
    setMediaReview({ identity: mediaIdentity, state: MEDIA_PENDING });
    setMediaRetryAttempt(current => current + 1);
  }

  useEffect(() => {
    const receipt = loadReviewReceipt("public", taskIdentity, isPublicSubmissionReceipt, { principalId });
    setSubmissionReceipt(receipt);
    if (receipt) {
      setStatus(t("recorded"));
      setError(null);
    }
  }, [principalId, t, taskIdentity]);

  // Acceptance of the paid-review terms must never carry across a different task or a different
  // signed-in reviewer. It must survive a re-render caused by a queue reload of the same task,
  // which replaces `task` with an equal but freshly parsed object.
  useEffect(() => {
    setNetworkTermsAccepted(false);
  }, [principalId, taskIdentity]);

  useEffect(() => {
    const draft = loadReviewDraft("public", taskIdentity, isPublicReviewDraft, publicDraftStorage);
    if (draft) {
      setAnswer(draft.answer);
      setPrediction(draft.prediction);
      setFeedbackCategory(draft.feedbackCategory);
      setFeedbackBody(draft.feedbackBody);
      setSourceUrl(draft.sourceUrl);
      if (draft.feedbackBody || draft.sourceUrl) setFeedbackOpen(true);
    }
    setDraftRestored(true);
  }, [publicDraftStorage, taskIdentity]);

  useEffect(() => {
    if (!draftRestored) return;
    saveReviewDraft(
      "public",
      taskIdentity,
      { answer, prediction, feedbackCategory, feedbackBody, sourceUrl },
      publicDraftStorage,
    );
  }, [answer, draftRestored, feedbackBody, feedbackCategory, prediction, publicDraftStorage, sourceUrl, taskIdentity]);

  useEffect(() => {
    if (!preparedSubmission || preparedSubmission.binding === preparationBinding) return;
    setPreparedSubmission(null);
    setRecoveryDownloaded(false);
    setRecoveryConfirmed(false);
    setStatus(t("ratingChanged"));
  }, [preparationBinding, preparedSubmission, t]);

  useEffect(() => {
    if (!activePreparedSubmission) {
      setRecoveryUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([activePreparedSubmission.recoveryBackup], { type: "application/json" }));
    setRecoveryUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [activePreparedSubmission]);

  useEffect(() => {
    if (
      !shouldInspectReservedVoucher({
        alreadyVouchered: task.alreadyVouchered,
        hasLocalReceipt: submissionReceipt !== null,
      })
    ) {
      return;
    }
    let active = true;
    const queue = createIndexedDbTokenlessCommitQueue();
    void dueTokenlessCommits(queue, principalId).then(async dueRecords => {
      if (!active) return;
      const records = await queue.list(principalId);
      if (!active) return;
      const record = records.find(value => queuedCommitMatchesPublicTask(value, taskScope)) ?? null;
      setSavedCommit(record);
      const isDue = Boolean(record && dueRecords.some(value => value.queueId === record.queueId));
      setRetryClock(Date.now());
      setStatus(
        record
          ? isDue
            ? t("readyRetry")
            : t("retryScheduled")
          : Date.parse(task.voucherDeadline) <= Date.now()
            ? t("submissionExpired")
            : t("noSaved"),
      );
    });
    return () => {
      active = false;
    };
  }, [principalId, submissionReceipt, t, task.alreadyVouchered, task.voucherDeadline, taskScope]);

  useEffect(() => {
    if (!savedCommit || retryAvailable) return;
    const delay = Math.max(0, Math.min(Date.parse(savedCommit.nextAttemptAt) - Date.now(), 30_000));
    const timeout = window.setTimeout(() => setRetryClock(Date.now()), delay + 10);
    return () => window.clearTimeout(timeout);
  }, [retryAvailable, savedCommit]);

  async function scheduleRetry(record: TokenlessQueuedCommit, errorCode: string) {
    const queue = createIndexedDbTokenlessCommitQueue();
    const failure = await recordTokenlessCommitRelayFailure(queue, record.queueId, principalId, errorCode);
    if (failure.expired) {
      setSavedCommit(null);
      setStatus(t("submissionExpired"));
      return;
    }
    setSavedCommit(failure.record);
    setRetryClock(Date.now());
    setStatus(
      t("retryAvailableAfter", {
        time: format.dateTime(new Date(failure.record.nextAttemptAt), {
          hour: "numeric",
          minute: "2-digit",
        }),
      }),
    );
  }

  async function acceptNetworkAssignment() {
    if (!networkAssignment || !networkTermsAccepted || busy) return;
    setBusy(true);
    setBusyLabel(t("accepting"));
    setError(null);
    setStatus(t("acceptingPaid"));
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== principalId) {
        throw new Error(t("accountChangedAccept"));
      }
      const result = await readAnswerJson(
        await fetch(`/api/account/assurance/assignments/${encodeURIComponent(networkAssignment.assignmentId)}/accept`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confidentialityTermsAccepted: true,
            confidentialityTermsHash: networkAssignment.confidentialityTermsHash,
          }),
        }),
        t("answerRequestFailed"),
      );
      if (result.accepted !== true || result.assignmentId !== networkAssignment.assignmentId) {
        throw new Error(t("acceptanceIncomplete"));
      }
      setAcceptedAssignmentId(networkAssignment.assignmentId);
      setNetworkTermsAccepted(false);
      setStatus(result.replay === true ? t("assignmentAlreadyAccepted") : t("assignmentAccepted"));
    } catch {
      setAcceptedAssignmentId(null);
      setStatus(null);
      setError(t("acceptFailed"));
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function retrySavedCommit() {
    if (!savedCommit) return;
    setBusy(true);
    setBusyLabel(t("retrying"));
    setError(null);
    setStatus(t("submitting"));
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== principalId) {
        setSavedCommit(null);
        setError(t("accountChangedRetry"));
        setStatus(null);
        return;
      }
      const queue = createIndexedDbTokenlessCommitQueue();
      const due = await dueTokenlessCommits(queue, principalId);
      const currentRecord = due.find(record => record.queueId === savedCommit.queueId);
      if (!currentRecord) {
        const retained = await queue.get(savedCommit.queueId, principalId);
        setSavedCommit(retained);
        setStatus(
          retained
            ? t("retryAvailableAfter", {
                time: format.dateTime(new Date(retained.nextAttemptAt), {
                  hour: "numeric",
                  minute: "2-digit",
                }),
              })
            : t("submissionExpired"),
        );
        return;
      }
      const idempotencyKey = String(currentRecord.relayPayload.idempotencyKey ?? "");
      let committed = await readAnswerJson(
        await fetch("/api/rater/commits", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(currentRecord.relayPayload),
        }),
        t("answerRequestFailed"),
      );
      if (typeof committed.commitId !== "string") throw new Error(t("commitIncomplete"));
      const commitId = committed.commitId;
      for (let attempt = 0; attempt < 10 && committed.state === "submitted"; attempt += 1) {
        await wait(1_000);
        committed = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(commitId)}`, { credentials: "same-origin" }),
          t("answerRequestFailed"),
        );
      }
      if (committed.state === "confirmed") {
        await queue.remove(currentRecord.queueId, principalId);
        setSavedCommit(null);
        clearReviewDraft("public", taskIdentity, publicDraftStorage);
        setStatus(t("recorded"));
        const receipt = {
          commitId,
          confirmedAt: typeof committed.confirmedAt === "string" ? committed.confirmedAt : null,
          transactionHash: typeof committed.transactionHash === "string" ? committed.transactionHash : null,
        };
        saveReviewReceipt("public", taskIdentity, receipt, { principalId });
        setSubmissionReceipt(receipt);
        onSubmitted();
      } else if (committed.state === "failed") {
        throw new Error(t("sponsoredFailedRetry"));
      } else {
        await scheduleRetry(currentRecord, "confirmation_pending");
      }
    } catch {
      setError(t("finishRecordingFailed"));
      if (savedCommit && savedCommit.principalId === principalId) {
        try {
          await scheduleRetry(savedCommit, "relay_failed");
        } catch {
          setStatus(t("retryUnavailable"));
          setError(t("savedSubmissionUpdateFailed"));
        }
      } else {
        setStatus(null);
      }
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function prepareRecoveryBackup() {
    if (
      paidAccess.state !== "ready" ||
      !answer ||
      !isPublicPredictionPercent(prediction) ||
      !mediaReady ||
      publicResponseIssue ||
      task.alreadyVouchered
    ) {
      return;
    }
    setBusy(true);
    setBusyLabel(t("creatingBackup"));
    setError(null);
    setStatus(t("creatingBackup"));
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession) throw new Error(t("signInBackup"));
      const response = createPublicRaterResponse(
        {
          operationKey: task.operationKey,
          roundId: task.roundId,
          contentId: task.contentId,
          rationale: task.question.rationale,
        },
        {
          category: feedbackBody.trim() ? feedbackCategory : null,
          body: feedbackBody,
          sourceUrl: sourceUrl || null,
          nonce: randomNonce(),
        },
      );
      const secrets = createTokenlessRaterRoundSecrets({
        roundId: BigInt(task.roundId),
        vote: answer === "yes" ? 1 : 0,
        predictedUpBps: prediction * 100,
        responseHash: response.responseHash,
      });
      const recoverySecret = generateDeviceRecoverySecret();
      const exported = await exportTokenlessRecoveryPackage(secrets, recoverySecret);
      const recoveryRecord = createDeviceRecoveryRecord({
        principalId: browserSession.principalId,
        roundId: task.roundId,
        voteKey: secrets.reveal.voteKey,
        recoveryPackage: exported,
      });
      setPreparedSubmission({
        binding: preparationBinding,
        principalId: browserSession.principalId,
        recoveryBackup: serializeDeviceRecoveryBackup(recoveryRecord, recoverySecret),
        recoveryRecord,
        response,
        secrets,
      });
      setRecoveryDownloaded(false);
      setRecoveryConfirmed(false);
      setStatus(t("backupReady"));
    } catch {
      setPreparedSubmission(null);
      setRecoveryDownloaded(false);
      setRecoveryConfirmed(false);
      setError(t("createBackupFailed"));
      setStatus(null);
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function confirmRecoveryBackup() {
    if (!activePreparedSubmission || !recoveryDownloaded || recoveryConfirmed || busy) return;
    setBusy(true);
    setBusyLabel(t("checkingAccount"));
    setError(null);
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== activePreparedSubmission.principalId) {
        setPreparedSubmission(null);
        setRecoveryDownloaded(false);
        setRecoveryConfirmed(false);
        setStatus(null);
        setError(t("accountChangedBackup"));
        return;
      }
      setRecoveryConfirmed(true);
      setStatus(t("backupConfirmed"));
    } catch {
      setError(t("confirmBackupFailed"));
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function saveRecoveryBackup() {
    if (!activePreparedSubmission || !recoveryUrl) return;
    const fileName = `rateloop-review-${taskIdentity}-backup.json`;
    const file = new File([activePreparedSubmission.recoveryBackup], fileName, { type: "application/json" });
    try {
      const savePicker = (
        window as typeof window & {
          showSaveFilePicker?: (options: {
            suggestedName: string;
            types: Array<{ description: string; accept: Record<string, string[]> }>;
          }) => Promise<{ createWritable(): Promise<{ write(value: File): Promise<void>; close(): Promise<void> }> }>;
        }
      ).showSaveFilePicker;
      if (savePicker) {
        const handle = await savePicker({
          suggestedName: fileName,
          types: [{ description: t("backupFile"), accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
      } else if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t("backupFile") });
      } else {
        const fallback = document.createElement("a");
        fallback.href = recoveryUrl;
        fallback.download = fileName;
        fallback.rel = "noopener";
        fallback.click();
      }
      setRecoveryDownloaded(true);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(t("saveBackupFailed"));
    }
  }

  async function submitPreparedResponse() {
    if (
      paidAccess.state !== "ready" ||
      !activePreparedSubmission ||
      !recoveryConfirmed ||
      !mediaReady ||
      task.alreadyVouchered
    ) {
      return;
    }
    let preparedForRetry = false;
    setBusy(true);
    setBusyLabel(t("submitting"));
    setError(null);
    setStatus(t("submitting"));
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== activePreparedSubmission.principalId) {
        setPreparedSubmission(null);
        setRecoveryDownloaded(false);
        setRecoveryConfirmed(false);
        throw new Error(t("signedInAccountChanged"));
      }
      const { response, secrets } = activePreparedSubmission;
      storeDeviceRecovery(activePreparedSubmission.recoveryRecord, browserSession.principalId);
      const sealed = await sealTokenlessReveal({
        material: secrets.reveal,
        drandNetwork: task.disclosureBeacon.network,
        beaconRound: task.disclosureBeacon.round,
      });
      const idempotencyBase = `voucher:web:${taskIdentity}`;
      const voucherBody = await readAnswerJson(
        await fetch("/api/rater/vouchers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyBase },
          body: JSON.stringify(
            buildPublicVoucherRequest(task, {
              idempotencyKey: idempotencyBase,
              voteKey: secrets.reveal.voteKey,
            }),
          ),
        }),
        t("answerRequestFailed"),
      );
      if (typeof voucherBody.voucherId !== "string") throw new Error(t("voucherIncomplete"));
      const voucher = voucherBody.voucher as { nullifier: `0x${string}` };
      const authorization = await signTokenlessCommit({
        secrets,
        sealedPayload: sealed.sealedPayload,
        drandNetwork: sealed.drandNetwork,
        beaconRound: sealed.beaconRound,
        chainId: task.chainId,
        panelAddress: task.panelAddress,
        nullifier: voucher.nullifier,
      });
      const publicAuthorization = { ...authorization, roundId: authorization.roundId.toString() };
      const idempotencyKey = `commit:web:${taskIdentity}:${authorization.voteKey.toLowerCase()}`;
      const queue = createIndexedDbTokenlessCommitQueue();
      const queueId = `commit:${taskIdentity}:${authorization.voteKey.toLowerCase()}`;
      const queuedCommit = await enqueueTokenlessCommit(queue, {
        queueId,
        principalId: browserSession.principalId,
        taskIdentity,
        roundId: authorization.roundId,
        commitDeadline: new Date(task.voucherDeadline),
        relayPayload: {
          idempotencyKey,
          voucherId: voucherBody.voucherId,
          authorization: publicAuthorization,
          response,
        },
      });
      setSavedCommit(queuedCommit);
      preparedForRetry = true;
      setPreparedSubmission(null);
      setRecoveryDownloaded(false);
      setRecoveryConfirmed(false);
      const committed = await readAnswerJson(
        await fetch("/api/rater/commits", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            idempotencyKey,
            voucherId: voucherBody.voucherId,
            authorization: publicAuthorization,
            response,
          }),
        }),
        t("answerRequestFailed"),
      );
      if (typeof committed.commitId !== "string") throw new Error(t("commitIncomplete"));
      let current = committed;
      for (let attempt = 0; attempt < 10 && current.state === "submitted"; attempt += 1) {
        await wait(1_000);
        current = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(committed.commitId)}`, {
            credentials: "same-origin",
          }),
          t("answerRequestFailed"),
        );
      }
      if (current.state === "confirmed") {
        await queue.remove(queueId, browserSession.principalId);
        setSavedCommit(null);
        clearReviewDraft("public", taskIdentity, publicDraftStorage);
        setStatus(t("recorded"));
        const receipt = {
          commitId: committed.commitId,
          confirmedAt: typeof current.confirmedAt === "string" ? current.confirmedAt : null,
          transactionHash: typeof current.transactionHash === "string" ? current.transactionHash : null,
        };
        saveReviewReceipt("public", taskIdentity, receipt, { principalId });
        setSubmissionReceipt(receipt);
        onSubmitted();
      } else if (current.state === "failed") {
        throw new Error(t("sponsoredFailedSaved"));
      } else {
        await scheduleRetry(queuedCommit, "confirmation_pending");
      }
    } catch {
      setError(t("recordFailed"));
      if (preparedForRetry) {
        try {
          const queued = await createIndexedDbTokenlessCommitQueue().list(principalId);
          const record = queued.find(value => queuedCommitMatchesPublicTask(value, taskScope));
          if (record) await scheduleRetry(record, "initial_relay_failed");
        } catch {
          setStatus(t("retryUnavailable"));
          setError(t("savedSubmissionUpdateFailed"));
        }
      } else {
        setStatus(null);
      }
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  const options =
    task.question.kind === "head_to_head"
      ? [task.question.optionA?.label ?? t("optionA"), task.question.optionB?.label ?? t("optionB")]
      : [task.question.positiveLabel ?? t("yes"), task.question.negativeLabel ?? t("no")];
  const feedbackMaximum = Math.min(
    (task.question.rationale?.mode === "optional" || task.question.rationale?.mode === "required"
      ? task.question.rationale.maxLength
      : undefined) ?? PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH,
    PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH,
  );
  const feedbackMinimum =
    task.question.rationale?.mode === "required" ? Math.max(1, task.question.rationale.minLength ?? 1) : 0;
  const feedbackIssue =
    task.question.rationale?.mode === "required" && feedbackBody.trim().length < feedbackMinimum
      ? t("feedbackMinimum", { count: feedbackMinimum })
      : feedbackBody.length > feedbackMaximum
        ? t("feedbackMaximum", { count: feedbackMaximum })
        : null;
  let sourceUrlIssue: string | null = null;
  if (sourceUrl.trim()) {
    if (!feedbackBody.trim()) {
      sourceUrlIssue = t("feedbackBeforeSource");
    } else {
      try {
        const parsed = new URL(sourceUrl.trim());
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
          sourceUrlIssue = t("sourceHttpsCredentials");
        }
      } catch {
        sourceUrlIssue = t("sourceValidHttps");
      }
    }
  }
  const publicResponseIssue = feedbackIssue ?? sourceUrlIssue;

  if (!networkAssignmentReady && networkAssignment) {
    const expired = Date.parse(networkAssignment.assignmentExpiresAt) <= Date.now();
    return (
      <Card as="section" className="rounded-lg p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">{t("paidReview")}</p>
        <h2 className="mt-3 text-xl font-semibold">{t("acceptTitle")}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/65">{t("acceptDescription")}</p>
        <dl className="mt-4 grid gap-2 text-xs text-base-content/60">
          <div>
            <dt className="inline font-semibold text-base-content/80">{t("assignment")} </dt>
            <dd className="inline font-mono">{networkAssignment.assignmentId}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-base-content/80">{t("terms")} </dt>
            <dd className="inline break-all font-mono">{networkAssignment.confidentialityTermsHash}</dd>
          </div>
        </dl>
        <label className="mt-5 flex items-start gap-3 text-sm" htmlFor={termsControlId}>
          <ChoiceInput
            id={termsControlId}
            type="checkbox"
            className="checkbox checkbox-sm mt-0.5"
            checked={networkTermsAccepted}
            disabled={busy || expired}
            onChange={event => setNetworkTermsAccepted(event.target.checked)}
          />
          <span>{t("acceptTerms")}</span>
        </label>
        <Button
          type="button"
          variant="primary"
          className="mt-4"
          disabled={!networkTermsAccepted || busy || expired}
          onClick={() => void acceptNetworkAssignment()}
        >
          {busy ? (busyLabel ?? t("accepting")) : expired ? t("expired") : t("acceptOpen")}
        </Button>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <ReviewerShell
      advanceDisabled={
        paidAccess.state !== "ready" ||
        busy ||
        (Boolean(savedCommit) && !retryAvailable) ||
        (!savedCommit &&
          (!answer ||
            !isPublicPredictionPercent(prediction) ||
            !mediaReady ||
            Boolean(publicResponseIssue) ||
            task.alreadyVouchered ||
            (Boolean(activePreparedSubmission) && !recoveryConfirmed)))
      }
      advanceLabel={
        paidAccess.state !== "ready"
          ? t("paidRequired")
          : savedCommit
            ? t("retry")
            : task.alreadyVouchered
              ? t("noSaved")
              : activePreparedSubmission
                ? recoveryConfirmed
                  ? t("submitRating")
                  : recoveryDownloaded
                    ? t("confirmBackupAbove")
                    : t("downloadBackupAbove")
                : t("createBackup")
      }
      busyLabel={busy ? (busyLabel ?? t("working")) : null}
      caseIndex={0}
      laneHeader={
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">{t("publicReview")}</p>
          <p className="mt-1 text-sm text-base-content/60">
            {t("guaranteed", { amount: `$${usdc(task.earnings.guaranteedBaseAtomic)}` })}
          </p>
          <DeadlineChip deadline={task.voucherDeadline} label={t("submit")} />
        </>
      }
      onAdvance={() =>
        void (savedCommit
          ? retrySavedCommit()
          : activePreparedSubmission && recoveryConfirmed
            ? submitPreparedResponse()
            : prepareRecoveryBackup())
      }
      onSelectFirst={() => paidAccess.state === "ready" && setAnswer("yes")}
      onSelectSecond={() => paidAccess.state === "ready" && setAnswer("no")}
      rationaleRef={rationaleRef}
      shortcutsEnabled={shortcutsEnabled}
      totalCases={1}
    >
      <article className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_17.25rem] xl:items-start">
        <Card as="section" className="min-h-72 rounded-lg p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/55">
            <span>{t("publicPanel")}</span>
            <span>{t("round", { round: task.roundId })}</span>
          </div>
          <h2 className="mt-8 max-w-3xl text-2xl font-semibold leading-tight sm:text-3xl">{task.question.prompt}</h2>
          {task.question.media ? (
            <>
              <QuestionMedia
                key={`${mediaIdentity}:${mediaRetryAttempt}`}
                media={task.question.media}
                onReviewStateChange={handleMediaReview}
              />
              {currentMediaReview.status === "pending" ? (
                <p className="mt-3 text-sm text-base-content/55" role="status">
                  {task.question.media.kind === "youtube" ? t("mediaLoadVideo") : t("mediaLoadingImages")}
                </p>
              ) : null}
              {currentMediaReview.status === "error" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-error" role="alert">
                    {currentMediaReview.message}
                  </p>
                  <Button variant="secondary" size="none" className="btn-xs" type="button" onClick={retryMedia}>
                    {t("retryMedia")}
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
          <p className="mt-5 text-sm leading-6 text-base-content/55">{t("instructions")}</p>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-base-content/10 pt-4 text-xs text-base-content/55">
            <span>{t("qualityBonus", { amount: `$${usdc(task.earnings.possibleBonusAtomic)}` })}</span>
            <span>{t("surpriseBonus", { amount: `$${usdc(task.earnings.possibleSurpriseBonusAtomic)}` })}</span>
            <span>{t("attempt", { amount: `$${usdc(task.earnings.attemptCompensationAtomic)}` })}</span>
          </div>
        </Card>

        <Card className="rounded-lg p-4 sm:p-5">
          {paidAccess.state === "ready" ? (
            <>
              <p className="text-sm font-semibold">{t("yourRating")}</p>
              <p className="mt-1 text-xs text-base-content/55">{t("ratingPrivacy")}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={answer === value}
                    className={`tab-control flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-semibold transition-colors ${
                      answer === value
                        ? value === "yes"
                          ? "border-transparent bg-[var(--rateloop-green)] text-[var(--rateloop-active-control-text)]"
                          : "border-transparent bg-[var(--rateloop-pink)] text-[var(--rateloop-active-control-text)]"
                        : "pill-inactive"
                    }`}
                    onClick={() => setAnswer(value)}
                  >
                    <ThumbIcon down={value === "no"} />
                    {options[index]}
                  </button>
                ))}
              </div>
              {answer ? (
                <CrowdForecastField
                  accessibleLabel={forecastT("question", { label: options[0] })}
                  positiveLabel={options[0]}
                  privacyContext={PUBLIC_PAID_REVIEW_PRIVACY_CONTEXT}
                  value={prediction}
                  onChange={setPrediction}
                />
              ) : null}
              {feedbackEnabled && answer && !feedbackOpen ? (
                <button
                  type="button"
                  className="mt-4 text-xs font-medium underline underline-offset-4"
                  onClick={() => setFeedbackOpen(true)}
                >
                  {t("addFeedback")}
                </button>
              ) : null}
              {feedbackEnabled && feedbackOpen ? (
                <fieldset className="mt-5 border-t border-base-content/10 pt-4">
                  <legend className="text-xs font-semibold">
                    {task.question.rationale?.mode === "required" ? t("feedbackRequired") : t("feedbackOptional")}
                  </legend>
                  <SelectField
                    containerClassName="mt-3"
                    className="select-sm border-base-content/10 bg-[var(--rateloop-field)]"
                    label={t("feedbackCategory")}
                    labelClassName="sr-only"
                    value={feedbackCategory}
                    onChange={event => setFeedbackCategory(event.target.value as PublicRaterResponseCategory)}
                  >
                    {PUBLIC_RATER_RESPONSE_CATEGORIES.map(category => (
                      <option key={category} value={category}>
                        {category.replace("_", " ")}
                      </option>
                    ))}
                  </SelectField>
                  <TextareaField
                    ref={rationaleRef}
                    containerClassName="mt-2"
                    className="min-h-28 border-base-content/10 bg-[var(--rateloop-field)]"
                    label={t("feedback")}
                    labelClassName="sr-only"
                    error={feedbackIssue}
                    value={feedbackBody}
                    onChange={event => setFeedbackBody(event.target.value)}
                    minLength={
                      task.question.rationale?.mode === "required" ? (task.question.rationale.minLength ?? 1) : 0
                    }
                    maxLength={feedbackMaximum}
                    placeholder={t("feedbackPlaceholder")}
                  />
                  <div className="text-right text-[11px] text-base-content/55">
                    {feedbackBody.length}/{feedbackMaximum}
                  </div>
                  <Field
                    type="url"
                    containerClassName="mt-2"
                    className="input-sm border-base-content/10 bg-[var(--rateloop-field)]"
                    label={t("sourceUrl")}
                    labelClassName="sr-only"
                    error={sourceUrlIssue}
                    value={sourceUrl}
                    onChange={event => setSourceUrl(event.target.value)}
                    maxLength={2_048}
                    placeholder={t("sourcePlaceholder")}
                  />
                </fieldset>
              ) : null}
              {answer ? (
                <section
                  className="mt-5 rounded-lg border border-[var(--rateloop-blue)]/30 bg-[var(--rateloop-blue)]/[0.06] p-3 text-xs leading-5"
                  aria-labelledby={recordsHeadingId}
                >
                  <h3 id={recordsHeadingId} className="font-semibold">
                    {t("publicTitle")}
                  </h3>
                  <p className="mt-2 text-base-content/70">{t("publicDescription")}</p>
                  <Link href="/legal/privacy#on-chain-data" className="mt-2 inline-block underline underline-offset-4">
                    {t("privacyNotice")}
                  </Link>
                </section>
              ) : null}
              {recoveryUrl && activePreparedSubmission ? (
                <div className="mt-5 rounded-lg border border-base-content/10 p-3">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--rateloop-blue)]">
                    {t("backupStep")}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-base-content/60">{t("backupDescription")}</p>
                  <a
                    href={recoveryUrl}
                    download={`rateloop-review-${taskIdentity}-backup.json`}
                    className="mt-3 block text-center text-xs font-medium underline underline-offset-4"
                    onClick={event => {
                      event.preventDefault();
                      void saveRecoveryBackup();
                    }}
                  >
                    {t("downloadBackup")}
                  </a>
                  <label className="mt-3 flex items-start gap-2 text-xs leading-5" htmlFor={recoveryConfirmationId}>
                    <ChoiceInput
                      id={recoveryConfirmationId}
                      type="checkbox"
                      className="checkbox checkbox-xs mt-0.5"
                      checked={recoveryConfirmed}
                      disabled={!recoveryDownloaded || recoveryConfirmed || busy}
                      onChange={event => event.target.checked && void confirmRecoveryBackup()}
                    />
                    <span>{t("backupSaved")}</span>
                  </label>
                  {recoveryConfirmed ? (
                    <p className="mt-3 border-t border-base-content/10 pt-3 font-mono text-[11px] uppercase tracking-widest text-[var(--rateloop-green)]">
                      {t("submitStep")}
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] leading-4 text-base-content/55">{t("backupGate")}</p>
                  )}
                </div>
              ) : null}
              {status && !submissionReceipt ? (
                <p role="status" className="mt-3 text-xs leading-5 text-success">
                  {status}
                </p>
              ) : null}
              {submissionReceipt ? (
                <section
                  className="mt-3 rounded-lg border border-success/20 bg-success/[0.06] p-3 text-xs"
                  aria-label={t("receipt")}
                >
                  <p className="font-semibold text-success">{t("recorded")}</p>
                  <dl className="mt-2 grid gap-2">
                    <div>
                      <dt className="text-base-content/55">{t("commitReceipt")}</dt>
                      <dd className="mt-0.5 break-all font-mono">{submissionReceipt.commitId}</dd>
                    </div>
                    {submissionReceipt.confirmedAt ? (
                      <div>
                        <dt className="text-base-content/55">{t("confirmed")}</dt>
                        <dd className="mt-0.5">
                          <time dateTime={submissionReceipt.confirmedAt}>
                            {format.dateTime(new Date(submissionReceipt.confirmedAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </time>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {submissionReceipt.transactionHash ? (
                    <a
                      className="mt-2 inline-block underline underline-offset-4"
                      href={`https://sepolia.basescan.org/tx/${submissionReceipt.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("viewTransaction")}
                    </a>
                  ) : null}
                </section>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 text-xs leading-5 text-error">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-52 flex-col justify-center">
              <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-yellow)]">
                {t("paidWork")}
              </p>
              <h3 className="mt-2 text-lg font-semibold">
                {paidAccess.state === "payout_wallet_required"
                  ? t("addWallet")
                  : paidAccess.eligibilityStatus === "expired"
                    ? t("renew")
                    : paidAccess.eligibilityStatus === "review"
                      ? t("reviewPending")
                      : paidAccess.eligibilityStatus === "blocked"
                        ? t("unavailable")
                        : t("completeEligibility")}
              </h3>
              <p className="mt-3 text-xs leading-5 text-base-content/55">
                {paidAccess.state === "payout_wallet_required" ? t("walletDescription") : t("eligibilityDescription")}
              </p>
              <Button
                as={Link}
                variant="primary"
                size="none"
                block
                className="mt-5 text-center text-sm"
                href={
                  paidAccess.state === "payout_wallet_required"
                    ? "/settings/wallets?use=payout"
                    : "/human/profile?section=paid-work"
                }
              >
                {paidAccess.state === "payout_wallet_required" ? t("addWallet") : t("reviewAccess")}
              </Button>
            </div>
          )}
        </Card>
      </article>
    </ReviewerShell>
  );
}
