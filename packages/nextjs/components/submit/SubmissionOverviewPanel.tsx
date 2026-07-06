"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon } from "@heroicons/react/24/outline";
import { ConnectWalletCard } from "~~/components/shared/ConnectWalletCard";
import { WalletRestoreLoading } from "~~/components/shared/WalletRestoreLoading";
import {
  getSubmissionBountyDeadline,
  getSubmissionBountyLabel,
  getSubmissionFeedbackLabel,
} from "~~/components/submit/submissionOverviewDisplay";
import { buildRateContentHref } from "~~/constants/routes";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { CONTENT_STATUS } from "~~/hooks/contentFeed/shared";
import { useCategoryRegistry } from "~~/hooks/useCategoryRegistry";
import { type ContentItem, useContentFeed } from "~~/hooks/useContentFeed";
import { formatRatingScoreOutOfTen } from "~~/lib/ui/ratingDisplay";

const PAGE_SIZE = 25;
const SUBMISSION_TABLE_SCROLL_CLASS = "overflow-x-auto xl:overflow-x-hidden";
const SUBMISSION_TABLE_CLASS = "table w-full min-w-[1040px] xl:min-w-full xl:table-fixed";

function normalizeDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 100_000_000_000 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(value: string | null | undefined): string {
  const dateMs = normalizeDateMs(value);
  if (dateMs === null) return "-";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(dateMs));
}

function getStatus(item: ContentItem): { label: string; className: string } {
  if (item.status === CONTENT_STATUS.Cancelled) {
    return { label: "Cancelled", className: "bg-error/10 text-error" };
  }
  if (item.status === CONTENT_STATUS.Dormant) {
    return { label: "Dormant", className: "bg-base-content/10 text-base-content/60" };
  }
  if (item.openRound) {
    return { label: "Open", className: "bg-primary/10 text-primary" };
  }
  if ((item.ratingSettledRounds ?? 0) > 0) {
    return { label: "Settled", className: "bg-success/10 text-success" };
  }
  return { label: "Active", className: "bg-base-content/10 text-base-content/70" };
}

function getRatingLabel(item: ContentItem): string {
  const rating = (item.ratingSettledRounds ?? 0) > 0 ? item.rating : null;
  const label = formatRatingScoreOutOfTen(rating);
  return label === "N/A" ? label : `${label}/10`;
}

function SubmissionOverviewSkeleton() {
  return (
    <div className={SUBMISSION_TABLE_SCROLL_CLASS}>
      <table className={SUBMISSION_TABLE_CLASS}>
        <thead>
          <tr className="text-base-content/60">
            <th>Question</th>
            <th>Status</th>
            <th className="text-right">Bounty</th>
            <th>Deadline</th>
            <th className="text-right">Feedback Bonus</th>
            <th className="text-right">Votes</th>
            <th className="text-right">Rounds</th>
            <th className="text-right">Rating</th>
            <th>Created</th>
            <th className="text-right">View</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }).map((_, index) => (
            <tr key={index}>
              <td>
                <div className="h-4 w-64 animate-pulse rounded bg-base-content/10" />
                <div className="mt-2 h-3 w-28 animate-pulse rounded bg-base-content/10" />
              </td>
              {Array.from({ length: 9 }).map((__, cellIndex) => (
                <td key={cellIndex}>
                  <div className="h-4 w-20 animate-pulse rounded bg-base-content/10" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubmissionOverviewPanel() {
  const { address } = useAccount();
  const { isRestoringWallet } = useWalletRestore();
  const [page, setPage] = useState(0);
  const normalizedAddress = address?.toLowerCase();
  const offset = page * PAGE_SIZE;
  const { categories } = useCategoryRegistry();
  const { feed, hasMore, isLoading, totalContent } = useContentFeed(address, {
    enabled: Boolean(address),
    keepPrevious: true,
    limit: PAGE_SIZE,
    offset,
    ownSubmitterAddresses: address ? [address] : undefined,
    sortBy: "newest",
    status: "all",
    submitter: address,
  });

  const categoryNameById = useMemo(() => {
    return new Map(categories.map(category => [category.id.toString(), category.name]));
  }, [categories]);

  if (!normalizedAddress) {
    if (isRestoringWallet) {
      return <WalletRestoreLoading className="min-h-80 pt-0" />;
    }

    return (
      <ConnectWalletCard title="Submissions" message="Connect a wallet to view questions submitted by this account." />
    );
  }

  const pageStart = totalContent === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + feed.length, totalContent);

  return (
    <section className="surface-card rounded-2xl p-6">
      <div>
        <div>
          <h2 className="text-2xl font-semibold text-base-content">Your Submissions</h2>
          <p className="mt-1 text-sm text-base-content/55">{totalContent} total</p>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-base-content/10 bg-base-200/40">
        {isLoading && feed.length === 0 ? (
          <SubmissionOverviewSkeleton />
        ) : feed.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-lg font-medium text-base-content">No submissions yet.</p>
            <p className="mt-1 text-sm text-base-content/55">Questions submitted from this wallet will appear here.</p>
          </div>
        ) : (
          <div className={SUBMISSION_TABLE_SCROLL_CLASS}>
            <table className={SUBMISSION_TABLE_CLASS}>
              <thead>
                <tr className="text-base-content/60">
                  <th>Question</th>
                  <th>Status</th>
                  <th className="text-right">Bounty</th>
                  <th>Deadline</th>
                  <th className="text-right">Feedback Bonus</th>
                  <th className="text-right">Votes</th>
                  <th className="text-right">Rounds</th>
                  <th className="text-right">Rating</th>
                  <th>Created</th>
                  <th className="text-right">View</th>
                </tr>
              </thead>
              <tbody>
                {feed.map(item => {
                  const status = getStatus(item);
                  const categoryName =
                    categoryNameById.get(item.categoryId.toString()) ?? `Category #${item.categoryId}`;

                  return (
                    <tr key={item.id.toString()} className="hover:bg-base-content/[0.04]">
                      <td className="max-w-[28rem]">
                        <Link
                          href={buildRateContentHref(item.id, {
                            chainId: item.chainId,
                            deploymentKey: item.deploymentKey,
                          })}
                          className="line-clamp-2 font-medium leading-6 transition-colors hover:text-primary"
                        >
                          {item.title}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-base-content/50">
                          <span>#{item.id.toString()}</span>
                          <span>/</span>
                          <span>{categoryName}</span>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="text-right font-mono text-sm">{getSubmissionBountyLabel(item)}</td>
                      <td className="text-sm text-base-content/70">{getSubmissionBountyDeadline(item)}</td>
                      <td className="text-right font-mono text-sm">{getSubmissionFeedbackLabel(item)}</td>
                      <td className="text-right tabular-nums">{item.totalVotes}</td>
                      <td className="text-right tabular-nums">{item.totalRounds}</td>
                      <td className="text-right font-mono text-sm">{getRatingLabel(item)}</td>
                      <td className="text-sm text-base-content/70">{formatDate(item.createdAt)}</td>
                      <td className="text-right">
                        <Link
                          href={buildRateContentHref(item.id, {
                            chainId: item.chainId,
                            deploymentKey: item.deploymentKey,
                          })}
                          className="btn btn-ghost btn-xs rounded-lg"
                          aria-label={`View submission ${item.id.toString()}`}
                        >
                          <EyeIcon className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-base-content/60">
        <div className="flex items-center gap-2">
          {isLoading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : null}
          <span>
            Showing {pageStart}-{pageEnd} of {totalContent}
          </span>
        </div>
        <div className="join">
          <button
            type="button"
            className="btn join-item btn-sm rounded-l-lg"
            disabled={page === 0}
            onClick={() => setPage(current => Math.max(0, current - 1))}
            aria-label="Previous submissions page"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn join-item btn-sm rounded-r-lg"
            disabled={!hasMore}
            onClick={() => setPage(current => current + 1)}
            aria-label="Next submissions page"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
