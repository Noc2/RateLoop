"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { type PublicQuestionMedia, QuestionMedia } from "~~/components/tokenless/answer/QuestionMedia";
import { DeadlineChip } from "~~/components/tokenless/review/DeadlineChip";
import { ReviewerShell } from "~~/components/tokenless/review/ReviewerShell";
import { Card } from "~~/components/tokenless/ui/Card";
import { readBrowserSession } from "~~/lib/auth/client";
import { readJson } from "~~/lib/tokenless/http";
import {
  createIndexedDbTokenlessCommitQueue,
  createTokenlessRaterRoundSecrets,
  enqueueTokenlessCommit,
  exportTokenlessRecoveryPackage,
  sealTokenlessReveal,
  signTokenlessCommit,
} from "~~/lib/tokenless/rater";
import {
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
import { formatUsdcAtomic } from "~~/lib/tokenless/usdc";

export type PublicAnswerTask = {
  operationKey: string;
  chainId: number;
  panelAddress: `0x${string}`;
  roundId: string;
  contentId: `0x${string}`;
  reviewerSource: "customer_invited" | "rateloop_network";
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
  beacon: { network: "quicknet-t"; round: number };
};

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

function isPublicReviewDraft(value: unknown): value is PublicReviewDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<PublicReviewDraft>;
  return (
    [null, "yes", "no"].includes(draft.answer ?? null) &&
    (draft.prediction === null || [10, 30, 50, 70, 90].includes(draft.prediction ?? -1)) &&
    typeof draft.feedbackCategory === "string" &&
    PUBLIC_RATER_RESPONSE_CATEGORIES.includes(draft.feedbackCategory as PublicRaterResponseCategory) &&
    typeof draft.feedbackBody === "string" &&
    typeof draft.sourceUrl === "string"
  );
}

export function PublicQuestionCard({
  task,
  paidAccess,
  onSubmitted,
}: {
  task: PublicAnswerTask;
  paidAccess: PaidTaskAccess;
  onSubmitted: () => void;
}) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [technicalStatus, setTechnicalStatus] = useState<string | null>(null);
  const [recoveryBackup, setRecoveryBackup] = useState<string | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(task.question.rationale?.mode === "required");
  const [feedbackCategory, setFeedbackCategory] = useState<PublicRaterResponseCategory>("opinion");
  const [feedbackBody, setFeedbackBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [savedCommit, setSavedCommit] = useState<TokenlessQueuedCommit | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const rationaleRef = useRef<HTMLTextAreaElement>(null);
  const feedbackEnabled = task.question.rationale?.mode !== "off";

  useEffect(() => {
    const draft = loadReviewDraft("public", task.roundId, isPublicReviewDraft);
    if (draft) {
      setAnswer(draft.answer);
      setPrediction(draft.prediction);
      setFeedbackCategory(draft.feedbackCategory);
      setFeedbackBody(draft.feedbackBody);
      setSourceUrl(draft.sourceUrl);
      if (draft.feedbackBody || draft.sourceUrl) setFeedbackOpen(true);
    }
    setDraftRestored(true);
  }, [task.roundId]);

  useEffect(() => {
    if (!draftRestored) return;
    saveReviewDraft("public", task.roundId, { answer, prediction, feedbackCategory, feedbackBody, sourceUrl });
  }, [answer, draftRestored, feedbackBody, feedbackCategory, prediction, sourceUrl, task.roundId]);

  useEffect(() => {
    if (!recoveryBackup) {
      setRecoveryUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([recoveryBackup], { type: "application/json" }));
    setRecoveryUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recoveryBackup]);

  useEffect(() => {
    if (!task.alreadyVouchered) return;
    let active = true;
    void createIndexedDbTokenlessCommitQueue()
      .list()
      .then(records => {
        if (!active) return;
        const record = records.find(value => value.roundId === task.roundId) ?? null;
        setSavedCommit(record);
        setStatus(record ? "Ready to retry" : "No saved submission");
        setTechnicalStatus(
          record
            ? "A prepared submission is saved on this device. Retry it or check confirmation."
            : "This voucher was reserved in another session. No prepared submission is available on this device.",
        );
      });
    return () => {
      active = false;
    };
  }, [task.alreadyVouchered, task.roundId]);

  async function retrySavedCommit() {
    if (!savedCommit) return;
    setBusy(true);
    setError(null);
    setStatus("Submitting…");
    setTechnicalStatus("Sending the saved transaction and checking confirmation.");
    try {
      const idempotencyKey = String(savedCommit.relayPayload.idempotencyKey ?? "");
      let committed = await readAnswerJson(
        await fetch("/api/rater/commits", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(savedCommit.relayPayload),
        }),
      );
      if (typeof committed.commitId !== "string") throw new Error("Commit response is incomplete.");
      const commitId = committed.commitId;
      for (let attempt = 0; attempt < 10 && committed.state === "submitted"; attempt += 1) {
        setTechnicalStatus(`Saved transaction sent; checking confirmation${attempt ? ` (${attempt + 1}/10)` : ""}.`);
        await wait(1_000);
        committed = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(commitId)}`, { credentials: "same-origin" }),
        );
      }
      if (committed.state === "confirmed") {
        await createIndexedDbTokenlessCommitQueue().remove(savedCommit.queueId);
        setSavedCommit(null);
        clearReviewDraft("public", task.roundId);
        setStatus("Recorded");
        setTechnicalStatus("The answer is confirmed. The panel rating stays hidden until settlement.");
        onSubmitted();
      } else if (committed.state === "failed") {
        throw new Error("The sponsored transaction failed. The prepared submission remains saved for retry.");
      } else {
        setStatus("Submitting…");
        setTechnicalStatus("Confirmation is pending. The prepared submission remains saved on this device.");
      }
    } catch (cause) {
      setError("We couldn’t finish recording your rating. Try again.");
      setTechnicalStatus(cause instanceof Error ? cause.message : "Unable to retry the saved submission.");
      setStatus("Ready to retry");
    } finally {
      setBusy(false);
    }
  }

  async function submitResponse() {
    if (paidAccess.state !== "ready" || !answer || prediction === null || task.alreadyVouchered) return;
    let preparedForRetry = false;
    setBusy(true);
    setError(null);
    setStatus("Submitting…");
    setTechnicalStatus("Creating one-time answer and payout keys on this device.");
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
        predictedUpBps: (prediction * 100) as 1000 | 3000 | 5000 | 7000 | 9000,
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
      const recoveryStored = storeDeviceRecovery(recoveryRecord, browserSession.principalId);
      setRecoveryBackup(serializeDeviceRecoveryBackup(recoveryRecord, recoverySecret));
      setTechnicalStatus(
        recoveryStored
          ? "The encrypted record is saved for this account, but its recovery secret is not in browser storage. Download the backup before leaving."
          : "Device storage is unavailable. Download the backup before leaving this page.",
      );
      const sealed = await sealTokenlessReveal({
        material: secrets.reveal,
        drandNetwork: task.beacon.network,
        beaconRound: task.beacon.round,
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
      setTechnicalStatus("Sending the sponsored transaction.");
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
        setTechnicalStatus(`Transaction sent; checking confirmation${attempt ? ` (${attempt + 1}/10)` : ""}.`);
        await wait(1_000);
        current = await readAnswerJson(
          await fetch(`/api/rater/commits/${encodeURIComponent(committed.commitId)}`, {
            credentials: "same-origin",
          }),
        );
      }
      if (current.state === "confirmed") {
        await queue.remove(queueId);
        setSavedCommit(null);
        clearReviewDraft("public", task.roundId);
        setStatus("Recorded");
        setTechnicalStatus("The answer is confirmed. The panel rating stays hidden until settlement.");
        onSubmitted();
      } else if (current.state === "failed") {
        throw new Error(
          "The sponsored transaction failed. Your prepared submission is saved on this device for retry.",
        );
      } else {
        setStatus("Submitting…");
        setTechnicalStatus("Confirmation is pending. The prepared submission remains saved on this device.");
      }
    } catch (cause) {
      setError("We couldn’t record your rating. Try again.");
      setStatus(preparedForRetry ? "Ready to retry" : null);
      setTechnicalStatus(
        `${cause instanceof Error ? cause.message : "Unable to submit the sealed answer."}${preparedForRetry ? " The prepared submission remains on this device." : ""}`,
      );
    } finally {
      setBusy(false);
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

  return (
    <ReviewerShell
      advanceDisabled={
        paidAccess.state !== "ready" ||
        busy ||
        (!savedCommit && (!answer || prediction === null || task.alreadyVouchered))
      }
      advanceLabel={
        paidAccess.state !== "ready"
          ? "Paid work required"
          : savedCommit
            ? "Retry submission"
            : task.alreadyVouchered
              ? "No saved submission"
              : "Submit rating"
      }
      busyLabel={busy ? "Submitting…" : null}
      caseIndex={0}
      laneHeader={
        <>
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-blue)]">Public review</p>
          <p className="mt-1 text-sm text-base-content/60">Guaranteed ${usdc(task.earnings.guaranteedBaseAtomic)}</p>
          <DeadlineChip deadline={task.voucherDeadline} label="Submit" />
        </>
      }
      onAdvance={() => void (savedCommit ? retrySavedCommit() : submitResponse())}
      onSelectFirst={() => paidAccess.state === "ready" && setAnswer("yes")}
      onSelectSecond={() => paidAccess.state === "ready" && setAnswer("no")}
      rationaleRef={rationaleRef}
      totalCases={1}
    >
      <article className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_17.25rem] xl:items-start">
        <Card as="section" className="min-h-72 rounded-lg p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/45">
            <span>Public panel</span>
            <span>Round {task.roundId}</span>
          </div>
          <h2 className="mt-8 max-w-3xl text-2xl font-semibold leading-tight sm:text-3xl">{task.question.prompt}</h2>
          {task.question.media ? <QuestionMedia media={task.question.media} /> : null}
          <p className="mt-5 text-sm leading-6 text-base-content/55">
            Choose one answer, then estimate how the panel will respond. Public questions contain only public,
            synthetic, or safely redacted material.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-base-content/45">
            <span>Guaranteed ${usdc(task.earnings.guaranteedBaseAtomic)}</span>
            <span>Quality bonus up to ${usdc(task.earnings.possibleBonusAtomic)}</span>
            <span>Insight bonus up to ${usdc(task.earnings.possibleSurpriseBonusAtomic)}</span>
            <span>Attempt ${usdc(task.earnings.attemptCompensationAtomic)}</span>
          </div>
        </Card>

        <Card className="rounded-lg p-4 sm:p-5">
          {paidAccess.state === "ready" ? (
            <>
              <p className="text-sm font-semibold">Your rating</p>
              <p className="mt-1 text-xs text-base-content/50">Rating hidden until settlement.</p>
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
                  <select
                    aria-label="Feedback category"
                    className="select select-sm mt-3 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={feedbackCategory}
                    onChange={event => setFeedbackCategory(event.target.value as PublicRaterResponseCategory)}
                  >
                    {PUBLIC_RATER_RESPONSE_CATEGORIES.map(category => (
                      <option key={category} value={category}>
                        {category.replace("_", " ")}
                      </option>
                    ))}
                  </select>
                  <textarea
                    ref={rationaleRef}
                    aria-label="Feedback"
                    className="textarea mt-2 min-h-28 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={feedbackBody}
                    onChange={event => setFeedbackBody(event.target.value)}
                    minLength={
                      task.question.rationale?.mode === "required" ? (task.question.rationale.minLength ?? 1) : 0
                    }
                    maxLength={feedbackMaximum}
                    placeholder="Opinion, evidence, ambiguity, or concerns…"
                  />
                  <div className="text-right text-[11px] text-base-content/45">
                    {feedbackBody.length}/{feedbackMaximum}
                  </div>
                  <input
                    type="url"
                    aria-label="Source URL"
                    className="input input-sm mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
                    value={sourceUrl}
                    onChange={event => setSourceUrl(event.target.value)}
                    maxLength={2_048}
                    placeholder="HTTPS source, optional"
                  />
                </fieldset>
              ) : null}
              <p className="mt-5 text-xs leading-5 text-base-content/50">Predict the share choosing the first option</p>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {[10, 30, 50, 70, 90].map(value => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={prediction === value}
                    className={`rounded-md px-1 py-2 text-xs transition-colors ${
                      prediction === value ? "pill-active" : "pill-inactive"
                    }`}
                    onClick={() => setPrediction(value)}
                  >
                    {value}%
                  </button>
                ))}
              </div>
              {recoveryUrl ? (
                <a
                  href={recoveryUrl}
                  download={`rateloop-review-${task.roundId}-backup.json`}
                  className="mt-3 block text-center text-xs underline underline-offset-4"
                >
                  Download backup
                </a>
              ) : null}
              {status ? (
                <p role="status" className="mt-3 text-xs leading-5 text-emerald-100">
                  {status}
                </p>
              ) : null}
              {technicalStatus ? (
                <details className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs text-base-content/55">
                  <summary className="cursor-pointer font-medium text-base-content/70">Technical details</summary>
                  <p className="mt-2 leading-5">{technicalStatus}</p>
                </details>
              ) : null}
              {error ? (
                <p role="alert" className="mt-3 text-xs leading-5 text-red-100">
                  {error}
                </p>
              ) : null}
              <Link
                href="/human?tab=profile&section=paid-work"
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
                    ? "/settings/wallets"
                    : "/human?tab=profile&section=paid-work"
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
