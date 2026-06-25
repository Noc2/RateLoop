"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ArrowTopRightOnSquareIcon, BanknotesIcon, ChatBubbleLeftEllipsisIcon } from "@heroicons/react/24/outline";
import { AwardFeedbackBonusModal } from "~~/components/feedback/AwardFeedbackBonusModal";
import { SafeExternalLink } from "~~/components/shared/SafeExternalLink";
import { TooltipAnchor } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { useContentFeedback } from "~~/hooks/useContentFeedback";
import {
  ADVISORY_ONLY_CONTENT_FEEDBACK_DISABLED_REASON,
  getContentFeedbackSubmitTooltip,
} from "~~/lib/feedback/contentFeedbackSubmitState";
import {
  CONTENT_FEEDBACK_BODY_MAX_LENGTH,
  CONTENT_FEEDBACK_PICKER_TYPES,
  CONTENT_FEEDBACK_TYPE_LABELS,
  type ContentFeedbackBonusPool,
  type ContentFeedbackItem,
  type ContentFeedbackType,
} from "~~/lib/feedback/types";
import { hasNonZeroCommit } from "~~/lib/vote/commitState";
import { notification } from "~~/utils/scaffold-eth";

interface ContentFeedbackPanelProps {
  item: ContentItem | null;
  hasOptimisticStakedCurrentRoundVote?: boolean;
  submitBlocker?: string | null;
  variant?: "rail" | "sheet";
  onRequestConnect?: () => void;
}

const FEATURE_ACCEPTANCE_RESULT_SPEC_HASH = "0x383236243362c424465503c886244a54c7b038d76e7aa5e06b0e4c70c61d246b";
const FEATURE_ACCEPTANCE_PLACEHOLDER = "Actual result:\nExpected result:\nSteps to reproduce:\nEnvironment:";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatFeedbackDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function readCommitHash(value: unknown): `0x${string}` | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return hasNonZeroCommit(candidate) ? (candidate as `0x${string}`) : null;
}

function hasHexFeedbackHash(item: ContentFeedbackItem) {
  return typeof item.feedbackHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(item.feedbackHash);
}

function isFeedbackForRound(item: ContentFeedbackItem, roundId: bigint) {
  if (!item.roundId || roundId <= 0n) return false;
  try {
    return BigInt(item.roundId) === roundId;
  } catch {
    return false;
  }
}

function FeedbackItem({
  item,
  awardablePoolCount,
  isAwarded,
  onAward,
}: {
  item: ContentFeedbackItem;
  awardablePoolCount?: number;
  isAwarded?: boolean;
  onAward?: (item: ContentFeedbackItem) => void;
}) {
  const visibilityTooltip = "This feedback is visible to everyone because it was published on-chain.";
  const canAwardFeedback = Boolean(awardablePoolCount && awardablePoolCount > 0);

  return (
    <li className="surface-card-nested rounded-lg p-3">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-base-content">{item.feedbackTypeLabel}</p>
          <p className="mt-1 text-xs leading-none text-base-content/60">
            {shortenAddress(item.authorAddress)} · {formatFeedbackDate(item.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canAwardFeedback ? (
            <TooltipAnchor
              text="Award this feedback from your Feedback Bonus pool"
              position="top"
              className="rounded-full"
            >
              <button
                type="button"
                className="vote-btn vote-btn-sm vote-feedback"
                onClick={() => onAward?.(item)}
                aria-label="Award Feedback Bonus"
              >
                <span className="vote-bg" />
                <span className="vote-symbol">
                  <BanknotesIcon className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </TooltipAnchor>
          ) : isAwarded ? (
            <TooltipAnchor text="Feedback Bonus already paid to this feedback" position="top" className="rounded-full">
              <span
                tabIndex={0}
                className="rounded-full bg-success/10 px-2 py-1 text-[0.66rem] font-semibold leading-none text-success"
                aria-label="Feedback Bonus awarded"
              >
                Awarded
              </span>
            </TooltipAnchor>
          ) : null}
          <TooltipAnchor text={visibilityTooltip} position="top" className="rounded-full">
            <span
              tabIndex={0}
              className="rounded-full bg-base-content/[0.07] px-2 py-1 text-[0.66rem] font-semibold leading-none text-base-content/58"
              aria-label={`Public: ${visibilityTooltip}`}
            >
              Public
            </span>
          </TooltipAnchor>
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-base-content/78">{item.body}</p>
      {item.sourceUrl ? (
        <SafeExternalLink
          href={item.sourceUrl}
          allowExternalOpen
          className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:text-primary-focus hover:underline"
          ariaLabel="Open feedback source"
        >
          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Source</span>
        </SafeExternalLink>
      ) : null}
    </li>
  );
}

export function ContentFeedbackPanel({
  item,
  hasOptimisticStakedCurrentRoundVote = false,
  submitBlocker = null,
  variant = "rail",
  onRequestConnect,
}: ContentFeedbackPanelProps) {
  const { address } = useAccount();
  const { feedback, items, isLoading, isSubmitting, submitFeedback, refetchFeedback } = useContentFeedback(
    item?.id ?? null,
    address,
  );
  const [feedbackType, setFeedbackType] = useState<ContentFeedbackType>("vote_rationale");
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [awardTarget, setAwardTarget] = useState<ContentFeedbackItem | null>(null);
  const isSheet = variant === "sheet";
  const isFeatureAcceptanceTest = item?.resultSpecHash?.toLowerCase() === FEATURE_ACCEPTANCE_RESULT_SPEC_HASH;
  const defaultFeedbackType: ContentFeedbackType = isFeatureAcceptanceTest ? "bug_report" : "vote_rationale";
  const feedbackPlaceholder = isFeatureAcceptanceTest
    ? FEATURE_ACCEPTANCE_PLACEHOLDER
    : "Opinion, evidence, ambiguity, concerns...";
  const bodyLength = body.trim().length;
  const itemOpenRoundId = item?.openRound?.roundId ?? 0n;
  const feedbackOpenRoundId = feedback.openRoundId ? BigInt(feedback.openRoundId) : 0n;
  const openRoundId = itemOpenRoundId > 0n ? itemOpenRoundId : feedbackOpenRoundId;
  const { data: myCommitState } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "voterCommitKey" as any,
    args: [item?.id ?? 0n, openRoundId, address] as any,
    watch: true,
    query: { enabled: Boolean(item && address && openRoundId > 0n) },
  } as any);
  const { data: myAdvisoryCommitKey } = useScaffoldReadContract({
    contractName: "AdvisoryVoteRecorder" as any,
    functionName: "advisoryCommitKeyByRater" as any,
    args: [item?.id ?? 0n, openRoundId, address] as any,
    watch: true,
    query: { enabled: Boolean(item && address && openRoundId > 0n) },
  } as any);
  const hasStakedCurrentRoundVote = hasOptimisticStakedCurrentRoundVote || hasNonZeroCommit(myCommitState);
  const hasAdvisoryCurrentRoundVote = hasNonZeroCommit(myAdvisoryCommitKey);
  const hasCurrentRoundVote = hasStakedCurrentRoundVote || hasAdvisoryCurrentRoundVote;
  const advisoryOnlyFeedbackBlocker =
    hasAdvisoryCurrentRoundVote && !hasStakedCurrentRoundVote ? ADVISORY_ONLY_CONTENT_FEEDBACK_DISABLED_REASON : null;
  const isFeedbackOpen = openRoundId > 0n;
  const hasCurrentRoundFeedback = useMemo(
    () => items.some(feedbackItem => feedbackItem.isOwn && isFeedbackForRound(feedbackItem, openRoundId)),
    [items, openRoundId],
  );
  const canSubmitDraft = Boolean(item && bodyLength >= 4 && bodyLength <= CONTENT_FEEDBACK_BODY_MAX_LENGTH);
  const isOwnContent = Boolean(item?.isOwnContent);
  const submitDisabled =
    !canSubmitDraft ||
    isSubmitting ||
    Boolean(submitBlocker) ||
    Boolean(advisoryOnlyFeedbackBlocker) ||
    !isFeedbackOpen ||
    !hasCurrentRoundVote ||
    hasCurrentRoundFeedback ||
    isOwnContent;
  const submitTooltip = getContentFeedbackSubmitTooltip({
    advisoryOnlyFeedbackBlocker,
    canSubmitDraft,
    hasCurrentRoundVote,
    hasCurrentRoundFeedback,
    isFeedbackOpen,
    isOwnContent,
    submitBlocker,
  });
  const submitButtonToneClassName =
    isFeedbackOpen && hasStakedCurrentRoundVote && !submitBlocker ? "vote-feedback" : "vote-light";
  const feedbackFieldsDisabled = !item || isSubmitting || Boolean(submitBlocker);
  const panelClassName = isSheet
    ? "flex min-h-0 flex-col overflow-visible"
    : "surface-card flex min-h-0 max-h-[clamp(24rem,46vh,34rem)] flex-col overflow-hidden rounded-lg p-3.5";

  useEffect(() => {
    setFeedbackType(defaultFeedbackType);
  }, [defaultFeedbackType, item?.id]);

  const visibleItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.isPublic !== b.isPublic) return a.isPublic ? 1 : -1;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [items]);
  const awardablePools = feedback.awardableFeedbackBonusPools ?? [];
  const getOpenPoolsForFeedback = (feedbackItem: ContentFeedbackItem): ContentFeedbackBonusPool[] => {
    if (!feedbackItem.isPublic || !hasHexFeedbackHash(feedbackItem) || !feedbackItem.roundId) return [];

    const awardedPoolIds = new Set((feedbackItem.feedbackBonusAwards ?? []).map(award => award.poolId));
    return awardablePools.filter(pool => {
      if (pool.roundId !== feedbackItem.roundId || awardedPoolIds.has(pool.id)) return false;
      try {
        return BigInt(pool.remainingAmount) > 0n;
      } catch {
        return false;
      }
    });
  };
  const getAwardablePoolsForFeedback = (feedbackItem: ContentFeedbackItem): ContentFeedbackBonusPool[] => {
    return getOpenPoolsForFeedback(feedbackItem);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitBlocker) {
      notification.info(submitBlocker, { duration: 6000 });
      return;
    }
    if (advisoryOnlyFeedbackBlocker) {
      notification.info(advisoryOnlyFeedbackBlocker, { duration: 6000 });
      return;
    }
    if (!canSubmitDraft || !isFeedbackOpen || !hasStakedCurrentRoundVote || hasCurrentRoundFeedback || isOwnContent) {
      return;
    }

    if (!address) {
      notification.info("Sign in to add feedback.");
      onRequestConnect?.();
      return;
    }

    const result = await submitFeedback({
      feedbackType,
      body,
      sourceUrl: sourceUrl.trim() || undefined,
      commitHash: readCommitHash(myCommitState),
    });

    if (!result.ok) {
      if (result.reason === "rejected") return;
      notification.error(result.error || "Failed to add feedback");
      return;
    }

    setBody("");
    setSourceUrl("");
    notification.success(
      result.alreadyPublished ? "Feedback already published on-chain" : "Feedback published on-chain",
    );
  };

  return (
    <section className={panelClassName} aria-label="Question feedback">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight text-base-content">
            {isFeatureAcceptanceTest ? "Feature Feedback" : "Optional Feedback"}
          </h3>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-base-content/[0.07] px-2.5 py-1 text-xs font-semibold leading-none text-base-content/62">
          <ChatBubbleLeftEllipsisIcon className="h-3.5 w-3.5" />
          {feedback.publicCount}
        </span>
      </div>

      <form className="mt-3 flex shrink-0 flex-col gap-2.5" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`feedback-type-${item?.id?.toString() ?? "none"}`}>
          Feedback type
        </label>
        <select
          id={`feedback-type-${item?.id?.toString() ?? "none"}`}
          value={feedbackType}
          onChange={event => setFeedbackType(event.target.value as ContentFeedbackType)}
          className="select select-sm w-full rounded-lg border-base-content/10 bg-base-200 text-sm font-medium focus:outline-none"
          disabled={feedbackFieldsDisabled}
        >
          {CONTENT_FEEDBACK_PICKER_TYPES.map(type => (
            <option key={type} value={type}>
              {CONTENT_FEEDBACK_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`feedback-body-${item?.id?.toString() ?? "none"}`}>
          Feedback
        </label>
        <textarea
          id={`feedback-body-${item?.id?.toString() ?? "none"}`}
          value={body}
          onChange={event => setBody(event.target.value)}
          maxLength={CONTENT_FEEDBACK_BODY_MAX_LENGTH}
          rows={isSheet ? 4 : 3}
          className="textarea min-h-24 w-full resize-none rounded-lg border-base-content/10 bg-base-200 text-sm leading-relaxed focus:outline-none"
          placeholder={feedbackPlaceholder}
          disabled={feedbackFieldsDisabled}
        />

        <label className="sr-only" htmlFor={`feedback-source-${item?.id?.toString() ?? "none"}`}>
          Source URL
        </label>
        <input
          id={`feedback-source-${item?.id?.toString() ?? "none"}`}
          value={sourceUrl}
          onChange={event => setSourceUrl(event.target.value)}
          className="input input-sm w-full rounded-lg border-base-content/10 bg-base-200 text-sm focus:outline-none"
          placeholder="Source URL, optional"
          disabled={feedbackFieldsDisabled}
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tabular-nums text-base-content/60">
            {bodyLength}/{CONTENT_FEEDBACK_BODY_MAX_LENGTH}
          </span>
          <TooltipAnchor text={submitTooltip} position="top" className="rounded-full">
            <button
              type="submit"
              className={`vote-btn vote-btn-sm ${submitButtonToneClassName}`}
              disabled={submitDisabled}
              aria-label="Add feedback"
              title={submitTooltip}
            >
              <span className="vote-bg" />
              <span className="vote-symbol">
                {isSubmitting ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <ChatBubbleLeftEllipsisIcon className="h-5 w-5 drop-shadow-sm" aria-hidden="true" />
                )}
              </span>
            </button>
          </TooltipAnchor>
        </div>
      </form>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-base-content/50">
            <span className="loading loading-spinner loading-xs text-primary" />
            Loading feedback...
          </div>
        ) : visibleItems.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {visibleItems.map(feedbackItem => {
              return (
                <FeedbackItem
                  key={feedbackItem.id}
                  item={feedbackItem}
                  awardablePoolCount={getAwardablePoolsForFeedback(feedbackItem).length}
                  isAwarded={(feedbackItem.feedbackBonusAwards ?? []).length > 0}
                  onAward={setAwardTarget}
                />
              );
            })}
          </ul>
        ) : feedback.settlementComplete ? (
          <p className="surface-card-nested rounded-lg px-3 py-3 text-sm leading-relaxed text-base-content/60">
            No feedback yet.
          </p>
        ) : null}
      </div>
      {awardTarget ? (
        <AwardFeedbackBonusModal
          item={awardTarget}
          pools={getAwardablePoolsForFeedback(awardTarget)}
          onAwarded={() => void refetchFeedback()}
          onClose={() => setAwardTarget(null)}
        />
      ) : null}
    </section>
  );
}
