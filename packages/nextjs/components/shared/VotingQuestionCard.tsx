"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ChatBubbleLeftRightIcon, ShareIcon } from "@heroicons/react/24/outline";
import { FundFeedbackBonusModal } from "~~/components/reward-pool/FundFeedbackBonusModal";
import { FundQuestionModal } from "~~/components/reward-pool/FundQuestionModal";
import { MoreToggleButton } from "~~/components/shared/MoreToggleButton";
import { RateLoopVoteButton } from "~~/components/shared/RateLoopVoteButton";
import { RatingOrb } from "~~/components/shared/RatingOrb";
import { RoundProgress } from "~~/components/shared/RoundProgress";
import { RoundRevealedBreakdown, RoundStats } from "~~/components/shared/RoundStats";
import { HoverTooltip, InfoTooltip, TooltipAnchor } from "~~/components/ui/InfoTooltip";
import type { ContentOpenRoundSummary, RewardPoolCurrency } from "~~/hooks/contentFeed/shared";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useRoundSnapshot } from "~~/hooks/useRoundSnapshot";
import type { ViewerRewardStatus } from "~~/hooks/useViewerRewardStatuses";
import {
  COMMIT_AVAILABILITY_STATUS,
  type VotingConfig,
  getRoundVoteUnavailableMessage,
  isRoundAcceptingVotes,
} from "~~/lib/contracts/roundVotingEngine";
import { formatSubmissionRewardAmount, formatUsdAmount } from "~~/lib/questionRewardPools";
import { formatVoteCooldownRemaining } from "~~/lib/vote/cooldown";
import { describeOpenRoundActivity, formatLrepAmount, getRoundProgressMessaging } from "~~/lib/vote/voteIncentives";
import { resolveVotingQuestionCardDisplayError } from "~~/lib/vote/votingQuestionCardStatus";

interface VotingQuestionCardProps {
  contentId: bigint;
  categoryId: bigint;
  questionTitle?: string;
  currentRating: number | null;
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
  onOpenFeedback?: () => void;
}

const RATING_GUIDANCE_TEXT =
  "The public rating appears after a round settles and is the cumulative share of bounded thumbs-up evidence across settled rounds. Vote thumbs up when the content is useful for the question, thumbs down when it is unhelpful, broken, misleading, or unsafe. Your separate forecast is the expected share of revealed raters choosing thumbs up.";
const REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty is shown in USD and backed by USDC on World Chain. Eligible revealed raters can claim from it in qualified rounds, with 3% reserved for the eligible frontend operator.";
const LREP_REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty is funded in LREP on World Chain. Eligible revealed raters can claim from it in qualified rounds, with 3% reserved for the eligible frontend operator.";
const MIXED_REWARD_POOL_TOOLTIP_TEXT =
  "This question's bounty includes multiple assets on World Chain. Eligible revealed raters can claim from qualified rounds, with 3% reserved for the eligible frontend operator.";
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
  label,
  tooltip,
  ariaLabel,
  tone,
}: {
  amount: bigint;
  amountLabel?: string;
  label: string;
  tooltip: string;
  ariaLabel: string;
  tone: "blue" | "green";
}) {
  const displayAmountLabel = amountLabel ?? formatUsdAmount(amount);

  return (
    <div
      className={`reward-chip reward-chip-label reward-chip-brand-${tone}`}
      aria-label={`${displayAmountLabel} ${ariaLabel}`}
    >
      <span>
        <span className="tabular-nums">{displayAmountLabel}</span> {label}
      </span>
      <InfoTooltip text={tooltip} position="bottom" className={REWARD_CHIP_INFO_ICON_CLASS_NAME} />
    </div>
  );
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

export function RewardPoolAmountDisplay({ amount, currency }: { amount: bigint; currency?: RewardPoolCurrency }) {
  const display = getRewardPoolDisplay(amount, currency);
  return (
    <RewardAmountDisplay
      amount={amount}
      amountLabel={display.amountLabel}
      label="bounty"
      tooltip={display.tooltip}
      ariaLabel="bounty"
      tone="blue"
    />
  );
}

export function FeedbackBonusAmountDisplay({ amount, currency }: { amount: bigint; currency?: RewardPoolCurrency }) {
  const { amountLabel, tooltip } = getFeedbackBonusDisplay(amount, currency);
  return (
    <RewardAmountDisplay
      amount={amount}
      amountLabel={amountLabel}
      label="Feedback Bonus"
      tooltip={tooltip}
      ariaLabel="Feedback Bonus"
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
        : formatSubmissionRewardAmount(amount, "usdc");
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

function AddRewardActionLinks({
  onFundQuestion,
  onFundFeedbackBonus,
  canFundFeedbackBonus,
}: {
  onFundQuestion: () => void;
  onFundFeedbackBonus: () => void;
  canFundFeedbackBonus: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-start gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={onFundQuestion}
        className="font-semibold text-primary underline-offset-4 transition-colors hover:text-primary-focus hover:underline"
      >
        Add bounty
      </button>
      <button
        type="button"
        onClick={onFundFeedbackBonus}
        disabled={!canFundFeedbackBonus}
        title={canFundFeedbackBonus ? "Add Feedback Bonus" : "Feedback Bonuses need an active round"}
        className="font-semibold text-primary underline-offset-4 transition-colors hover:text-primary-focus hover:underline disabled:cursor-not-allowed disabled:text-base-content/35 disabled:hover:text-base-content/35 disabled:hover:no-underline"
      >
        Add feedback bonus
      </button>
    </div>
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
}: {
  contentId: bigint;
  categoryId: bigint;
  openRound?: ContentOpenRoundSummary | null;
  roundConfig?: VotingConfig | null;
  compact?: boolean;
  active?: boolean;
  statusChips?: ReactNode;
  statusActions?: ReactNode;
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
      {!showInlineRevealedBreakdown ? <RoundRevealedBreakdown snapshot={roundSnapshot} stacked={compact} /> : null}
      <RoundStats categoryId={categoryId} snapshot={roundSnapshot} />
    </div>
  );
}

/**
 * Displays the live rating signal and all voting controls in a separate card.
 */
export function VotingQuestionCard({
  contentId,
  questionTitle,
  currentRating,
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
  onOpenFeedback,
}: VotingQuestionCardProps) {
  const isSignalVariant = variant === "signal";
  const isDockVariant = variant === "dock";
  const hideEmbeddedSignalSurface = Boolean(embedded && isSignalVariant);

  // Check if user already voted on this content in the current round
  const roundSnapshot = useRoundSnapshot(contentId, openRound ?? undefined, roundConfig ?? undefined);
  const { roundId, isRoundFull } = roundSnapshot;
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
  const voteActionDisabled =
    isCommitting || isVoteEligibilityPending || Boolean(voteUnavailableStatus) || contentInactive || !roundAcceptsVotes;
  const [isDetailsOpen, setIsDetailsOpen] = useState(isSignalVariant);
  const [isAttentionActive, setIsAttentionActive] = useState(false);
  const [showFundQuestionModal, setShowFundQuestionModal] = useState(false);
  const [showFundFeedbackBonusModal, setShowFundFeedbackBonusModal] = useState(false);
  const detailsId = `voting-card-details-${contentId.toString()}`;

  // Check if user has committed to this round (direction hidden until reveal).
  const { data: myCommitState } = useScaffoldReadContract({
    contractName: "RoundVotingEngine" as any,
    functionName: "voterCommitKey" as any,
    args: [contentId, roundId, address] as any,
    watch: true,
    query: { enabled: roundId > 0n && !!address },
  } as any);

  const myCommitStateTuple = Array.isArray(myCommitState) ? myCommitState : [];
  const hasMyVote = myCommitStateTuple.some(
    value =>
      typeof value === "string" && value !== "0x0000000000000000000000000000000000000000000000000000000000000000",
  );
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
  const showExpandedDetails = isSignalVariant || (isDetailsOpen && !isDockVariant);
  const showVoteAttentionHint = isAttentionActive && !centerStatusContent;
  const fundQuestionTitle = questionTitle?.trim() || `Question #${contentId.toString()}`;
  const canFundFeedbackBonus = !contentInactive && roundId > 0n;
  const ratingOrb = (
    <TooltipAnchor
      text={RATING_GUIDANCE_TEXT}
      position="bottom"
      className="pointer-events-auto cursor-help rounded-full"
    >
      <RatingOrb rating={currentRating} size={orbSize} />
    </TooltipAnchor>
  );
  const rewardActionLinks = (
    <AddRewardActionLinks
      onFundQuestion={() => setShowFundQuestionModal(true)}
      onFundFeedbackBonus={() => setShowFundFeedbackBonusModal(true)}
      canFundFeedbackBonus={canFundFeedbackBonus}
    />
  );
  const renderRewardPoolDetailsRow = () => <div className="flex min-w-0 flex-col gap-3">{rewardActionLinks}</div>;

  useEffect(() => {
    setIsDetailsOpen(isSignalVariant);
  }, [contentId, isSignalVariant]);

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
    const dockVoteDisabled = voteActionDisabled || Boolean(centerStatusContent);
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
        label="Open feedback"
        onClick={onOpenFeedback}
        icon={<ChatBubbleLeftRightIcon className="h-5 w-5 drop-shadow-sm" aria-hidden="true" />}
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
              text={RATING_GUIDANCE_TEXT}
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
                  {compact && !centerStatusContent ? (
                    <div className="grid w-full items-center" style={compactDockControlsGridStyle}>
                      <div className="col-start-2 justify-self-center">{shareDockButton}</div>
                      <div className="col-start-4 justify-self-center">
                        <RateLoopVoteButton
                          direction="up"
                          size="sm"
                          onClick={() => onVote(true)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                        />
                      </div>
                      <div className="col-start-6 justify-self-center">
                        <RateLoopVoteButton
                          direction="down"
                          size="sm"
                          onClick={() => onVote(false)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                        />
                      </div>
                      <div className="col-start-8 justify-self-center">{feedbackDockButton}</div>
                    </div>
                  ) : !centerStatusContent ? (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-3">
                      <div className="justify-self-start">
                        <RateLoopVoteButton
                          direction="up"
                          size="sm"
                          onClick={() => onVote(true)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
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
                          size="sm"
                          onClick={() => onVote(false)}
                          disabled={dockVoteDisabled}
                          attention={isAttentionActive && !dockVoteDisabled}
                          tooltipPosition="top"
                        />
                      </div>
                    </div>
                  ) : compact ? (
                    <div className="grid w-full items-center" style={compactDockControlsGridStyle}>
                      <div className="col-start-1 col-end-5 min-w-0 justify-self-start pr-2 [&>button]:max-w-full [&>button]:justify-start">
                        {centerStatusContent}
                      </div>
                      <div className="col-start-6 justify-self-center">{shareDockButton}</div>
                      <div className="col-start-8 justify-self-center">{feedbackDockButton}</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
                      <div className="min-w-0 justify-self-start [&>button]:max-w-full">{centerStatusContent}</div>
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

                {displayError ? <p className="px-4 pb-1 text-center text-sm text-error">{displayError}</p> : null}

                {isDetailsOpen ? (
                  <div id={detailsId} className="relative z-10 pb-3 pt-1">
                    <div aria-hidden="true" className="mx-4 mb-3 h-px bg-[color:var(--rateloop-shell-border-strong)]" />
                    <div className="px-4">
                      <div className="max-h-[34svh] overflow-y-auto [scrollbar-gutter:stable]">
                        <div className="flex flex-col gap-2.5 pb-1">{renderRewardPoolDetailsRow()}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        {showFundQuestionModal ? (
          <FundQuestionModal
            contentId={contentId}
            roundConfig={roundConfig}
            title={fundQuestionTitle}
            onClose={() => setShowFundQuestionModal(false)}
          />
        ) : null}
        {showFundFeedbackBonusModal ? (
          <FundFeedbackBonusModal
            contentId={contentId}
            roundId={roundId}
            title={fundQuestionTitle}
            onClose={() => setShowFundFeedbackBonusModal(false)}
          />
        ) : null}
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
            {showVoteAttentionHint && isSignalVariant ? (
              <p className="vote-attention-hint mt-3 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-primary/90">
                Rate here
              </p>
            ) : null}
            {!(address && hasMyVote) && !centerStatusContent && isSignalVariant ? (
              <div className="mt-3 flex items-center justify-center gap-3">
                <RateLoopVoteButton
                  direction="up"
                  onClick={() => onVote(true)}
                  disabled={voteActionDisabled}
                  attention={isAttentionActive && !voteActionDisabled}
                />
                <RateLoopVoteButton
                  direction="down"
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
                    onClick={() => onVote(true)}
                    disabled={voteActionDisabled}
                    attention={isAttentionActive && !voteActionDisabled}
                  />
                  <RateLoopVoteButton
                    direction="down"
                    onClick={() => onVote(false)}
                    disabled={voteActionDisabled}
                    attention={isAttentionActive && !voteActionDisabled}
                  />
                </div>
              )}
            </div>
          </div>

          <div className={`flex shrink-0 flex-col ${footerStackClassName}`}>
            {!isSignalVariant ? (
              <div className={compact ? "pt-0.5" : "pt-1"}>
                <MoreToggleButton
                  expanded={isDetailsOpen}
                  onClick={() => setIsDetailsOpen(current => !current)}
                  controlsId={detailsId}
                />
              </div>
            ) : null}
            {showExpandedDetails ? (
              <div id={detailsId} className={`flex flex-col ${compact ? "gap-2.5" : "gap-3"}`}>
                {renderRewardPoolDetailsRow()}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {showFundQuestionModal ? (
        <FundQuestionModal
          contentId={contentId}
          roundConfig={roundConfig}
          title={fundQuestionTitle}
          onClose={() => setShowFundQuestionModal(false)}
        />
      ) : null}
      {showFundFeedbackBonusModal ? (
        <FundFeedbackBonusModal
          contentId={contentId}
          roundId={roundId}
          title={fundQuestionTitle}
          onClose={() => setShowFundFeedbackBonusModal(false)}
        />
      ) : null}
    </>
  );
}
