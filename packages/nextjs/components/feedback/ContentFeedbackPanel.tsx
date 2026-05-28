"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { zeroHash } from "viem";
import { useAccount } from "wagmi";
import {
  ArrowTopRightOnSquareIcon,
  BanknotesIcon,
  ChatBubbleLeftEllipsisIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { AwardFeedbackBonusModal } from "~~/components/feedback/AwardFeedbackBonusModal";
import { SafeExternalLink } from "~~/components/shared/SafeExternalLink";
import { TooltipAnchor } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import type { ContentItem } from "~~/hooks/useContentFeed";
import { useContentFeedback } from "~~/hooks/useContentFeedback";
import { getContentFeedbackSubmitTooltip } from "~~/lib/feedback/contentFeedbackSubmitState";
import {
  CONTENT_FEEDBACK_BODY_MAX_LENGTH,
  CONTENT_FEEDBACK_TYPES,
  CONTENT_FEEDBACK_TYPE_LABELS,
  type ContentFeedbackBonusPool,
  type ContentFeedbackItem,
  type ContentFeedbackType,
} from "~~/lib/feedback/types";
import { notification } from "~~/utils/scaffold-eth";

interface ContentFeedbackPanelProps {
  item: ContentItem | null;
  hasOptimisticCurrentRoundVote?: boolean;
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

function hasNonZeroCommit(value: unknown) {
  return typeof value === "string" && value !== zeroHash;
}

function hasHexFeedbackHash(item: ContentFeedbackItem) {
  return typeof item.feedbackHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(item.feedbackHash);
}

function FeedbackItem({
  item,
  awardablePoolCount,
  canReveal,
  isAwarded,
  isRevealing,
  onAward,
  onReveal,
}: {
  item: ContentFeedbackItem;
  awardablePoolCount?: number;
  canReveal?: boolean;
  isAwarded?: boolean;
  isRevealing?: boolean;
  onAward?: (item: ContentFeedbackItem) => void;
  onReveal?: (item: ContentFeedbackItem) => void;
}) {
  const visibilityLabel = item.isPublic ? "Public" : "Private until settlement";
  const visibilityTooltip = item.isPublic
    ? "This feedback is visible to everyone because the round has settled."
    : "Only you can see this feedback while voting is active. It becomes public after settlement.";
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
          {canReveal ? (
            <TooltipAnchor text="Publish this settled feedback on-chain" position="top" className="rounded-full">
              <button
                type="button"
                className="vote-btn vote-btn-sm vote-light"
                onClick={() => onReveal?.(item)}
                disabled={isRevealing}
                aria-label="Publish feedback on-chain"
              >
                <span className="vote-bg" />
                <span className="vote-symbol">
                  {isRevealing ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
              </button>
            </TooltipAnchor>
          ) : null}
          <TooltipAnchor text={visibilityTooltip} position="top" className="rounded-full">
            <span
              tabIndex={0}
              className="rounded-full bg-base-content/[0.07] px-2 py-1 text-[0.66rem] font-semibold leading-none text-base-content/58"
              aria-label={`${visibilityLabel}: ${visibilityTooltip}`}
            >
              {visibilityLabel}
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
  hasOptimisticCurrentRoundVote = false,
  variant = "rail",
  onRequestConnect,
}: ContentFeedbackPanelProps) {
  const { address } = useAccount();
  const { feedback, items, isLoading, isSubmitting, isRevealing, submitFeedback, revealFeedback, refetchFeedback } =
    useContentFeedback(item?.id ?? null, address);
  const [feedbackType, setFeedbackType] = useState<ContentFeedbackType>("evidence");
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [awardTarget, setAwardTarget] = useState<ContentFeedbackItem | null>(null);
  const isSheet = variant === "sheet";
  const isFeatureAcceptanceTest = item?.resultSpecHash?.toLowerCase() === FEATURE_ACCEPTANCE_RESULT_SPEC_HASH;
  const defaultFeedbackType: ContentFeedbackType = isFeatureAcceptanceTest ? "bug_report" : "evidence";
  const feedbackPlaceholder = isFeatureAcceptanceTest
    ? FEATURE_ACCEPTANCE_PLACEHOLDER
    : "Evidence, ambiguity, missing context, source issues...";
  const bodyLength = body.trim().length;
  const itemOpenRoundId = item?.openRound?.roundId ?? 0n;
  const feedbackOpenRoundId = feedback.openRoundId ? BigInt(feedback.openRoundId) : 0n;
  const openRoundId = itemOpenRoundId > 0n ? itemOpenRoundId : feedbackOpenRoundId;
  const { data: myCommitHash } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "voterCommitHash" as any,
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
  const hasCurrentRoundVote =
    hasOptimisticCurrentRoundVote || hasNonZeroCommit(myCommitHash) || hasNonZeroCommit(myAdvisoryCommitKey);
  const isFeedbackOpen = openRoundId > 0n;
  const canSubmitDraft = Boolean(item && bodyLength >= 4 && bodyLength <= CONTENT_FEEDBACK_BODY_MAX_LENGTH);
  const isOwnContent = Boolean(item?.isOwnContent);
  const submitDisabled = !canSubmitDraft || isSubmitting || !isFeedbackOpen || !hasCurrentRoundVote || isOwnContent;
  const submitTooltip = getContentFeedbackSubmitTooltip({
    canSubmitDraft,
    hasCurrentRoundVote,
    isFeedbackOpen,
    isOwnContent,
  });
  const submitButtonToneClassName = isFeedbackOpen && hasCurrentRoundVote ? "vote-feedback" : "vote-light";
  const ownHiddenCopy =
    feedback.ownHiddenCount > 0
      ? `${feedback.ownHiddenCount} hidden note${feedback.ownHiddenCount === 1 ? "" : "s"} from you`
      : null;
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
  const getAwardablePoolsForFeedback = (feedbackItem: ContentFeedbackItem): ContentFeedbackBonusPool[] => {
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmitDraft || !isFeedbackOpen || !hasCurrentRoundVote || isOwnContent) return;

    if (!address) {
      notification.info("Sign in to add feedback.");
      onRequestConnect?.();
      return;
    }

    const result = await submitFeedback({
      feedbackType,
      body,
      sourceUrl: sourceUrl.trim() || undefined,
      commitHash: hasNonZeroCommit(myCommitHash) ? (myCommitHash as `0x${string}`) : null,
    });

    if (!result.ok) {
      if (result.reason === "rejected") return;
      notification.error(result.error || "Failed to add feedback");
      return;
    }

    setBody("");
    setSourceUrl("");
    notification.success(feedback.settlementComplete ? "Feedback published" : "Feedback added until settlement");
  };

  const handleRevealFeedback = async (feedbackItem: ContentFeedbackItem) => {
    const result = await revealFeedback(feedbackItem);
    if (!result.ok) {
      if (result.reason === "rejected") return;
      notification.error(result.error || "Failed to publish feedback on-chain");
      return;
    }

    notification.success("Feedback published on-chain");
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
          <LockClosedIcon className="h-3.5 w-3.5" />
          {feedback.publicCount}
        </span>
      </div>

      {ownHiddenCopy ? (
        <div className="surface-card-nested mt-3 rounded-lg px-3 py-2">
          <p className="text-xs leading-relaxed text-base-content/60">{ownHiddenCopy}</p>
        </div>
      ) : null}

      <form className="mt-3 flex shrink-0 flex-col gap-2.5" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor={`feedback-type-${item?.id?.toString() ?? "none"}`}>
          Feedback type
        </label>
        <select
          id={`feedback-type-${item?.id?.toString() ?? "none"}`}
          value={feedbackType}
          onChange={event => setFeedbackType(event.target.value as ContentFeedbackType)}
          className="select select-sm w-full rounded-lg border-base-content/10 bg-base-200 text-sm font-medium focus:outline-none"
          disabled={!item || isSubmitting}
        >
          {CONTENT_FEEDBACK_TYPES.map(type => (
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
          disabled={!item || isSubmitting}
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
          disabled={!item || isSubmitting}
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
            {visibleItems.map(feedbackItem => (
              <FeedbackItem
                key={feedbackItem.id}
                item={feedbackItem}
                awardablePoolCount={getAwardablePoolsForFeedback(feedbackItem).length}
                canReveal={feedback.settlementComplete && feedbackItem.isOwn && !feedbackItem.isPublic}
                isAwarded={(feedbackItem.feedbackBonusAwards ?? []).length > 0}
                isRevealing={isRevealing}
                onAward={setAwardTarget}
                onReveal={handleRevealFeedback}
              />
            ))}
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
