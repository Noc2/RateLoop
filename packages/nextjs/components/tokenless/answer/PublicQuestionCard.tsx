"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { shouldInspectReservedVoucher } from "./publicSubmissionReceipt";
import type { Hex } from "viem";
import { type PublicQuestionMedia, QuestionMedia } from "~~/components/tokenless/answer/QuestionMedia";
import { ChoiceInput, Field, SelectField, TextareaField } from "~~/components/tokenless/forms/Field";
import { CrowdForecastField, isCrowdForecastPercent } from "~~/components/tokenless/review/CrowdForecastField";
import { DeadlineChip } from "~~/components/tokenless/review/DeadlineChip";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Card } from "~~/components/tokenless/ui/Card";
import { readBrowserSession } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";
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
    | { reviewerSource: "customer_invited" }
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

function readAnswerJson(response: Response) {
  return readJson(response, { errorFields: ["message"], fallbackMessage: "Answer request failed." });
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

  useEffect(() => {
    const receipt = loadReviewReceipt("public", task.roundId, isPublicSubmissionReceipt, { principalId });
    setSubmissionReceipt(receipt);
    if (receipt) {
      setStatus("Recorded");
      setError(null);
    }
  }, [principalId, task.roundId]);

  // Acceptance of the paid-review terms must never carry across a different round or a different
  // signed-in reviewer. It must survive a re-render caused by a queue reload of the same round,
  // which replaces `task` with an equal but freshly parsed object.
  useEffect(() => {
    setNetworkTermsAccepted(false);
  }, [principalId, task.roundId]);

  useEffect(() => {
    const draft = loadReviewDraft("public", task.roundId, isPublicReviewDraft, publicDraftStorage);
    if (draft) {
      setAnswer(draft.answer);
      setPrediction(draft.prediction);
      setFeedbackCategory(draft.feedbackCategory);
      setFeedbackBody(draft.feedbackBody);
      setSourceUrl(draft.sourceUrl);
      if (draft.feedbackBody || draft.sourceUrl) setFeedbackOpen(true);
    }
    setDraftRestored(true);
  }, [publicDraftStorage, task.roundId]);

  useEffect(() => {
    if (!draftRestored) return;
    saveReviewDraft(
      "public",
      task.roundId,
      { answer, prediction, feedbackCategory, feedbackBody, sourceUrl },
      publicDraftStorage,
    );
  }, [answer, draftRestored, feedbackBody, feedbackCategory, prediction, publicDraftStorage, sourceUrl, task.roundId]);

  useEffect(() => {
    if (!preparedSubmission || preparedSubmission.binding === preparationBinding) return;
    setPreparedSubmission(null);
    setRecoveryDownloaded(false);
    setRecoveryConfirmed(false);
    setStatus("Rating changed. Create a new recovery backup before submitting.");
  }, [preparationBinding, preparedSubmission]);

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
      const record = records.find(value => value.roundId === task.roundId) ?? null;
      setSavedCommit(record);
      const isDue = Boolean(record && dueRecords.some(value => value.queueId === record.queueId));
      setRetryClock(Date.now());
      setStatus(
        record
          ? isDue
            ? "Ready to retry"
            : "Retry scheduled"
          : Date.parse(task.voucherDeadline) <= Date.now()
            ? "Submission expired"
            : "No saved submission",
      );
    });
    return () => {
      active = false;
    };
  }, [principalId, submissionReceipt, task.alreadyVouchered, task.roundId, task.voucherDeadline]);

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
      setStatus("Submission expired");
      return;
    }
    setSavedCommit(failure.record);
    setRetryClock(Date.now());
    setStatus(`Retry available after ${new Date(failure.record.nextAttemptAt).toLocaleTimeString()}`);
  }

  async function acceptNetworkAssignment() {
    if (!networkAssignment || !networkTermsAccepted || busy) return;
    setBusy(true);
    setBusyLabel("Accepting…");
    setError(null);
    setStatus("Accepting paid review…");
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== principalId) {
        throw new Error("Your account changed. Reload this review before accepting it.");
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
      );
      if (result.accepted !== true || result.assignmentId !== networkAssignment.assignmentId) {
        throw new Error("Assignment acceptance response is incomplete.");
      }
      setAcceptedAssignmentId(networkAssignment.assignmentId);
      setNetworkTermsAccepted(false);
      setStatus(result.replay === true ? "Assignment already accepted" : "Assignment accepted");
    } catch (cause) {
      setAcceptedAssignmentId(null);
      setStatus(null);
      setError(cause instanceof Error ? cause.message : "The paid review could not be accepted.");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function retrySavedCommit() {
    if (!savedCommit) return;
    setBusy(true);
    setBusyLabel("Retrying…");
    setError(null);
    setStatus("Submitting…");
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== principalId) {
        setSavedCommit(null);
        setError("Your account changed. Reopen this review before retrying.");
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
            ? `Retry available after ${new Date(retained.nextAttemptAt).toLocaleTimeString()}`
            : "Submission expired",
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
      );
      if (typeof committed.commitId !== "string") throw new Error("Commit response is incomplete.");
      const commitId = committed.commitId;
      for (let attempt = 0; attempt < 10 && committed.state === "submitted"; attempt += 1) {
        await wait(1_000);
        committed = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(commitId)}`, { credentials: "same-origin" }),
        );
      }
      if (committed.state === "confirmed") {
        await queue.remove(currentRecord.queueId, principalId);
        setSavedCommit(null);
        clearReviewDraft("public", task.roundId, publicDraftStorage);
        setStatus("Recorded");
        const receipt = {
          commitId,
          confirmedAt: typeof committed.confirmedAt === "string" ? committed.confirmedAt : null,
          transactionHash: typeof committed.transactionHash === "string" ? committed.transactionHash : null,
        };
        saveReviewReceipt("public", task.roundId, receipt, { principalId });
        setSubmissionReceipt(receipt);
        onSubmitted();
      } else if (committed.state === "failed") {
        throw new Error("The sponsored transaction failed. The prepared submission remains saved for retry.");
      } else {
        await scheduleRetry(currentRecord, "confirmation_pending");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t finish recording your rating. Try again.");
      if (savedCommit && savedCommit.principalId === principalId) {
        try {
          await scheduleRetry(savedCommit, "relay_failed");
        } catch {
          setStatus("Retry unavailable");
          setError("The saved submission could not be updated. Refocus this tab and try again.");
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
      publicResponseIssue ||
      task.alreadyVouchered
    ) {
      return;
    }
    setBusy(true);
    setBusyLabel("Creating backup…");
    setError(null);
    setStatus("Creating backup…");
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession) throw new Error("Sign in again before creating recovery material.");
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
      setStatus("Backup ready");
    } catch (cause) {
      setPreparedSubmission(null);
      setRecoveryDownloaded(false);
      setRecoveryConfirmed(false);
      setError(cause instanceof Error ? cause.message : "We couldn’t create your recovery backup. Try again.");
      setStatus(null);
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function confirmRecoveryBackup() {
    if (!activePreparedSubmission || !recoveryDownloaded || recoveryConfirmed || busy) return;
    setBusy(true);
    setBusyLabel("Checking account…");
    setError(null);
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== activePreparedSubmission.principalId) {
        setPreparedSubmission(null);
        setRecoveryDownloaded(false);
        setRecoveryConfirmed(false);
        setStatus(null);
        setError("Your account changed. Create a new recovery backup before submitting.");
        return;
      }
      setRecoveryConfirmed(true);
      setStatus("Backup confirmed");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t confirm the recovery backup. Try again.");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function saveRecoveryBackup() {
    if (!activePreparedSubmission || !recoveryUrl) return;
    const fileName = `rateloop-review-${task.roundId}-backup.json`;
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
          types: [{ description: "RateLoop recovery backup", accept: { "application/json": [".json"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(file);
        await writable.close();
      } else if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "RateLoop recovery backup" });
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
      setError(cause instanceof Error ? cause.message : "The recovery backup could not be saved.");
    }
  }

  async function submitPreparedResponse() {
    if (paidAccess.state !== "ready" || !activePreparedSubmission || !recoveryConfirmed || task.alreadyVouchered) {
      return;
    }
    let preparedForRetry = false;
    setBusy(true);
    setBusyLabel("Submitting…");
    setError(null);
    setStatus("Submitting…");
    try {
      const browserSession = await readBrowserSession();
      if (!browserSession || browserSession.principalId !== activePreparedSubmission.principalId) {
        setPreparedSubmission(null);
        setRecoveryDownloaded(false);
        setRecoveryConfirmed(false);
        throw new Error("The signed-in account changed. Create a new recovery backup for this account.");
      }
      const { response, secrets } = activePreparedSubmission;
      storeDeviceRecovery(activePreparedSubmission.recoveryRecord, browserSession.principalId);
      const sealed = await sealTokenlessReveal({
        material: secrets.reveal,
        drandNetwork: task.disclosureBeacon.network,
        beaconRound: task.disclosureBeacon.round,
      });
      const idempotencyBase = `voucher:web:${task.roundId}`;
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
      );
      if (typeof voucherBody.voucherId !== "string") throw new Error("Voucher response is incomplete.");
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
      const idempotencyKey = `commit:web:${task.roundId}:${authorization.voteKey.toLowerCase()}`;
      const queue = createIndexedDbTokenlessCommitQueue();
      const queueId = `commit:${task.roundId}:${authorization.voteKey.toLowerCase()}`;
      const queuedCommit = await enqueueTokenlessCommit(queue, {
        queueId,
        principalId: browserSession.principalId,
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
      );
      if (typeof committed.commitId !== "string") throw new Error("Commit response is incomplete.");
      let current = committed;
      for (let attempt = 0; attempt < 10 && current.state === "submitted"; attempt += 1) {
        await wait(1_000);
        current = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(committed.commitId)}`, {
            credentials: "same-origin",
          }),
        );
      }
      if (current.state === "confirmed") {
        await queue.remove(queueId, browserSession.principalId);
        setSavedCommit(null);
        clearReviewDraft("public", task.roundId, publicDraftStorage);
        setStatus("Recorded");
        const receipt = {
          commitId: committed.commitId,
          confirmedAt: typeof current.confirmedAt === "string" ? current.confirmedAt : null,
          transactionHash: typeof current.transactionHash === "string" ? current.transactionHash : null,
        };
        saveReviewReceipt("public", task.roundId, receipt, { principalId });
        setSubmissionReceipt(receipt);
        onSubmitted();
      } else if (current.state === "failed") {
        throw new Error(
          "The sponsored transaction failed. Your prepared submission is saved on this device for retry.",
        );
      } else {
        await scheduleRetry(queuedCommit, "confirmation_pending");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t record your rating. Try again.");
      if (preparedForRetry) {
        try {
          const queued = await createIndexedDbTokenlessCommitQueue().list(principalId);
          const record = queued.find(value => value.roundId === task.roundId);
          if (record) await scheduleRetry(record, "initial_relay_failed");
        } catch {
          setStatus("Retry unavailable");
          setError("The saved submission could not be updated. Refocus this tab and try again.");
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
      ? [task.question.optionA?.label ?? "Option A", task.question.optionB?.label ?? "Option B"]
      : [task.question.positiveLabel ?? "Yes", task.question.negativeLabel ?? "No"];
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
      ? `Feedback must contain at least ${feedbackMinimum} character${feedbackMinimum === 1 ? "" : "s"}.`
      : feedbackBody.length > feedbackMaximum
        ? `Feedback must contain at most ${feedbackMaximum} characters.`
        : null;
  let sourceUrlIssue: string | null = null;
  if (sourceUrl.trim()) {
    if (!feedbackBody.trim()) {
      sourceUrlIssue = "Add feedback before adding a source URL.";
    } else {
      try {
        const parsed = new URL(sourceUrl.trim());
        if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
          sourceUrlIssue = "Source URL must use HTTPS and must not contain credentials.";
        }
      } catch {
        sourceUrlIssue = "Source URL must be a valid HTTPS URL.";
      }
    }
  }
  const publicResponseIssue = feedbackIssue ?? sourceUrlIssue;

  if (!networkAssignmentReady && networkAssignment) {
    const expired = Date.parse(networkAssignment.assignmentExpiresAt) <= Date.now();
    return (
      <Card as="section" className="rounded-lg p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Public paid review</p>
        <h2 className="mt-3 text-xl font-semibold">Accept this funded review before opening it</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/65">
          This reserves your assigned seat. The question contains only public, synthetic, or safely redacted material.
          Your sealed rating is linked to the immutable assignment and settlement terms identified below.
        </p>
        <dl className="mt-4 grid gap-2 text-xs text-base-content/60">
          <div>
            <dt className="inline font-semibold text-base-content/80">Assignment: </dt>
            <dd className="inline font-mono">{networkAssignment.assignmentId}</dd>
          </div>
          <div>
            <dt className="inline font-semibold text-base-content/80">Terms: </dt>
            <dd className="inline break-all font-mono">{networkAssignment.confidentialityTermsHash}</dd>
          </div>
        </dl>
        <label className="mt-5 flex items-start gap-3 text-sm" htmlFor={`public-review-terms-${task.roundId}`}>
          <ChoiceInput
            id={`public-review-terms-${task.roundId}`}
            type="checkbox"
            className="checkbox checkbox-sm mt-0.5"
            checked={networkTermsAccepted}
            disabled={busy || expired}
            onChange={event => setNetworkTermsAccepted(event.target.checked)}
          />
          <span>I accept the exact public paid-review terms for this assignment.</span>
        </label>
        <button
          type="button"
          className="btn btn-sm mt-4 rateloop-primary-action"
          disabled={!networkTermsAccepted || busy || expired}
          onClick={() => void acceptNetworkAssignment()}
        >
          {busy ? (busyLabel ?? "Accepting…") : expired ? "Assignment expired" : "Accept and open review"}
        </button>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">
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
            Boolean(publicResponseIssue) ||
            task.alreadyVouchered ||
            (Boolean(activePreparedSubmission) && !recoveryConfirmed)))
      }
      advanceLabel={
        paidAccess.state !== "ready"
          ? "Paid work required"
          : savedCommit
            ? "Retry submission"
            : task.alreadyVouchered
              ? "No saved submission"
              : activePreparedSubmission
                ? recoveryConfirmed
                  ? "Submit rating"
                  : recoveryDownloaded
                    ? "Confirm backup above"
                    : "Download backup above"
                : "Create recovery backup"
      }
      busyLabel={busy ? (busyLabel ?? "Working…") : null}
      caseIndex={0}
      laneHeader={
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Public review</p>
          <p className="mt-1 text-sm text-base-content/60">Guaranteed ${usdc(task.earnings.guaranteedBaseAtomic)}</p>
          <DeadlineChip deadline={task.voucherDeadline} label="Submit" />
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
            <span>Public panel</span>
            <span>Round {task.roundId}</span>
          </div>
          <h2 className="mt-8 max-w-3xl text-2xl font-semibold leading-tight sm:text-3xl">{task.question.prompt}</h2>
          {task.question.media ? <QuestionMedia media={task.question.media} /> : null}
          <p className="mt-5 text-sm leading-6 text-base-content/55">
            Choose one answer, then estimate how the panel will respond. Public questions contain only public,
            synthetic, or safely redacted material.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-base-content/55">
            <span>Guaranteed ${usdc(task.earnings.guaranteedBaseAtomic)}</span>
            <span>Quality bonus up to ${usdc(task.earnings.possibleBonusAtomic)}</span>
            <span>Conditional surprise bonus up to ${usdc(task.earnings.possibleSurpriseBonusAtomic)}</span>
            <span>Attempt ${usdc(task.earnings.attemptCompensationAtomic)}</span>
          </div>
        </Card>

        <Card className="rounded-lg p-4 sm:p-5">
          {paidAccess.state === "ready" ? (
            <>
              <p className="text-sm font-semibold">Your rating</p>
              <p className="mt-1 text-xs text-base-content/55">Rating hidden until settlement.</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["yes", "no"] as const).map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={answer === value}
                    className={`tab-control flex items-center justify-center gap-1.5 px-3 py-3 text-sm font-semibold transition-colors ${
                      answer === value
                        ? value === "yes"
                          ? "border-transparent bg-[var(--rateloop-green)] text-black"
                          : "border-transparent bg-[var(--rateloop-pink)] text-white"
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
                  accessibleLabel={`What percentage of reviewers do you expect to choose “${options[0]}”?`}
                  positiveLabel={options[0]}
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
                  Add feedback
                </button>
              ) : null}
              {feedbackEnabled && feedbackOpen ? (
                <fieldset className="mt-5 border-t border-white/10 pt-4">
                  <legend className="text-xs font-semibold">
                    {task.question.rationale?.mode === "required" ? "Feedback required" : "Optional feedback"}
                  </legend>
                  <SelectField
                    containerClassName="mt-3"
                    className="select-sm border-white/10 bg-[var(--rateloop-field)]"
                    label="Feedback category"
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
                    className="min-h-28 border-white/10 bg-[var(--rateloop-field)]"
                    label="Feedback"
                    labelClassName="sr-only"
                    error={feedbackIssue}
                    value={feedbackBody}
                    onChange={event => setFeedbackBody(event.target.value)}
                    minLength={
                      task.question.rationale?.mode === "required" ? (task.question.rationale.minLength ?? 1) : 0
                    }
                    maxLength={feedbackMaximum}
                    placeholder="Opinion, evidence, ambiguity, or concerns…"
                  />
                  <div className="text-right text-[11px] text-base-content/55">
                    {feedbackBody.length}/{feedbackMaximum}
                  </div>
                  <Field
                    type="url"
                    containerClassName="mt-2"
                    className="input-sm border-white/10 bg-[var(--rateloop-field)]"
                    label="Source URL"
                    labelClassName="sr-only"
                    error={sourceUrlIssue}
                    value={sourceUrl}
                    onChange={event => setSourceUrl(event.target.value)}
                    maxLength={2_048}
                    placeholder="HTTPS source, optional"
                  />
                </fieldset>
              ) : null}
              <section
                className="mt-5 rounded-lg border border-[var(--rateloop-blue)]/30 bg-[var(--rateloop-blue)]/[0.06] p-3 text-xs leading-5"
                aria-labelledby={`public-records-${task.roundId}`}
              >
                <h3 id={`public-records-${task.roundId}`} className="font-semibold">
                  What becomes public
                </h3>
                <p className="mt-2 text-base-content/70">
                  Submitting a paid rating publishes a tlock ciphertext containing your vote, crowd forecast, response
                  hash, per-round payout address, and salt. It becomes publicly decryptable after the commit deadline
                  even if no keeper or reviewer submits a reveal. A reveal publishes the plaintext. Public blockchain
                  records generally cannot be erased.
                </p>
                <Link href="/legal/privacy#on-chain-data" className="mt-2 inline-block underline underline-offset-4">
                  Read the privacy notice
                </Link>
              </section>
              {recoveryUrl && activePreparedSubmission ? (
                <div className="mt-5 rounded-lg border border-white/10 p-3">
                  <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--rateloop-blue)]">
                    Step 1 of 2 · Save backup
                  </p>
                  <p className="mt-2 text-xs leading-5 text-base-content/60">
                    Save this file. It contains the only recovery secret for this rating.
                  </p>
                  <a
                    href={recoveryUrl}
                    download={`rateloop-review-${task.roundId}-backup.json`}
                    className="mt-3 block text-center text-xs font-medium underline underline-offset-4"
                    onClick={event => {
                      event.preventDefault();
                      void saveRecoveryBackup();
                    }}
                  >
                    Download recovery backup
                  </a>
                  <label
                    className="mt-3 flex items-start gap-2 text-xs leading-5"
                    htmlFor={`public-review-recovery-confirmed-${task.roundId}`}
                  >
                    <ChoiceInput
                      id={`public-review-recovery-confirmed-${task.roundId}`}
                      type="checkbox"
                      className="checkbox checkbox-xs mt-0.5"
                      checked={recoveryConfirmed}
                      disabled={!recoveryDownloaded || recoveryConfirmed || busy}
                      onChange={event => event.target.checked && void confirmRecoveryBackup()}
                    />
                    <span>I saved the recovery backup</span>
                  </label>
                  {recoveryConfirmed ? (
                    <p className="mt-3 border-t border-white/10 pt-3 font-mono text-[11px] uppercase tracking-widest text-[var(--rateloop-green)]">
                      Step 2 of 2 · Submit rating
                    </p>
                  ) : (
                    <p className="mt-2 text-[11px] leading-4 text-base-content/55">
                      No voucher or commit is requested until you confirm the backup.
                    </p>
                  )}
                </div>
              ) : null}
              {status ? (
                <p role="status" className="mt-3 text-xs leading-5 text-emerald-100">
                  {status}
                </p>
              ) : null}
              {submissionReceipt ? (
                <section
                  className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-3 text-xs"
                  aria-label="Submission receipt"
                >
                  <p className="font-semibold text-emerald-100">Rating recorded</p>
                  <dl className="mt-2 grid gap-2">
                    <div>
                      <dt className="text-base-content/55">Commit receipt</dt>
                      <dd className="mt-0.5 break-all font-mono">{submissionReceipt.commitId}</dd>
                    </div>
                    {submissionReceipt.confirmedAt ? (
                      <div>
                        <dt className="text-base-content/55">Confirmed</dt>
                        <dd className="mt-0.5">
                          <time dateTime={submissionReceipt.confirmedAt}>
                            {new Date(submissionReceipt.confirmedAt).toLocaleString()}
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
                      View confirmed transaction
                    </a>
                  ) : null}
                </section>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 text-xs leading-5 text-red-100">
                  {error}
                </p>
              ) : null}
              <Link
                href="/human/profile?section=paid-work"
                className="mt-4 block text-center text-xs underline underline-offset-4"
              >
                Paid-work eligibility
              </Link>
            </>
          ) : (
            <div className="flex min-h-52 flex-col justify-center">
              <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-yellow)]">Paid work</p>
              <h3 className="mt-2 text-lg font-semibold">
                {paidAccess.state === "payout_wallet_required"
                  ? "Add a payout wallet"
                  : paidAccess.eligibilityStatus === "expired"
                    ? "Renew paid-work access"
                    : paidAccess.eligibilityStatus === "review"
                      ? "Eligibility review pending"
                      : paidAccess.eligibilityStatus === "blocked"
                        ? "Paid work unavailable"
                        : "Complete paid-work eligibility"}
              </h3>
              <p className="mt-3 text-xs leading-5 text-base-content/55">
                {paidAccess.state === "payout_wallet_required"
                  ? "Public reviews can be browsed now. Add a purpose-bound wallet before submitting paid work."
                  : "Every paid-work check must be complete before RateLoop issues your first voucher."}
              </p>
              <Link
                href={
                  paidAccess.state === "payout_wallet_required"
                    ? "/settings/wallets?use=payout"
                    : "/human/profile?section=paid-work"
                }
                className="rateloop-gradient-action mt-5 w-full px-4 text-center text-sm"
              >
                {paidAccess.state === "payout_wallet_required" ? "Add payout wallet" : "Review paid-work access"}
              </Link>
            </div>
          )}
        </Card>
      </article>
    </ReviewerShell>
  );
}
