"use client";

import React, { type ReactNode, useEffect, useState } from "react";
import { ChatBubbleLeftRightIcon, ShareIcon } from "@heroicons/react/24/outline";
import { MoreToggleButton } from "~~/components/shared/MoreToggleButton";
import { RateLoopVoteButton } from "~~/components/shared/RateLoopVoteButton";
import { RatingOrb } from "~~/components/shared/RatingOrb";
import { RoundProgress } from "~~/components/shared/RoundProgress";
import { RoundRevealedBreakdown, RoundStats } from "~~/components/shared/RoundStats";
import { HoverTooltip, InfoTooltip, TooltipAnchor } from "~~/components/ui/InfoTooltip";
import type { ContentOpenRoundSummary, RewardPoolCurrency } from "~~/hooks/contentFeed/shared";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useRoundSnapshot } from "~~/hooks/useRoundSnapshot";
import type { ViewerRewardStatus } from "~~/hooks/useViewerRewardStatuses";
import {
  COMMIT_AVAILABILITY_STATUS,
  type VotingConfig,
  getRoundVoteUnavailableMessage,
  isRoundAcceptingVotes,
} from "~~/lib/contracts/roundVotingEngine";
import { formatSubmissionRewardAmount, formatUsdAmount } from "~~/lib/questionRewardPools";
import { hasNonZeroCommit } from "~~/lib/vote/commitState";
import { formatVoteCooldownRemaining } from "~~/lib/vote/cooldown";
import { describeOpenRoundActivity, formatLrepAmount, getRoundProgressMessaging } from "~~/lib/vote/voteIncentives";
import type { VoteUiConfig } from "~~/lib/vote/voteUiConfig";
import { getRatingGuidanceText } from "~~/lib/vote/voteUiConfig";
import { resolveVotingQuestionCardDisplayError } from "~~/lib/vote/votingQuestionCardStatus";

interface VotingQuestionCardProps {
  contentId: bigint;
  categoryId: bigint;
  chainId?: number | null;
  questionTitle?: string;
  currentRating: number | null;
  ratingReviewStatus?: number | string | null;
  ratingReviewRoundId?: bigint | string | number | null;
  onVote: (isUp: boolean) => void;
  isCommitting: boolean;
  address?: string;
  error?: string | null;
  cooldownSecondsRemaining?: number;
  isVoteEligibilityPending?: boolean;
  voteUnavailableStatus?: {
    label: string;
    detail: string;
  } | null;
  isContentActive?: boolean;
  isOwnContent?: boolean;
  pendingRewardStatus?: ViewerRewardStatus | null;
  openRound?: ContentOpenRoundSummary | null;
  roundConfig?: VotingConfig | null;
  /** When true, removes card background/rounding (parent provides it). */
  embedded?: boolean;
  compact?: boolean;
  variant?: "default" | "signal" | "dock";
  attentionToken?: number | null;
  onShareContent?: () => void;
  feedbackUnavailableReason?: string | null;
  onOpenFeedback?: () => void;
  voteUiConfig?: VoteUiConfig;
}

const RATING_REVIEW_PENDING_TOOLTIP = "Waiting for the correlation snapshot before publishing the final rating.";
const RATING_REVIEW_STATUS_PENDING = 1;
const REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty is shown in USD and backed by USDC on the active network. Eligible revealed raters can claim from it in qualified rounds, with 3% reserved for the eligible frontend operator.";
const LREP_REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty is funded in LREP on the active network. Eligible revealed raters can claim from it in qualified rounds, with 3% reserved for the eligible frontend operator.";
const MIXED_REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty includes multiple assets on the active network. Eligible revealed raters can claim from qualified rounds, with 3% reserved for the eligible frontend operator.";
const FEEDBACK_BONUS_TOOLTIP_TEXT =
  "Feedback Bonuses are optional rewards for useful rater feedback. Awarded feedback pays raters after settlement, with 3% reserved for the eligible frontend operator.";
const LREP_FEEDBACK_BONUS_TOOLTIP_TEXT =
  "This Feedback Bonus is funded in LREP. The awarder pays selected revealed feedback after settlement, with 3% reserved for the eligible frontend operator.";
const USDC_FEEDBACK_BONUS_TOOLTIP_TEXT =
  "This Feedback Bonus is funded in USDC. The awarder pays selected revealed feedback after settlement, with 3% reserved for the eligible frontend operator.";
const MIXED_FEEDBACK_BONUS_TOOLTIP_TEXT =
  "This question has Feedback Bonus pools in multiple assets. The awarder pays selected revealed feedback after settlement, with 3% reserved for the eligible frontend operator.";
export const VOTING_SURFACE_BACKGROUND = "var(--rateloop-surface-elevated)";
const STATUS_PILL_CLASS_NAME =
  "reward-chip reward-chip-muted inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-4 py-2";
const DOCK_STATUS_TEXT_CLASS_NAME =
  "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 py-0.5 text-left leading-none";
const DOCK_CONTROL_SIZE_PX = 44;
const DOCK_CONTROL_SIZE = `${DOCK_CONTROL_SIZE_PX / 16}rem`;
const COMPACT_DOCK_ORB_SIZE_PX = 88;
const DOCK_CONTROL_CIRCLE_CLASS_NAME = "h-11 w-11 box-border";
const REWARD_CHIP_INFO_ICON_CLASS_NAME = "[&>svg]:text-[#050505]/70 [&>svg]:hover:text-[#050505]";

type ActivityTone = "primary" | "warning" | "success" | "neutral";

function getActivityToneClassName(tone: ActivityTone) {
  switch (tone) {
    case "primary":
      return "bg-primary/12 text-primary";
    case "warning":
      return "bg-warning/12 text-warning";
    case "success":
      return "bg-success/12 text-success";
    case "neutral":
    default:
      return "bg-base-content/[0.06] text-base-content/72";
  }
}

function getActivityDetailToneClassName(tone: ActivityTone) {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "primary":
      return "text-primary/90";
    case "neutral":
    default:
      return "text-base-content/75";
  }
}

function getPendingRewardStatusCopy(status?: ViewerRewardStatus | null) {
  const hasBounty = Boolean(status?.hasPendingBounty);
  const hasFeedbackBonus = Boolean(status?.hasPendingFeedbackBonus);
  if (!hasBounty && !hasFeedbackBonus) return null;

  if (hasBounty && hasFeedbackBonus) {
    return {
      label: "Bounty + bonus pending",
      tooltip:
        "A bounty claim or payout and a Feedback Bonus review or payment from an earlier round are still pending for this wallet.",
    };
  }

  if (hasBounty) {
    return {
      label: "Bounty pending",
      tooltip: "A bounty claim or payout from an earlier round is still pending for this wallet.",
    };
  }

  return {
    label: "Bonus pending",
    tooltip: "A Feedback Bonus review or payment from an earlier round is still pending for this wallet.",
  };
}

function LiveRoundActivity({
  snapshot,
  compact,
  condensed = false,
}: {
  snapshot: ReturnType<typeof useRoundSnapshot>;
  compact: boolean;
  condensed?: boolean;
}) {
  const progress = getRoundProgressMessaging(snapshot);
  const blindDetail = "Full blind reward weight";
  const isTerminalRound = snapshot.phase !== "voting";
  const detailCopy = isTerminalRound
    ? ""
    : snapshot.isEpoch1
      ? condensed
        ? blindDetail
        : "Blind signals keep full reward weight."
      : condensed
        ? (progress?.detailLabel ?? `${formatLrepAmount(snapshot.totalStake)} LREP active`)
        : describeOpenRoundActivity(snapshot);
  const supportCopy = isTerminalRound
    ? ""
    : snapshot.isEpoch1
      ? "Signals stay hidden until reveal, so early signal stays private while keeping full weight."
      : "Revealed signal is live now. Open signals use informed weight, but they can still help close the round.";
  const condensedDetailCopy =
    progress?.detailLabel ??
    (snapshot.phase === "voting" && snapshot.voteCount >= snapshot.minVoters ? "Waiting for reveals" : detailCopy);
  const showsDedicatedProgressRow = Boolean(progress);

  if (condensed) {
    if (showsDedicatedProgressRow || isTerminalRound) {
      return null;
    }

    return (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-base text-base-content/75">
        {progress ? (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getActivityToneClassName(progress.badgeTone)}`}
          >
            {progress.badgeLabel}
          </span>
        ) : null}
        <InfoTooltip text={progress?.tooltip ?? supportCopy} position="bottom" />
        <span className={`text-base tabular-nums ${getActivityDetailToneClassName(progress?.detailTone ?? "neutral")}`}>
          {condensedDetailCopy}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`surface-card-nested rounded-lg ${
        condensed ? "px-2.5 py-2.5" : compact ? "px-3 py-3" : "px-3.5 py-3.5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        {!condensed ? (
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-base-content/52">
              Live round activity
            </p>
            {!showsDedicatedProgressRow && detailCopy ? (
              <p
                className={`mt-1 leading-relaxed text-base-content/70 ${
                  condensed ? "text-xs" : "text-sm"
                } ${compact ? "max-w-none" : "max-w-[18rem]"}`}
              >
                {detailCopy}
              </p>
            ) : null}
          </div>
        ) : null}
        {!showsDedicatedProgressRow ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {progress ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getActivityToneClassName(progress.badgeTone)}`}
              >
                {progress.badgeLabel}
              </span>
            ) : null}
            {!condensed && progress?.detailLabel ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getActivityToneClassName(progress.detailTone)}`}
              >
                {progress.detailLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className={`grid grid-cols-3 ${condensed ? "mt-2.5 gap-1.5" : "mt-3 gap-2"}`}>
        <div className={`surface-card-nested rounded-lg ${condensed ? "px-2 py-1.5" : "px-3 py-2"}`}>
          <p className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-base-content/60">Committed</p>
          <p
            className={`font-semibold tabular-nums text-base-content ${condensed ? "mt-0.5 text-sm" : "mt-1 text-base"}`}
          >
            {snapshot.voteCount}
          </p>
        </div>
        <div className={`surface-card-nested rounded-lg ${condensed ? "px-2 py-1.5" : "px-3 py-2"}`}>
          <p className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-base-content/60">Revealed</p>
          <p
            className={`font-semibold tabular-nums text-base-content ${condensed ? "mt-0.5 text-sm" : "mt-1 text-base"}`}
          >
            {snapshot.revealedCount}
          </p>
        </div>
        <div className={`surface-card-nested rounded-lg ${condensed ? "px-2 py-1.5" : "px-3 py-2"}`}>
          <p className="text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-base-content/60">Staked</p>
          <p
            className={`font-semibold tabular-nums text-base-content ${condensed ? "mt-0.5 text-sm" : "mt-1 text-base"}`}
          >
            {formatLrepAmount(snapshot.totalStake)}
          </p>
        </div>
      </div>

      {!condensed && supportCopy ? (
        <p className="mt-3 text-sm leading-relaxed text-base-content/56">{supportCopy}</p>
      ) : null}
    </div>
  );
}

function RewardAmountDisplay({
  amount,
  amountLabel,
  deadlineSeconds,
  nowSeconds,
  label,
  tooltip,
  ariaLabel,
  deadlineTooltipSubject,
  tone,
}: {
  amount: bigint;
  amountLabel?: string;
  deadlineSeconds?: bigint | null;
  nowSeconds?: number;
  label: string;
  tooltip: string;
  ariaLabel: string;
  deadlineTooltipSubject: string;
  tone: "blue" | "green";
}) {
  const displayAmountLabel = amountLabel ?? formatUsdAmount(amount);
  const deadlineLabel = formatCompactRewardTimeLeft(deadlineSeconds, nowSeconds);
  const displayTooltip = deadlineLabel ? `${tooltip} ${deadlineTooltipSubject} closes in ${deadlineLabel}.` : tooltip;

  return (
    <div
      className={`reward-chip reward-chip-label reward-chip-brand-${tone}`}
      aria-label={`${displayAmountLabel} ${ariaLabel}${deadlineLabel ? `, closes in ${deadlineLabel}` : ""}`}
    >
      <span>
        <span className="tabular-nums">{displayAmountLabel}</span> {label}
        {deadlineLabel ? <span className="font-mono tabular-nums text-[#050505]/70"> · {deadlineLabel}</span> : null}
      </span>
      <InfoTooltip text={displayTooltip} position="bottom" className={REWARD_CHIP_INFO_ICON_CLASS_NAME} />
    </div>
  );
}

export function formatCompactRewardTimeLeft(
  deadlineSeconds: bigint | number | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (deadlineSeconds === null || deadlineSeconds === undefined) return null;

  const deadline =
    typeof deadlineSeconds === "bigint" ? deadlineSeconds : BigInt(Math.max(0, Math.floor(deadlineSeconds)));
  if (deadline <= 0n) return null;

  const remainingSeconds = deadline - BigInt(Math.floor(nowSeconds));
  if (remainingSeconds < 0n) return null;
  if (remainingSeconds < 60n) return "<1m";
  if (remainingSeconds < 3_600n) return `${remainingSeconds / 60n}m`;
  if (remainingSeconds < 86_400n) return `${remainingSeconds / 3_600n}h`;

  const days = remainingSeconds / 86_400n;
  return days < 30n ? `${days}d` : "30d+";
}

export function getRewardPoolDisplay(amount: bigint, currency: RewardPoolCurrency | undefined) {
  if (currency === "LREP") {
    return {
      amountLabel: formatSubmissionRewardAmount(amount, "lrep"),
      tooltip: LREP_REWARD_POOL_TOOLTIP_TEXT,
    };
  }
  if (currency === "MIXED") {
    return {
      amountLabel: "Mixed",
      tooltip: MIXED_REWARD_POOL_TOOLTIP_TEXT,
    };
  }

  return {
    amountLabel: formatUsdAmount(amount),
    tooltip: REWARD_POOL_TOOLTIP_TEXT,
  };
}

export function RewardPoolAmountDisplay({
  amount,
  currency,
  deadlineSeconds,
  nowSeconds,
}: {
  amount: bigint;
  currency?: RewardPoolCurrency;
  deadlineSeconds?: bigint | null;
  nowSeconds?: number;
}) {
  const display = getRewardPoolDisplay(amount, currency);
  return (
    <RewardAmountDisplay
      amount={amount}
      amountLabel={display.amountLabel}
      deadlineSeconds={deadlineSeconds}
      nowSeconds={nowSeconds}
      label="Bounty"
      tooltip={display.tooltip}
      ariaLabel="Bounty"
      deadlineTooltipSubject="Bounty eligibility"
      tone="blue"
    />
  );
}

export function FeedbackBonusAmountDisplay({
  amount,
  currency,
  deadlineSeconds,
  nowSeconds,
}: {
  amount: bigint;
  currency?: RewardPoolCurrency;
  deadlineSeconds?: bigint | null;
  nowSeconds?: number;
}) {
  const { amountLabel, tooltip } = getFeedbackBonusDisplay(amount, currency);
  return (
    <RewardAmountDisplay
      amount={amount}
      amountLabel={amountLabel}
      deadlineSeconds={deadlineSeconds}
      nowSeconds={nowSeconds}
      label="Feedback Bonus"
      tooltip={tooltip}
      ariaLabel="Feedback Bonus"
      deadlineTooltipSubject="Feedback Bonus award window"
      tone="green"
    />
  );
}

export function getFeedbackBonusDisplay(amount: bigint, currency: RewardPoolCurrency | undefined) {
  const amountLabel =
    currency === "LREP"
      ? formatSubmissionRewardAmount(amount, "lrep")
      : currency === "MIXED"
        ? "Mixed"
        : formatUsdAmount(amount);
  const tooltip =
    currency === "LREP"
      ? LREP_FEEDBACK_BONUS_TOOLTIP_TEXT
      : currency === "MIXED"
        ? MIXED_FEEDBACK_BONUS_TOOLTIP_TEXT
        : currency === "USDC"
          ? USDC_FEEDBACK_BONUS_TOOLTIP_TEXT
          : FEEDBACK_BONUS_TOOLTIP_TEXT;

  return { amountLabel, tooltip };
}

function DockCircleIconButton({
  label,
  onClick,
  icon,
  disabled = false,
  tone = "light",
}: {
  label: string;
  onClick?: () => void;
  icon: ReactNode;
  disabled?: boolean;
  tone?: "light" | "feedback";
}) {
  return (
    <TooltipAnchor text={label} position="top" className={`${DOCK_CONTROL_CIRCLE_CLASS_NAME} shrink-0 rounded-full`}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || !onClick}
        aria-label={label}
        title={label}
        className={`vote-btn vote-btn-sm ${tone === "feedback" ? "vote-feedback" : "vote-light"}`}
      >
        <span className="vote-bg" />
        <span className="vote-symbol">{icon}</span>
      </button>
    </TooltipAnchor>
  );
}

function isRatingReviewPending(status: number | string | null | undefined) {
  const parsed = typeof status === "number" ? status : typeof status === "string" ? Number(status) : 0;
  return Number.isFinite(parsed) && parsed === RATING_REVIEW_STATUS_PENDING;
}

function RatingPendingNotice({ compact = false }: { compact?: boolean }) {
  return (
    <HoverTooltip text={RATING_REVIEW_PENDING_TOOLTIP} position="bottom">
      <span
        className={`inline-flex items-center rounded-full bg-primary/10 font-semibold text-primary ${
          compact ? "px-2 py-0.5 text-[0.68rem]" : "px-2.5 py-1 text-xs"
        }`}
      >
        Rating pending
      </span>
    </HoverTooltip>
  );
}

export function VotingQuestionContextDetails({
  contentId,
  categoryId,
  openRound,
  roundConfig,
  compact = false,
  active = true,
  statusChips,
  statusActions,
  voteUiConfig = { mode: "thumbs" },
}: {
  contentId: bigint;
  categoryId: bigint;
  openRound?: ContentOpenRoundSummary | null;
  roundConfig?: VotingConfig | null;
  compact?: boolean;
  active?: boolean;
  statusChips?: ReactNode;
  statusActions?: ReactNode;
  voteUiConfig?: VoteUiConfig;
}) {
  const roundSnapshot = useRoundSnapshot(
    active ? contentId : undefined,
    active ? (openRound ?? undefined) : undefined,
    active ? (roundConfig ?? undefined) : undefined,
  );
  const showInlineVotingSummary = roundSnapshot.phase === "voting";
  const progressMessaging = getRoundProgressMessaging(roundSnapshot);
  const showInlineProgress = showInlineVotingSummary && Boolean(progressMessaging);
  const showInlineRevealedBreakdown = showInlineVotingSummary && roundSnapshot.round.revealedCount > 0;
  const showRoundProgress =
    !showInlineProgress && (roundSnapshot.phase === "voting" || (!roundSnapshot.isReady && !roundSnapshot.hasRound));
  const hasStatusChips = Array.isArray(statusChips) ? statusChips.length > 0 : Boolean(statusChips);
  const showStatusRow = showRoundProgress || hasStatusChips || Boolean(statusActions);

  return (
    <div className={`flex min-w-0 flex-col ${compact ? "gap-1.5" : "gap-2"}`}>
      <LiveRoundActivity snapshot={roundSnapshot} compact={compact} condensed />
      {showStatusRow ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {showRoundProgress ? <RoundProgress snapshot={roundSnapshot} /> : null}
            {statusChips}
          </div>
          {statusActions}
        </div>
      ) : null}
      {!showInlineRevealedBreakdown ? (
        <RoundRevealedBreakdown snapshot={roundSnapshot} stacked={compact} voteUiConfig={voteUiConfig} />
      ) : null}
      <RoundStats categoryId={categoryId} snapshot={roundSnapshot} />
    </div>
  );
}

/**
 * Displays the live rating signal and all voting controls in a separate card.
 */
export function VotingQuestionCard({
  contentId,
  chainId,
  currentRating,
  ratingReviewStatus,
  onVote,
  isCommitting,
  address,
  error,
  cooldownSecondsRemaining = 0,
  isVoteEligibilityPending = false,
  voteUnavailableStatus = null,
  isContentActive = true,
  isOwnContent,
  pendingRewardStatus = null,
  openRound,
  roundConfig,
  embedded,
  compact = false,
  variant = "default",
  attentionToken,
  onShareContent,
  feedbackUnavailableReason,
  onOpenFeedback,
  voteUiConfig = { mode: "thumbs" },
}: VotingQuestionCardProps) {
  const isSignalVariant = variant === "signal";
  const isDockVariant = variant === "dock";
  const hideEmbeddedSignalSurface = Boolean(embedded && isSignalVariant);

  // Check if user already voted on this content in the current round
  const roundSnapshot = useRoundSnapshot(contentId, openRound ?? undefined, roundConfig ?? undefined);
  const { roundId, isRoundFull } = roundSnapshot;
  const { holder, identityKey } = useRaterRegistryIdentity(address);
  const normalizedAddress = address?.toLowerCase() ?? null;
  const holderAddress = holder && holder.toLowerCase() !== normalizedAddress ? holder : null;
  const roundAcceptsVotes = isRoundAcceptingVotes(roundSnapshot);
  const cooldownActive = cooldownSecondsRemaining > 0;
  const cooldownLabel = formatVoteCooldownRemaining(cooldownSecondsRemaining);
  const roundUnavailableMessage = getRoundVoteUnavailableMessage(roundSnapshot);
  const roundNotAcceptingMessage = !roundAcceptsVotes && !isCommitting ? roundUnavailableMessage : null;
  const displayError = resolveVotingQuestionCardDisplayError({
    cooldownActive,
    error,
    roundNotAcceptingMessage,
  });
  const contentInactive = !isContentActive;
  const ratingPending = isRatingReviewPending(ratingReviewStatus);
  const voteActionDisabled =
    isCommitting || isVoteEligibilityPending || Boolean(voteUnavailableStatus) || contentInactive || !roundAcceptsVotes;
  const [isDetailsOpen, setIsDetailsOpen] = useState(isSignalVariant);
  const [isAttentionActive, setIsAttentionActive] = useState(false);
  const detailsId = `voting-card-details-${contentId.toString()}`;

  // Check if user has committed to this round (direction hidden until reveal).
  const { data: myCommitState } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "voterCommitKey" as any,
    args: [contentId, roundId, address] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!address },
  } as any);
  const { data: myHolderCommitState } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "voterCommitKey" as any,
    args: [contentId, roundId, holderAddress] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!holderAddress },
  } as any);
  const { data: myIdentityCommitState } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "identityCommitState" as any,
    args: [contentId, roundId, identityKey, holder ?? address] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!identityKey && !!(holder ?? address) },
  } as any);
  const { data: myAdvisoryCommitKey } = useScaffoldReadContract({
    contractName: "AdvisoryVoteRecorder" as any,
    functionName: "advisoryCommitKeyByRater" as any,
    args: [contentId, roundId, address] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!address },
  } as any);
  const { data: myHolderAdvisoryCommitKey } = useScaffoldReadContract({
    contractName: "AdvisoryVoteRecorder" as any,
    functionName: "advisoryCommitKeyByRater" as any,
    args: [contentId, roundId, holderAddress] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!holderAddress },
  } as any);
  const { data: myIdentityAdvisoryCommitKey } = useScaffoldReadContract({
    contractName: "AdvisoryVoteRecorder" as any,
    functionName: "advisoryCommitKeyByIdentity" as any,
    args: [contentId, roundId, identityKey] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!identityKey },
  } as any);
  const hasMyVote =
    hasNonZeroCommit(myCommitState) ||
    hasNonZeroCommit(myHolderCommitState) ||
    hasNonZeroCommit(myIdentityCommitState) ||
    hasNonZeroCommit(myAdvisoryCommitKey) ||
    hasNonZeroCommit(myHolderAdvisoryCommitKey) ||
    hasNonZeroCommit(myIdentityAdvisoryCommitKey);
  const usesDockStatusText = isDockVariant;
  const commitAvailabilityStatus = roundSnapshot.commitAvailability?.status;
  const isRoundFullStatus = isRoundFull || commitAvailabilityStatus === COMMIT_AVAILABILITY_STATUS.RoundFull;
  const resolvingStatusLabel =
    commitAvailabilityStatus === COMMIT_AVAILABILITY_STATUS.WaitingForSettlement
      ? "Settling"
      : commitAvailabilityStatus === COMMIT_AVAILABILITY_STATUS.WaitingForRevealGrace
        ? "Resolving"
        : null;
  const pendingRewardStatusCopy = getPendingRewardStatusCopy(pendingRewardStatus);
  const renderPendingRewardStatus = (dock: boolean) =>
    pendingRewardStatusCopy ? (
      <span
        className={
          dock
            ? "text-[0.78rem] font-medium leading-none text-base-content/52"
            : "text-sm font-medium leading-tight text-base-content/52"
        }
      >
        {pendingRewardStatusCopy.label}
      </span>
    ) : null;
  const submittedStatusTooltip = pendingRewardStatusCopy
    ? `You submitted a private thumbs-up/down signal and crowd forecast. After the epoch, eligible signals are normally revealed automatically, and you can self-reveal if needed. ${pendingRewardStatusCopy.tooltip}`
    : "You submitted a private thumbs-up/down signal and crowd forecast. After the epoch, eligible signals are normally revealed automatically, and you can self-reveal if needed.";
  const cooldownStatusTooltip = pendingRewardStatusCopy
    ? `You already voted on this content within the last 24 hours. Try again in ${cooldownLabel}. ${pendingRewardStatusCopy.tooltip}`
    : `You already voted on this content within the last 24 hours. Try again in ${cooldownLabel}.`;

  const centerStatusContent = contentInactive ? (
    <HoverTooltip text="This content is no longer active for voting." position="bottom">
      {usesDockStatusText ? (
        <span className={`${DOCK_STATUS_TEXT_CLASS_NAME} text-[0.95rem] leading-tight text-base-content/68`}>
          Inactive
        </span>
      ) : (
        <span className={STATUS_PILL_CLASS_NAME}>
          <span className="text-base text-base-content/65">Inactive</span>
        </span>
      )}
    </HoverTooltip>
  ) : address ? (
    hasMyVote ? (
      <HoverTooltip text={submittedStatusTooltip} position="bottom">
        {usesDockStatusText ? (
          <span className={DOCK_STATUS_TEXT_CLASS_NAME}>
            <span className="text-[0.95rem] font-semibold leading-none text-primary">Submitted</span>
            <span className="text-[0.95rem] leading-none text-base-content/62">hidden</span>
            {renderPendingRewardStatus(true)}
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base font-semibold text-primary">Submitted</span>
            <span className="text-base text-base-content/70">hidden</span>
            {renderPendingRewardStatus(false)}
          </span>
        )}
      </HoverTooltip>
    ) : isOwnContent ? (
      <HoverTooltip text="Content submitters cannot vote on their own submissions." position="bottom">
        {usesDockStatusText ? (
          <span
            className={`${DOCK_STATUS_TEXT_CLASS_NAME} max-w-[7.25rem] text-[0.95rem] leading-tight text-base-content/68`}
          >
            Your question
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base text-base-content/65">Your question</span>
          </span>
        )}
      </HoverTooltip>
    ) : voteUnavailableStatus ? (
      <HoverTooltip text={voteUnavailableStatus.detail} position="bottom">
        {usesDockStatusText ? (
          <span
            className={`${DOCK_STATUS_TEXT_CLASS_NAME} max-w-[7.25rem] text-[0.95rem] leading-tight text-base-content/68`}
          >
            {voteUnavailableStatus.label}
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base text-base-content/65">{voteUnavailableStatus.label}</span>
          </span>
        )}
      </HoverTooltip>
    ) : cooldownActive ? (
      <HoverTooltip text={cooldownStatusTooltip} position="bottom">
        {usesDockStatusText ? (
          <span className={DOCK_STATUS_TEXT_CLASS_NAME}>
            <span className="text-[0.95rem] font-medium leading-none text-base-content/75">Cooldown</span>
            <span className="text-[0.95rem] leading-none text-base-content/60">{cooldownLabel}</span>
            {renderPendingRewardStatus(true)}
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base font-medium text-base-content/75">Cooldown</span>
            <span className="text-base text-base-content/60">{cooldownLabel}</span>
            {renderPendingRewardStatus(false)}
          </span>
        )}
      </HoverTooltip>
    ) : isRoundFullStatus ? (
      <HoverTooltip
        text={roundUnavailableMessage ?? "This round has reached the maximum number of voters."}
        position="bottom"
      >
        {usesDockStatusText ? (
          <span className={`${DOCK_STATUS_TEXT_CLASS_NAME} text-[0.95rem] leading-tight text-base-content/68`}>
            Round full
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base text-base-content/65">Round full</span>
          </span>
        )}
      </HoverTooltip>
    ) : resolvingStatusLabel ? (
      <HoverTooltip text={roundUnavailableMessage ?? "This round is waiting for resolution."} position="bottom">
        {usesDockStatusText ? (
          <span className={`${DOCK_STATUS_TEXT_CLASS_NAME} text-[0.95rem] leading-tight text-base-content/68`}>
            {resolvingStatusLabel}
          </span>
        ) : (
          <span className={STATUS_PILL_CLASS_NAME}>
            <span className="text-base text-base-content/65">{resolvingStatusLabel}</span>
          </span>
        )}
      </HoverTooltip>
    ) : null
  ) : null;
  const orbSize = isDockVariant
    ? compact
      ? COMPACT_DOCK_ORB_SIZE_PX
      : 100
    : isSignalVariant
      ? compact
        ? 148
        : 168
      : compact
        ? 166
        : 190;
  const shellClassName = compact ? "p-3 space-y-2.5" : "p-4 space-y-3 xl:p-3 xl:space-y-2.5 2xl:p-4 2xl:space-y-3";
  const actionStackClassName = compact ? "mt-2.5 gap-1.5" : "mt-3 gap-2";
  const footerStackClassName = compact ? "mt-2.5 gap-2" : "mt-3 gap-3 xl:mt-2.5 xl:gap-2.5 2xl:mt-3 2xl:gap-3";
  const hasExpandableDetails = false;
  const showExpandedDetails = hasExpandableDetails && (isSignalVariant || (isDetailsOpen && !isDockVariant));
  const showVoteAttentionHint = isAttentionActive && !centerStatusContent;
  const ratingGuidanceText = getRatingGuidanceText(voteUiConfig);
  const ratingOrb = (
    <TooltipAnchor text={ratingGuidanceText} position="bottom" className="pointer-events-auto cursor-help rounded-full">
      <RatingOrb rating={currentRating} size={orbSize} />
    </TooltipAnchor>
  );

  useEffect(() => {
    setIsDetailsOpen(hasExpandableDetails && isSignalVariant);
  }, [contentId, hasExpandableDetails, isSignalVariant]);

  useEffect(() => {
    if (!attentionToken) return;

    setIsAttentionActive(false);
    const frameId = window.requestAnimationFrame(() => setIsAttentionActive(true));
    const timeoutId = window.setTimeout(() => setIsAttentionActive(false), 1100);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [attentionToken]);

  if (isDockVariant) {
    const dockStatusReplacesVoteButtons = Boolean(
      contentInactive ||
        (address && (hasMyVote || isOwnContent || cooldownActive || isRoundFullStatus || resolvingStatusLabel)),
    );
    const dockCenterStatusContent =
      voteUnavailableStatus && !dockStatusReplacesVoteButtons ? null : centerStatusContent;
    const dockVoteDisabled = voteActionDisabled || Boolean(dockCenterStatusContent);
    const dockNotchRadius = compact ? 58 : 66;
    const dockNotchCutout = compact ? 52 : 60;
    const dockWrapperTopPaddingClassName = compact ? (isDetailsOpen ? "pt-8" : "pt-10") : "pt-14";
    const dockControlsPaddingClassName = compact ? "px-4 pb-2.5 pt-4" : "px-4 pb-3 pt-7";
    const dockMoreClassName = "text-base font-medium text-base-content/68 hover:text-base-content/88";
    const dockVoteSpacerClassName = DOCK_CONTROL_CIRCLE_CLASS_NAME;
    const dockShellMaskStyle = {
      WebkitMaskImage: `radial-gradient(circle ${dockNotchRadius}px at 50% 0, transparent 0 ${dockNotchCutout}px, black ${dockNotchCutout + 1}px)`,
      maskImage: `radial-gradient(circle ${dockNotchRadius}px at 50% 0, transparent 0 ${dockNotchCutout}px, black ${dockNotchCutout + 1}px)`,
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
    };
    const dockSurfaceStyle = {
      background: compact ? "var(--rateloop-surface-mobile-vote)" : VOTING_SURFACE_BACKGROUND,
    };
    const dockContentStyle = compact ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined;
    const dockShellClassName = compact ? "rounded-none" : "rounded-[2rem]";
    const dockShellBorderClassName = compact ? "" : "ring-1 ring-base-content/8";
    const dockTopBorderArcRadius = dockNotchCutout;
    const dockTopBorderOverlayStyle = compact
      ? {
          height: `${dockTopBorderArcRadius + 2}px`,
        }
      : undefined;
    const dockTopBorderSegmentStyle = compact
      ? {
          width: `calc(50% - ${dockTopBorderArcRadius}px)`,
          borderColor: "var(--rateloop-shell-border-strong)",
        }
      : undefined;
    const dockTopBorderArcStyle = compact
      ? {
          top: `${-dockTopBorderArcRadius}px`,
          width: `${dockTopBorderArcRadius * 2}px`,
          height: `${dockTopBorderArcRadius * 2}px`,
          borderColor: "var(--rateloop-shell-border-strong)",
        }
      : undefined;
    const mobileOrbClassName = compact ? "drop-shadow-[0_14px_28px_rgba(9,10,12,0.7)]" : "";
    const compactDockControlsGridStyle = {
      gridTemplateColumns: `minmax(0, 1fr) ${DOCK_CONTROL_SIZE} minmax(0, 1fr) ${DOCK_CONTROL_SIZE} ${dockNotchCutout * 2}px ${DOCK_CONTROL_SIZE} minmax(0, 1fr) ${DOCK_CONTROL_SIZE} minmax(0, 1fr)`,
    };
    const shareDockButton = (
      <DockCircleIconButton
        label="Share content"
        onClick={onShareContent}
        icon={<ShareIcon className="h-5 w-5 drop-shadow-sm" aria-hidden="true" />}
      />
    );
    const feedbackDockButton = (
      <DockCircleIconButton
        label={feedbackUnavailableReason ?? "Open feedback"}
        onClick={onOpenFeedback}
        icon={<ChatBubbleLeftRightIcon className="h-5 w-5 drop-shadow-sm" aria-hidden="true" />}
        disabled={Boolean(feedbackUnavailableReason)}
        tone={hasMyVote ? "feedback" : "light"}
      />
    );

    return (
      <>
        <div
          className={`relative ${embedded ? "" : "rounded-lg"} flex min-h-0 flex-col transition-[padding-top] duration-200 ease-out ${dockWrapperTopPaddingClassName}`}
        >
          {compact ? (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-[rgba(9,10,12,0.46)] blur-[12px]"
              style={{ width: `${orbSize * 0.84}px`, height: `${orbSize * 0.84}px` }}
            />
          ) : null}
          <div
            className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2"
            data-mobile-dock-rating-orb={compact ? "true" : undefined}
          >
            <TooltipAnchor
              text={ratingGuidanceText}
              position="bottom"
              className="pointer-events-auto cursor-help rounded-full"
            >
              <RatingOrb rating={currentRating} size={orbSize} className={mobileOrbClassName} />
            </TooltipAnchor>
          </div>

          <div className="relative z-10">
            {dockTopBorderOverlayStyle ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-hidden"
                style={dockTopBorderOverlayStyle}
              >
                <div className="absolute left-0 top-0 border-t" style={dockTopBorderSegmentStyle} />
                <div className="absolute right-0 top-0 border-t" style={dockTopBorderSegmentStyle} />
                <div className="absolute left-1/2 -translate-x-1/2 rounded-full border" style={dockTopBorderArcStyle} />
              </div>
            ) : null}
            <div
              className={`relative overflow-hidden shadow-[0_16px_36px_rgb(0_0_0_/_0.28)] ${
                isAttentionActive ? "vote-surface-attention" : ""
              } ${dockShellClassName} ${dockShellBorderClassName}`}
              data-mobile-dock-shell={compact ? "true" : undefined}
              data-vote-attention={isAttentionActive ? "true" : undefined}
              style={{ ...dockShellMaskStyle, ...dockSurfaceStyle }}
            >
              <div style={dockContentStyle}>
                <div className={dockControlsPaddingClassName}>
                  {compact && !dockCenterStatusContent ? (
                    <div className="grid w-full items-center" style={compactDockControlsGridStyle}>
                      <div className="col-start-2 justify-self-center">{shareDockButton}</div>
                      <div className="col-start-4 justify-self-center">
                        <RateLoopVoteButton
                          direction="up"
                          voteUiConfig={voteUiConfig}
                          size="sm"
                          onClick={() => onVote(true)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                          showTooltip={false}
                        />
                      </div>
                      <div className="col-start-6 justify-self-center">
                        <RateLoopVoteButton
                          direction="down"
                          voteUiConfig={voteUiConfig}
                          size="sm"
                          onClick={() => onVote(false)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                          showTooltip={false}
                        />
                      </div>
                      <div className="col-start-8 justify-self-center">{feedbackDockButton}</div>
                    </div>
                  ) : !dockCenterStatusContent ? (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-3">
                      <div className="justify-self-start">
                        <RateLoopVoteButton
                          direction="up"
                          voteUiConfig={voteUiConfig}
                          size="sm"
                          onClick={() => onVote(true)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                          showTooltip={false}
                        />
                      </div>
                      <div className="justify-self-end translate-y-1">
                        <MoreToggleButton
                          expanded={isDetailsOpen}
                          onClick={() => setIsDetailsOpen(current => !current)}
                          controlsId={detailsId}
                          className={dockMoreClassName}
                        />
                      </div>
                      <div className="justify-self-end">
                        <RateLoopVoteButton
                          direction="down"
                          voteUiConfig={voteUiConfig}
                          size="sm"
                          onClick={() => onVote(false)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                          showTooltip={false}
                        />
                      </div>
                    </div>
                  ) : compact ? (
                    <div className="grid w-full items-center" style={compactDockControlsGridStyle}>
                      <div className="col-start-1 col-end-5 min-w-0 justify-self-start pr-2 [&>button]:max-w-full [&>button]:justify-start">
                        {dockCenterStatusContent}
                      </div>
                      <div className="col-start-6 justify-self-center">{shareDockButton}</div>
                      <div className="col-start-8 justify-self-center">{feedbackDockButton}</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                      <div className="min-w-0 justify-self-start [&>button]:max-w-full">{dockCenterStatusContent}</div>
                      <div className="self-center">
                        <MoreToggleButton
                          expanded={isDetailsOpen}
                          onClick={() => setIsDetailsOpen(current => !current)}
                          controlsId={detailsId}
                          className={dockMoreClassName}
                        />
                      </div>
                      <div aria-hidden className={`${dockVoteSpacerClassName} justify-self-end`} />
                    </div>
                  )}
                </div>

                {showVoteAttentionHint ? (
                  <p className="vote-attention-hint px-4 pb-1 text-center text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-primary/90">
                    Rate here
                  </p>
                ) : null}

                {ratingPending ? (
                  <div className="px-4 pb-1 text-center">
                    <RatingPendingNotice compact />
                  </div>
                ) : null}

                {displayError ? <p className="px-4 pb-1 text-center text-sm text-error">{displayError}</p> : null}

                {showExpandedDetails ? (
                  <div id={detailsId} className="relative z-10 pb-3 pt-1">
                    <div aria-hidden="true" className="mx-4 mb-3 h-px bg-[color:var(--rateloop-shell-border-strong)]" />
                    <div className="px-4">
                      <div className="max-h-[34svh] overflow-y-auto [scrollbar-gutter:stable]">
                        <div className="flex flex-col gap-2.5 pb-1" />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className={`relative ${embedded ? "" : "rounded-lg"} flex h-full min-h-0 flex-col overflow-hidden ${
          isAttentionActive ? "vote-surface-attention" : ""
        } ${shellClassName}`}
        data-vote-attention={isAttentionActive ? "true" : undefined}
        style={embedded ? {} : { background: "var(--rateloop-surface-elevated)" }}
      >
        {!hideEmbeddedSignalSurface ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(255,153,104,0.18),transparent_34%),radial-gradient(circle_at_50%_58%,rgba(255,241,216,0.08),transparent_40%)]"
          />
        ) : null}
        {/* Content */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-col items-center text-center">
            {ratingOrb}
            {ratingPending ? (
              <div className="mt-2">
                <RatingPendingNotice compact={compact} />
              </div>
            ) : null}
            {showVoteAttentionHint && isSignalVariant ? (
              <p className="vote-attention-hint mt-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-primary/90">
                Rate here
              </p>
            ) : null}
            {!(address && hasMyVote) && !centerStatusContent && isSignalVariant ? (
              <div className="mt-3 flex items-center justify-center gap-3">
                <RateLoopVoteButton
                  direction="up"
                  voteUiConfig={voteUiConfig}
                  onClick={() => onVote(true)}
                  disabled={voteActionDisabled}
                  attention={isAttentionActive && !voteActionDisabled}
                />
                <RateLoopVoteButton
                  direction="down"
                  voteUiConfig={voteUiConfig}
                  onClick={() => onVote(false)}
                  disabled={voteActionDisabled}
                  attention={isAttentionActive && !voteActionDisabled}
                />
              </div>
            ) : null}
            <div className={`flex w-full shrink-0 flex-col items-center ${actionStackClassName}`}>
              {centerStatusContent}

              {/* Vote error message */}
              {displayError && <p className="text-center text-base text-error">{displayError}</p>}

              {/* Prediction action - centered below the rating stack */}
              {!(address && hasMyVote) && !centerStatusContent && !isSignalVariant && !isDockVariant && (
                <div className="flex shrink-0 items-center justify-center gap-2 lg:gap-3">
                  <RateLoopVoteButton
                    direction="up"
                    voteUiConfig={voteUiConfig}
                    onClick={() => onVote(true)}
                    disabled={voteActionDisabled}
                    attention={isAttentionActive && !voteActionDisabled}
                  />
                  <RateLoopVoteButton
                    direction="down"
                    voteUiConfig={voteUiConfig}
                    onClick={() => onVote(false)}
                    disabled={voteActionDisabled}
                    attention={isAttentionActive && !voteActionDisabled}
                  />
                </div>
              )}
            </div>
          </div>

          <div className={`flex shrink-0 flex-col ${footerStackClassName}`}>
            {hasExpandableDetails && !isSignalVariant ? (
              <div className={compact ? "pt-0.5" : "pt-1"}>
                <MoreToggleButton
                  expanded={isDetailsOpen}
                  onClick={() => setIsDetailsOpen(current => !current)}
                  controlsId={detailsId}
                />
              </div>
            ) : null}
            {showExpandedDetails ? (
              <div id={detailsId} className={`flex flex-col ${compact ? "gap-2.5" : "gap-3"}`} />
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
