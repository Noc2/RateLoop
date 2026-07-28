"use client";

import { useCallback, useEffect, useState } from "react";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import type { ReviewerEarning } from "~~/lib/tokenless/raterSettlementService";

type EarningsResponse = {
  schemaVersion: "rateloop.reviewer-earnings.v1";
  totals: { earnedAtomic: string; claimedAtomic: string; claimableAtomic: string };
  items: ReviewerEarning[];
};

const STATUS_LABELS: Record<ReviewerEarning["status"], string> = {
  commit_pending: "Commit pending",
  commit_failed: "Commit failed",
  indexing: "Indexing",
  reveal_required: "Reveal required",
  settling: "Settlement in progress",
  claimable: "Ready to claim",
  paid: "Paid",
  expired: "Claim window expired",
  no_payout: "No payout",
};

function usdc(atomic: string) {
  const value = BigInt(atomic);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/u, "");
  return `${whole.toLocaleString()}${fraction ? `.${fraction}` : ""} USDC`;
}

function claimDeadline(seconds: string | null) {
  return seconds ? new Date(Number(BigInt(seconds) * 1_000n)).toLocaleString() : "Not opened";
}

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function ReviewerEarningsClient() {
  const [ledger, setLedger] = useState<EarningsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/rater/earnings", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = (await response.json().catch(() => ({}))) as Partial<EarningsResponse> & {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.message ?? body.error ?? "Unable to load earnings.");
      if (body.schemaVersion !== "rateloop.reviewer-earnings.v1" || !body.totals || !Array.isArray(body.items)) {
        throw new Error("The earnings ledger is malformed.");
      }
      setLedger(body as EarningsResponse);
    } catch (cause) {
      setLedger(null);
      setError(cause instanceof Error ? cause.message : "Unable to load earnings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section className="surface-card rounded-2xl p-5" aria-labelledby="reviewer-earnings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reviewer-earnings-title" className="text-xl font-semibold">
            Reviewer earnings
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">
            Historical commits, outcomes, earned amounts, payouts, and claim deadlines from the pinned public settlement
            index.
          </p>
        </div>
        <button
          type="button"
          className="rateloop-secondary-action rounded-lg px-3 py-2 text-sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {ledger ? (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["Earned", ledger.totals.earnedAtomic],
            ["Paid", ledger.totals.claimedAtomic],
            ["Ready to claim", ledger.totals.claimableAtomic],
          ].map(([label, amount]) => (
            <div key={label} className="surface-card-nested rounded-xl p-4">
              <dt className="text-xs text-base-content/55">{label}</dt>
              <dd className="mt-1 text-lg font-semibold">{usdc(amount)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <AsyncSection
        className="mt-5"
        loading={loading && ledger === null}
        loadingLabel="Loading reviewer earnings"
        error={error}
        empty={ledger !== null && ledger.items.length === 0}
        emptyTitle="No paid review commits yet."
      >
        {ledger?.items.length ? (
          <div className="mt-5 space-y-3">
            {ledger.items.map(item => (
              <article key={item.commitId} className="surface-card-nested rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{item.question}</h3>
                    <p className="mt-1 font-mono text-xs text-base-content/55">
                      Round {item.roundId} · {short(item.commitKey)}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-3 py-1 text-xs ${
                      item.status === "paid"
                        ? "bg-emerald-400/10 text-emerald-100"
                        : item.status === "claimable" || item.status === "reveal_required"
                          ? "bg-amber-400/10 text-amber-100"
                          : "bg-white/5 text-base-content/60"
                    }`}
                  >
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-base-content/55">Your vote</dt>
                    <dd className="mt-1">{item.vote ?? "Sealed"}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Panel verdict</dt>
                    <dd className="mt-1">{item.verdict ?? "Pending"}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Earned</dt>
                    <dd className="mt-1">{usdc(item.earnedAtomic)}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">Claim deadline</dt>
                    <dd className="mt-1">{claimDeadline(item.claimDeadline)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-3 text-xs">
                  {item.commitTransactionHash ? (
                    <a
                      className="text-[var(--rateloop-pink)] underline"
                      href={`https://sepolia.basescan.org/tx/${item.commitTransactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Commit transaction
                    </a>
                  ) : null}
                  {item.claimTransactionHash ? (
                    <a
                      className="text-[var(--rateloop-pink)] underline"
                      href={`https://sepolia.basescan.org/tx/${item.claimTransactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Claim transaction
                    </a>
                  ) : null}
                  {item.status === "claimable" || item.status === "reveal_required" ? (
                    <a className="text-[var(--rateloop-pink)] underline" href="#paid-settlement">
                      Open payment recovery
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </AsyncSection>
    </section>
  );
}
