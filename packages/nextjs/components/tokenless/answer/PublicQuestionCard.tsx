"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keccak256, stringToHex } from "viem";
import { type PublicQuestionMedia, QuestionMedia } from "~~/components/tokenless/answer/QuestionMedia";
import {
  createIndexedDbTokenlessCommitQueue,
  createTokenlessRaterRoundSecrets,
  enqueueTokenlessCommit,
  exportTokenlessRecoveryPackage,
  sealTokenlessReveal,
  signTokenlessCommit,
} from "~~/lib/tokenless/rater";

export type PublicAnswerTask = {
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

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Answer request failed.");
  return body;
}

function usdc(value: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(BigInt(value)) / 1_000_000,
  );
}

export function PublicQuestionCard({ task, onSubmitted }: { task: PublicAnswerTask; onSubmitted: () => void }) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [recoverySecret, setRecoverySecret] = useState("");
  const [recoveryPackage, setRecoveryPackage] = useState<string | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!recoveryPackage) {
      setRecoveryUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([recoveryPackage], { type: "application/json" }));
    setRecoveryUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recoveryPackage]);

  async function submitResponse() {
    if (!answer || prediction === null || task.alreadyVouchered) return;
    if (recoverySecret.length < 12) {
      setError("Choose a recovery secret of at least 12 characters before submitting paid work.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Creating one-time answer and payout keys locally…");
    try {
      const responseHash = keccak256(stringToHex(JSON.stringify({ roundId: task.roundId, answer, prediction })));
      const secrets = createTokenlessRaterRoundSecrets({
        roundId: BigInt(task.roundId),
        vote: answer === "yes" ? 1 : 0,
        predictedUpBps: (prediction * 100) as 1000 | 3000 | 5000 | 7000 | 9000,
        responseHash,
      });
      const exported = await exportTokenlessRecoveryPackage(secrets, recoverySecret);
      localStorage.setItem(`rateloop:rater-recovery:${task.roundId}`, exported);
      setRecoveryPackage(exported);
      setStatus("Sealing your answer for the public beacon…");
      const sealed = await sealTokenlessReveal({
        material: secrets.reveal,
        drandNetwork: task.beacon.network,
        beaconRound: task.beacon.round,
      });
      const idempotencyBase = `voucher:web:${task.roundId}`;
      const voucherBody = await readJson(
        await fetch("/api/rater/vouchers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyBase },
          body: JSON.stringify({
            idempotencyKey: idempotencyBase,
            roundId: task.roundId,
            contentId: task.contentId,
            voteKey: secrets.reveal.voteKey,
          }),
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
      await enqueueTokenlessCommit(queue, {
        queueId,
        roundId: authorization.roundId,
        commitDeadline: new Date(task.voucherDeadline),
        relayPayload: { idempotencyKey, voucherId: voucherBody.voucherId, authorization: publicAuthorization },
      });
      setStatus("Submitting through the sponsored gas-only relayer…");
      const committed = await readJson(
        await fetch("/api/rater/commits", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({
            idempotencyKey,
            voucherId: voucherBody.voucherId,
            authorization: publicAuthorization,
          }),
        }),
      );
      await queue.remove(queueId);
      setStatus(`Sealed answer submitted · ${String(committed.transactionHash ?? "receipt pending")}`);
      onSubmitted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the sealed answer.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  const options =
    task.question.kind === "head_to_head"
      ? [task.question.optionA?.label ?? "Option A", task.question.optionB?.label ?? "Option B"]
      : [task.question.positiveLabel ?? "Yes", task.question.negativeLabel ?? "No"];

  return (
    <article className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_17.25rem] xl:items-start">
      <section className="surface-card min-h-72 rounded-lg p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/45">
          <span>Public panel</span>
          <span>Round {task.roundId}</span>
        </div>
        <h2 className="mt-8 max-w-3xl text-2xl font-semibold leading-tight sm:text-3xl">{task.question.prompt}</h2>
        {task.question.media ? <QuestionMedia media={task.question.media} /> : null}
        <p className="mt-5 text-sm leading-6 text-base-content/55">
          Choose the stronger answer, then estimate how the panel will respond. Public questions contain only public,
          synthetic, or safely redacted material.
        </p>
        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/10 pt-4 text-xs text-base-content/45">
          <span>Guaranteed ${usdc(task.earnings.guaranteedBaseAtomic)}</span>
          <span>RBTS up to ${usdc(task.earnings.possibleBonusAtomic)}</span>
          <span>Surprise up to ${usdc(task.earnings.possibleSurpriseBonusAtomic)}</span>
          <span>Attempt ${usdc(task.earnings.attemptCompensationAtomic)}</span>
        </div>
      </section>

      <aside className="surface-card rounded-lg p-4 sm:p-5">
        <p className="text-sm font-semibold">Your answer</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((value, index) => (
            <button
              key={value}
              type="button"
              className={`tab-control px-3 py-3 text-sm font-semibold transition-colors ${
                answer === value ? "pill-active" : "pill-inactive"
              }`}
              onClick={() => setAnswer(value)}
            >
              {options[index]}
            </button>
          ))}
        </div>
        <p className="mt-5 text-xs leading-5 text-base-content/50">Predict the share choosing the first option</p>
        <div className="mt-2 grid grid-cols-5 gap-1.5">
          {[10, 30, 50, 70, 90].map(value => (
            <button
              key={value}
              type="button"
              className={`rounded-md px-1 py-2 text-xs transition-colors ${
                prediction === value ? "pill-active" : "pill-inactive"
              }`}
              onClick={() => setPrediction(value)}
            >
              {value}%
            </button>
          ))}
        </div>
        <label className="mt-5 block border-t border-white/10 pt-4 text-xs text-base-content/55">
          Recovery secret
          <input
            type="password"
            className="input input-sm mt-2 w-full border-white/10 bg-[var(--rateloop-field)]"
            value={recoverySecret}
            onChange={event => setRecoverySecret(event.target.value)}
            minLength={12}
            maxLength={1024}
            autoComplete="new-password"
            placeholder="12+ characters"
          />
        </label>
        <button
          type="button"
          className="rateloop-gradient-action mt-4 w-full px-4 text-sm disabled:cursor-not-allowed disabled:opacity-45"
          disabled={busy || !answer || prediction === null || task.alreadyVouchered}
          onClick={() => void submitResponse()}
        >
          {busy ? "Sealing…" : task.alreadyVouchered ? "Submitted" : "Submit answer"}
        </button>
        {recoveryUrl ? (
          <a
            href={recoveryUrl}
            download={`rateloop-round-${task.roundId}-recovery.json`}
            className="mt-3 block text-center text-xs underline underline-offset-4"
          >
            Save recovery package
          </a>
        ) : null}
        {status ? (
          <p role="status" className="mt-3 text-xs leading-5 text-emerald-100">
            {status}
          </p>
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
      </aside>
    </article>
  );
}
