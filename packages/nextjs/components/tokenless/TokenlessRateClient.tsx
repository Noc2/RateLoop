"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keccak256, stringToHex } from "viem";
import {
  createIndexedDbTokenlessCommitQueue,
  createTokenlessRaterRoundSecrets,
  enqueueTokenlessCommit,
  exportTokenlessRecoveryPackage,
  sealTokenlessReveal,
  signTokenlessCommit,
} from "~~/lib/tokenless/rater";

type PaidTask = {
  operationKey: string;
  chainId: number;
  panelAddress: `0x${string}`;
  roundId: string;
  contentId: `0x${string}`;
  question: { kind: "binary" | "head_to_head"; prompt: string; negativeLabel?: string; positiveLabel?: string };
  voucherDeadline: string;
  alreadyVouchered: boolean;
  earnings: {
    guaranteedBaseAtomic: string;
    possibleBonusAtomic: string;
    attemptCompensationAtomic: string;
  };
  beacon: { network: "quicknet-t"; round: number };
};

async function readJson(response: Response) {
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "Rater request failed.");
  return body;
}

function usdc(value: string) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(BigInt(value)) / 1_000_000,
  );
}

export function TokenlessRateClient({ sandboxMode }: { sandboxMode: boolean }) {
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [prediction, setPrediction] = useState<number | null>(null);
  const [tasks, setTasks] = useState<PaidTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [recoverySecret, setRecoverySecret] = useState("");
  const [recoveryPackage, setRecoveryPackage] = useState<string | null>(null);
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const task = tasks.find(item => !item.alreadyVouchered) ?? tasks[0] ?? null;

  useEffect(() => {
    let active = true;
    void fetch("/api/rater/tasks", { cache: "no-store", credentials: "same-origin" })
      .then(readJson)
      .then(body => {
        if (active) setTasks(body.tasks as PaidTask[]);
      })
      .catch(cause => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load paid tasks.");
      });
    return () => {
      active = false;
    };
  }, []);

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
    if (!task || !answer || prediction === null) return;
    if (recoverySecret.length < 12) {
      setError("Choose a recovery secret of at least 12 characters before submitting paid work.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Creating one-time vote and payout keys locally…");
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
      setStatus("Sealing your response for the public beacon…");
      const sealed = await sealTokenlessReveal({
        material: secrets.reveal,
        drandNetwork: task.beacon.network,
        beaconRound: task.beacon.round,
      });
      const voucherBody = await readJson(
        await fetch("/api/rater/vouchers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", "Idempotency-Key": `voucher:web:${task.roundId}` },
          body: JSON.stringify({
            idempotencyKey: `voucher:web:${task.roundId}`,
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
      setStatus(`Sealed response submitted · ${String(committed.transactionHash ?? "receipt pending")}`);
      setTasks(current =>
        current.map(item => (item.roundId === task.roundId ? { ...item, alreadyVouchered: true } : item)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to submit the sealed response.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-14">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section>
          <div className="border-l-2 border-[var(--rateloop-green)] pl-6">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-base-content/55">Discover</p>
            <h1 className="display-section mt-3 text-4xl sm:text-5xl">One answer. One prediction.</h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-base-content/60">
              Browsing and advisory calibration require no tax form or payout wallet. Paid eligibility must be complete
              before the first paid voucher is issued.
            </p>
          </div>

          <article className="rateloop-surface-card mt-9 p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4 text-xs text-base-content/45">
              <span>{sandboxMode ? "Preview panel" : "Paid panel"}</span>
              <span>
                {task
                  ? `Guaranteed base $${usdc(task.earnings.guaranteedBaseAtomic)} · possible bonus $${usdc(task.earnings.possibleBonusAtomic)} · failure compensation $${usdc(task.earnings.attemptCompensationAtomic)}`
                  : "No paid task is currently available"}
              </span>
            </div>
            <h2 className="mt-6 text-2xl font-semibold leading-tight sm:text-3xl">
              {task?.question.prompt ?? "New paid panels will appear here after funding and moderation."}
            </h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {(["yes", "no"] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border p-4 font-semibold transition-colors ${answer === value ? "border-base-content/55 bg-base-content/[0.1]" : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.04]"}`}
                  onClick={() => setAnswer(value)}
                >
                  {value === "yes" ? "Yes" : "No"}
                </button>
              ))}
            </div>
            <p className="mt-8 font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">
              Predict the panel · What share will answer Yes?
            </p>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {[10, 30, 50, 70, 90].map(value => (
                <button
                  key={value}
                  type="button"
                  className={`rounded-lg border px-2 py-3 text-sm transition-colors ${prediction === value ? "border-[var(--rateloop-green)] bg-emerald-300/10" : "border-white/10 hover:border-white/25 hover:bg-white/[0.04]"}`}
                  onClick={() => setPrediction(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <button
              type="button"
              className="rateloop-gradient-action mt-6 w-full px-6 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={busy || !task || !answer || prediction === null || task.alreadyVouchered}
              onClick={() => void submitResponse()}
            >
              {busy
                ? "Sealing response…"
                : task?.alreadyVouchered
                  ? "Response already submitted"
                  : "Submit sealed response"}
            </button>
            <label className="mt-6 block border-t border-white/10 pt-5 text-sm text-base-content/60">
              Recovery secret
              <input
                type="password"
                className="input mt-2 w-full rounded-lg border-white/10 bg-[var(--rateloop-field)]"
                value={recoverySecret}
                onChange={event => setRecoverySecret(event.target.value)}
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                placeholder="12+ characters; RateLoop never receives this"
              />
            </label>
            {recoveryUrl ? (
              <a
                href={recoveryUrl}
                download={`rateloop-round-${task?.roundId ?? "recovery"}.json`}
                className="mt-3 inline-block text-sm underline underline-offset-4"
              >
                Save encrypted recovery package
              </a>
            ) : null}
            {status ? <p className="mt-4 rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-100">{status}</p> : null}
            {error ? <p className="mt-4 rounded-lg bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
          </article>
        </section>

        <aside className="rateloop-surface-card sticky top-24 h-fit p-6">
          <p className="font-mono text-xs uppercase tracking-widest text-base-content/45">Before paid work</p>
          <h2 className="mt-2 text-xl font-semibold">Unlock paid tasks</h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-base-content/60">
            <li>18+ and identity assurance tier</li>
            <li>Residence and applicable DAC7 fields</li>
            <li>Sanctions consent and screening</li>
            <li>Self-custodial payout destination</li>
          </ul>
          <p className="mt-5 border-l-2 border-[var(--rateloop-yellow)] bg-amber-300/10 py-2 pl-3 text-xs leading-5 text-amber-100">
            Eligibility is completed before the first paid voucher, so earned work never sits behind a surprise claim
            requirement.
          </p>
          <Link href="/settings" className="rateloop-gradient-action mt-5 w-full px-5">
            Set up account
          </Link>
        </aside>
      </div>
    </div>
  );
}
