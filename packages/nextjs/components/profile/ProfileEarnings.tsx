"use client";

import Link from "next/link";
import { BanknotesIcon } from "@heroicons/react/24/outline";
import { surfaceSectionHeadingClassName } from "~~/components/shared/sectionHeading";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { buildRateContentHref } from "~~/constants/routes";
import { formatUsdAmount } from "~~/lib/questionRewardPools";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";
import type {
  PonderProfileEarningItem,
  PonderProfileEarningsSummary,
  PonderRewardCurrency,
} from "~~/services/ponder/client";

const emptySummary: PonderProfileEarningsSummary = {
  totalUsdcEarned: "0",
  totalLrepEarned: "0",
  bountyUsdcEarned: "0",
  bountyLrepEarned: "0",
  feedbackUsdcEarned: "0",
  feedbackLrepEarned: "0",
  roundLrepEarned: "0",
  paidEventCount: 0,
  latestPaidAt: null,
};

function parseAtomicAmount(value: string | null | undefined) {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function formatEarningAmount(value: string | bigint, currency: PonderRewardCurrency) {
  const amount = typeof value === "bigint" ? value : parseAtomicAmount(value);
  if (currency === "USDC") return formatUsdAmount(amount);
  return `${formatLrepAmount(amount)} LREP`;
}

function formatTimestamp(timestamp: string | null | undefined) {
  if (!timestamp) return "-";
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sourceLabel(item: Pick<PonderProfileEarningItem, "source">) {
  switch (item.source) {
    case "feedback_bonus":
      return "Feedback Bonus";
    case "question_bundle_reward":
      return "Bundle bounty";
    case "question_reward":
      return "Question bounty";
    case "round_reward":
      return "Round reward";
  }
}

function itemTargetLabel(item: PonderProfileEarningItem) {
  if (item.title) return item.title;
  if (item.contentId) return `Content #${item.contentId}`;
  if (item.bundleId) return `Bundle #${item.bundleId}`;
  return "Protocol reward";
}

function EarningsMetric({ detail, label, value }: { detail?: string; label: string; value: string }) {
  return (
    <div className="surface-card-nested rounded-2xl px-4 py-3">
      <div className="text-sm text-base-content/60">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {detail ? <div className="mt-1 text-sm text-base-content/55">{detail}</div> : null}
    </div>
  );
}

export function ProfileEarnings({
  isLoading,
  items,
  summary,
}: {
  isLoading?: boolean;
  items: PonderProfileEarningItem[];
  summary: PonderProfileEarningsSummary | null | undefined;
}) {
  const resolvedSummary = summary ?? emptySummary;
  const totalUsdc = parseAtomicAmount(resolvedSummary.totalUsdcEarned);
  const totalLrep = parseAtomicAmount(resolvedSummary.totalLrepEarned);
  const bountyUsdc = parseAtomicAmount(resolvedSummary.bountyUsdcEarned);
  const bountyLrep = parseAtomicAmount(resolvedSummary.bountyLrepEarned);
  const feedbackUsdc = parseAtomicAmount(resolvedSummary.feedbackUsdcEarned);
  const feedbackLrep = parseAtomicAmount(resolvedSummary.feedbackLrepEarned);
  const roundLrep = parseAtomicAmount(resolvedSummary.roundLrepEarned);
  const hasEarnings = totalUsdc > 0n || totalLrep > 0n || items.length > 0;

  return (
    <div className="surface-card rounded-3xl p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className={surfaceSectionHeadingClassName}>Earnings</h2>
            <InfoTooltip text="Public paid-out rewards only. Bounty and Feedback Bonus totals use the net amount sent to the rater, excluding frontend fees. Pending claimable rewards are shown only to the connected wallet through the claim button." />
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full bg-base-content/[0.05] px-4 py-2 text-sm font-medium text-base-content/70">
          <BanknotesIcon className="h-4 w-4" aria-hidden="true" />
          <span>
            {resolvedSummary.paidEventCount} paid event{resolvedSummary.paidEventCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-6 flex items-center gap-3 text-base-content/55">
          <span className="loading loading-spinner loading-sm text-primary" />
          <span>Loading public earnings...</span>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <EarningsMetric label="Total USDC" value={formatUsdAmount(totalUsdc)} />
            <EarningsMetric label="Total LREP" value={`${formatLrepAmount(totalLrep)} LREP`} />
            <EarningsMetric
              label="Bounties"
              value={`${formatUsdAmount(bountyUsdc)} / ${formatLrepAmount(bountyLrep)} LREP`}
              detail="Claimed question and bundle bounties"
            />
            <EarningsMetric
              label="Feedback Bonuses"
              value={`${formatUsdAmount(feedbackUsdc)} / ${formatLrepAmount(feedbackLrep)} LREP`}
              detail={roundLrep > 0n ? `Round rewards: ${formatLrepAmount(roundLrep)} LREP` : undefined}
            />
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-base font-medium text-base-content/60">Recent Earnings</span>
              <span className="text-sm text-base-content/50">Latest {items.length}</span>
            </div>

            {!hasEarnings ? (
              <div className="surface-card-nested rounded-2xl px-4 py-8 text-center text-base text-base-content/55">
                No paid earnings yet.
              </div>
            ) : items.length === 0 ? (
              <div className="surface-card-nested rounded-2xl px-4 py-8 text-center text-base text-base-content/55">
                No recent earnings in the index yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr className="text-base-content/60">
                      <th>Source</th>
                      <th>Context</th>
                      <th className="text-right">Amount</th>
                      <th className="text-right">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={`${item.source}-${item.id}`} className="hover:bg-base-200/40">
                        <td>{sourceLabel(item)}</td>
                        <td>
                          {item.contentId ? (
                            <Link
                              href={buildRateContentHref(item.contentId)}
                              className="font-medium transition-colors hover:text-primary"
                            >
                              {itemTargetLabel(item)}
                            </Link>
                          ) : (
                            <span className="font-medium">{itemTargetLabel(item)}</span>
                          )}
                          {item.roundId ? (
                            <div className="text-base text-base-content/55">Round #{item.roundId}</div>
                          ) : item.roundSetIndex !== null ? (
                            <div className="text-base text-base-content/55">Round set #{item.roundSetIndex}</div>
                          ) : null}
                        </td>
                        <td className="text-right font-mono">{formatEarningAmount(item.amount, item.currency)}</td>
                        <td className="text-right text-base-content/55">{formatTimestamp(item.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
