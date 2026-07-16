"use client";

import { useCallback, useEffect, useState } from "react";
import { prepareTransaction, sendTransaction } from "thirdweb";
import { baseSepolia } from "thirdweb/chains";
import { ConnectButton, ThirdwebProvider, useActiveAccount } from "thirdweb/react";
import { rateLoopThirdwebWallets, thirdwebBrowserClient } from "~~/lib/thirdweb/client";
import type { FeedbackBonusAwardInboxItem } from "~~/lib/tokenless/feedbackBonusAwards";
import type { FeedbackBonusHumanWalletAuthorization } from "~~/lib/tokenless/feedbackBonusHumanWalletExecution";

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed.",
    );
  }
  return body;
}

export function formatFeedbackBonusUsdc(atomic: string) {
  const amount = BigInt(atomic);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
}

function decimalToAtomic(value: string) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/u.exec(value.trim());
  if (!match) throw new Error("Award amount must be USDC with up to six decimal places.");
  const result = BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  if (result <= 0n) throw new Error("Award amount must be greater than zero.");
  return result.toString();
}

function AwardCard({ item, onAwarded }: { item: FeedbackBonusAwardInboxItem; onAwarded: () => Promise<void> }) {
  const account = useActiveAccount();
  const [amount, setAmount] = useState(() => {
    const remaining = BigInt(item.remainingPoolAtomic);
    return formatFeedbackBonusUsdc(remaining < 1_000_000n ? remaining.toString() : "1000000").replace(" USDC", "");
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTransactionHash, setPendingTransactionHash] = useState<string | null>(null);

  async function award() {
    setBusy(true);
    setError(null);
    try {
      const amountAtomic = decimalToAtomic(amount);
      if (BigInt(amountAtomic) > BigInt(item.remainingPoolAtomic)) {
        throw new Error(`This pool has ${formatFeedbackBonusUsdc(item.remainingPoolAtomic)} left.`);
      }
      if (!account || !thirdwebBrowserClient) throw new Error("Connect the human awarder wallet first.");
      const idempotencyKey = `feedback-bonus:${item.opportunityId}:${item.feedbackId}`;
      const endpoint = `/api/account/workspaces/${encodeURIComponent(
        item.workspaceId,
      )}/feedback-bonus/${encodeURIComponent(item.feedbackId)}`;
      const prepared = await readJson(
        await fetch(endpoint, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountAtomic, idempotencyKey }),
        }),
      );
      if (prepared.status === "confirmed") {
        await onAwarded();
        return;
      }
      if (prepared.status !== "human_wallet_required") {
        throw new Error("RateLoop did not return a human-wallet award authorization.");
      }
      const authorization = prepared.authorization as FeedbackBonusHumanWalletAuthorization;
      if (account.address.toLowerCase() !== authorization.awarderAddress.toLowerCase()) {
        throw new Error(`Connect the designated awarder wallet ${authorization.awarderAddress}.`);
      }
      if (authorization.chainId !== baseSepolia.id) throw new Error("The Feedback Bonus is on an unsupported chain.");
      const transactionHash =
        pendingTransactionHash ??
        (
          await sendTransaction({
            account,
            transaction: prepareTransaction({
              client: thirdwebBrowserClient,
              chain: baseSepolia,
              to: authorization.contractAddress,
              data: authorization.transactionData,
            }),
          })
        ).transactionHash;
      setPendingTransactionHash(transactionHash);
      await readJson(
        await fetch(endpoint, {
          method: "PUT",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ amountAtomic, idempotencyKey, transactionHash }),
        }),
      );
      setPendingTransactionHash(null);
      await onAwarded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to award this feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="surface-card rounded-2xl p-5" aria-labelledby={`feedback-bonus-${item.feedbackId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--rateloop-pink)]">Feedback Bonus</p>
          <h3 id={`feedback-bonus-${item.feedbackId}`} className="mt-1 font-semibold">
            Select useful written feedback
          </h3>
        </div>
        <span className="rounded-md bg-white/[0.06] px-2 py-1 text-xs">
          {formatFeedbackBonusUsdc(item.remainingPoolAtomic)} left
        </span>
      </div>
      <blockquote className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-base-content/75">
        {item.feedbackBody}
      </blockquote>
      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="text-sm">
          Award amount
          <div className="input mt-2 flex w-full items-center gap-2 border-white/10 bg-[var(--rateloop-field)]">
            <input
              className="min-w-0 grow bg-transparent outline-none"
              inputMode="decimal"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              aria-label="Feedback Bonus award amount"
            />
            <span className="text-base-content/50">USDC</span>
          </div>
        </label>
        <button type="button" className="rateloop-gradient-action px-5" disabled={busy} onClick={() => void award()}>
          {busy ? "Confirming…" : "Award this feedback"}
        </button>
      </div>
      <p className="mt-3 text-xs text-base-content/50">
        Award by {new Date(item.awardDeadline).toLocaleString()}. Awards are final and use the feedback&apos;s immutable
        payout commitment.
      </p>
      {error ? (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

function FeedbackBonusAwardInboxControls({ workspaceId }: { workspaceId: string }) {
  const account = useActiveAccount();
  const [items, setItems] = useState<FeedbackBonusAwardInboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await readJson(
        await fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/feedback-bonus`, {
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
      setItems((body.items ?? []) as FeedbackBonusAwardInboxItem[]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Feedback Bonuses.");
    } finally {
      setLoaded(true);
    }
  }, [workspaceId]);

  useEffect(() => void load(), [load]);

  if (!loaded || (items.length === 0 && !error)) return null;
  return (
    <section className="space-y-4" aria-labelledby="feedback-bonus-award-inbox-title">
      <div>
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--rateloop-pink)]">Human action</p>
        <h2 id="feedback-bonus-award-inbox-title" className="mt-2 text-2xl font-semibold">
          Award Feedback Bonus
        </h2>
        <p className="mt-2 text-sm text-base-content/55">
          Choose eligible written feedback and an amount. The agent cannot make this decision.
        </p>
      </div>
      {!account && thirdwebBrowserClient ? (
        <div className="surface-card flex flex-wrap items-center justify-between gap-4 rounded-2xl p-4">
          <p className="text-sm text-base-content/60">Connect the human awarder wallet to make a final award.</p>
          <ConnectButton
            client={thirdwebBrowserClient}
            chain={baseSepolia}
            chains={[baseSepolia]}
            wallets={rateLoopThirdwebWallets}
            connectButton={{ label: "Connect awarder wallet" }}
            connectModal={{ showThirdwebBranding: false, size: "compact", title: "Connect the awarder wallet" }}
          />
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-error/30 bg-error/10 p-4 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
      {items.map(item => (
        <AwardCard key={`${item.opportunityId}:${item.feedbackId}`} item={item} onAwarded={load} />
      ))}
    </section>
  );
}

export function FeedbackBonusAwardInbox({ workspaceId }: { workspaceId: string }) {
  if (!thirdwebBrowserClient) return null;
  return (
    <ThirdwebProvider>
      <FeedbackBonusAwardInboxControls workspaceId={workspaceId} />
    </ThirdwebProvider>
  );
}
