"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { AsyncSection } from "~~/components/tokenless/ui/AsyncSection";
import { Card } from "~~/components/tokenless/ui/Card";
import type { ReviewerEarning } from "~~/lib/tokenless/raterSettlementService";

type EarningsResponse = {
  schemaVersion: "rateloop.reviewer-earnings.v1";
  totals: { earnedAtomic: string; claimedAtomic: string; claimableAtomic: string };
  items: ReviewerEarning[];
};

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function ReviewerEarningsClient() {
  const t = useTranslations("human.earnings");
  const format = useFormatter();
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
      if (!response.ok) throw new Error(body.message ?? body.error ?? t("loadFailed"));
      if (body.schemaVersion !== "rateloop.reviewer-earnings.v1" || !body.totals || !Array.isArray(body.items)) {
        throw new Error(t("malformed"));
      }
      setLedger(body as EarningsResponse);
    } catch {
      setLedger(null);
      setError(t("loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card as="section" className="rounded-2xl p-5" aria-labelledby="reviewer-earnings-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reviewer-earnings-title" className="text-xl font-semibold">
            {t("title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-base-content/60">{t("description")}</p>
        </div>
        <button
          type="button"
          className="rateloop-secondary-action rounded-lg px-3 py-2 text-sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? t("refreshing") : t("refresh")}
        </button>
      </div>
      {ledger ? (
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            [t("earned"), ledger.totals.earnedAtomic],
            [t("paid"), ledger.totals.claimedAtomic],
            [t("readyToClaim"), ledger.totals.claimableAtomic],
          ].map(([label, amount]) => (
            <Card as="div" variant="nested" key={label} className="rounded-xl p-4">
              <dt className="text-xs text-base-content/55">{label}</dt>
              <dd className="mt-1 text-lg font-semibold">
                {format.number(Number(BigInt(amount)) / 1_000_000, {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 6,
                })}{" "}
                USDC
              </dd>
            </Card>
          ))}
        </dl>
      ) : null}
      <AsyncSection
        className="mt-5"
        loading={loading && ledger === null}
        loadingLabel={t("loading")}
        error={error}
        empty={ledger !== null && ledger.items.length === 0}
        emptyTitle={t("empty")}
      >
        {ledger?.items.length ? (
          <div className="mt-5 space-y-3">
            {ledger.items.map(item => (
              <Card as="article" variant="nested" key={item.commitId} className="rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{item.question}</h3>
                    <p className="mt-1 font-mono text-xs text-base-content/55">
                      {t("round", { round: item.roundId })} · {short(item.commitKey)}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-3 py-1 text-xs ${
                      item.status === "paid"
                        ? "bg-success/10 text-success"
                        : item.status === "claimable" || item.status === "reveal_required"
                          ? "bg-warning/10 text-warning"
                          : "bg-base-content/5 text-base-content/60"
                    }`}
                  >
                    {t(`status.${item.status}`)}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-base-content/55">{t("yourVote")}</dt>
                    <dd className="mt-1">{item.vote ?? t("sealed")}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">{t("panelVerdict")}</dt>
                    <dd className="mt-1">{item.verdict ?? t("pending")}</dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">{t("earned")}</dt>
                    <dd className="mt-1">
                      {format.number(Number(BigInt(item.earnedAtomic)) / 1_000_000, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 6,
                      })}{" "}
                      USDC
                    </dd>
                  </div>
                  <div>
                    <dt className="text-base-content/55">{t("claimDeadline")}</dt>
                    <dd className="mt-1">
                      {item.claimDeadline
                        ? format.dateTime(new Date(Number(BigInt(item.claimDeadline) * 1_000n)), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : t("notOpened")}
                    </dd>
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
                      {t("commitTransaction")}
                    </a>
                  ) : null}
                  {item.claimTransactionHash ? (
                    <a
                      className="text-[var(--rateloop-pink)] underline"
                      href={`https://sepolia.basescan.org/tx/${item.claimTransactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("claimTransaction")}
                    </a>
                  ) : null}
                  {item.status === "claimable" || item.status === "reveal_required" ? (
                    <a className="text-[var(--rateloop-pink)] underline" href="#paid-settlement">
                      {t("openRecovery")}
                    </a>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        ) : null}
      </AsyncSection>
    </Card>
  );
}
