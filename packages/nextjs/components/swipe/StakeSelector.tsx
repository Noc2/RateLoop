"use client";

import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import { EPOCH_WEIGHT_BPS, USER_PREDICTION_PERCENT } from "@rateloop/contracts/protocol";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import { HandThumbDownIcon, HandThumbUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useContentLabel } from "~~/hooks/useCategoryRegistry";
import { useRaterIdentityStake, useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useRoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import {
  type OpenRoundFallbackData,
  type VotingConfig,
  getRoundVoteUnavailableMessage,
  isRoundAcceptingVotes,
} from "~~/lib/contracts/roundVotingEngine";
import { estimateVoteReturn, formatLrepAmount } from "~~/lib/vote/voteIncentives";

interface StakeSelectorProps {
  isOpen: boolean;
  contentId: bigint;
  questionTitle?: string;
  categoryId?: bigint;
  currentRating?: number | null;
  initialIsUp?: boolean;
  openRound?: OpenRoundFallbackData | null;
  roundConfig?: VotingConfig | null;
  cooldownSecondsRemaining?: number;
  isConfirming?: boolean;
  confirmError?: string | null;
  onConfirm: (stakeAmount: number, isUp: boolean, predictedUpPercent: number) => void;
  onCancel: () => void;
}

const MIN_COUNTED_STAKE_AMOUNT = 1;
const MIN_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.min;
const MAX_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.max;
const YOUR_VOTE_TOOLTIP =
  "Thumbs up means you think this content is useful for the question; thumbs down means it is unhelpful, broken, misleading, or unsafe.";
const EXPECTED_CROWD_TOOLTIP =
  "Your forecast of what share of revealed raters will choose thumbs up this round. This forecast helps determine rewards; it is separate from your own thumbs up/down vote.";
const ACCURACY_BASED_REWARDS_TOOLTIP =
  "Calculated after reveal and settlement. Early eligible raters can qualify for up to 2.5 LREP unverified or 10 LREP verified; later cohorts step down. Final payout depends on accuracy, launch-credit eligibility, and finalized snapshots.";
const OPEN_PHASE_REWARDS_TOOLTIP =
  "After the private epoch, estimates use the currently revealed stake pools. Final returns may change as more voters reveal or unrevealed votes are cleaned up.";
const metricLabelClassName =
  "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55";
const metricValueClassName = "mt-1 text-2xl font-bold tabular-nums text-base-content";
const metricUnitClassName = "ml-1 text-sm font-semibold text-base-content/55";

export function getLaunchRewardEstimateLabel(stakeAmount: number, symbol = "LREP") {
  if (!Number.isFinite(stakeAmount) || stakeAmount < MIN_COUNTED_STAKE_AMOUNT) return "Accuracy based";
  return `Est. cap 2.5-10 ${symbol}`;
}

function AccuracyBasedRewardLabel({ estimateLabel }: { estimateLabel: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5 text-right font-semibold tabular-nums">
      <span>{estimateLabel}</span>
      <InfoTooltip text={ACCURACY_BASED_REWARDS_TOOLTIP} position="top" className="[&>svg]:h-3.5 [&>svg]:w-3.5" />
    </span>
  );
}

function clampRating(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(10, Math.max(0, value));
}

export function normalizeStakeSelectorRating(currentRating: number | null | undefined) {
  if (currentRating === null || currentRating === undefined || !Number.isFinite(currentRating)) return 5;
  if (currentRating > 100) return clampRating(currentRating / 1000);
  if (currentRating > 10) return clampRating(currentRating / 10);
  return clampRating(currentRating);
}

export function normalizeStakeSelectorAmount(stakeAmount: number) {
  if (!Number.isFinite(stakeAmount) || stakeAmount <= 0) return 0;
  return stakeAmount < MIN_COUNTED_STAKE_AMOUNT ? MIN_COUNTED_STAKE_AMOUNT : stakeAmount;
}

export function normalizeStakeSelectorPredictedUpPercent(predictedUpPercent: number) {
  if (!Number.isFinite(predictedUpPercent)) return getInitialPredictedUpPercent();
  return Math.min(MAX_PREDICTED_UP_PERCENT, Math.max(MIN_PREDICTED_UP_PERCENT, Math.round(predictedUpPercent)));
}

export function getNextStakeSelectorAmount(currentAmount: number, maxStake: number, hasAdjustedStake: boolean) {
  if (!Number.isFinite(maxStake) || maxStake < MIN_COUNTED_STAKE_AMOUNT) return 0;
  if (!hasAdjustedStake) return MIN_COUNTED_STAKE_AMOUNT;
  if (!Number.isFinite(currentAmount) || currentAmount <= 0) return 0;
  return Math.min(currentAmount, maxStake);
}

export function getInitialPredictedUpPercent(initialIsUp?: boolean) {
  if (initialIsUp === true) return 60;
  if (initialIsUp === false) return 40;
  return 50;
}

/**
 * Bottom-sheet modal to select stake amount before committing a private vote.
 */
export function StakeSelector({
  isOpen,
  contentId,
  questionTitle,
  categoryId,
  currentRating,
  initialIsUp,
  openRound,
  roundConfig,
  cooldownSecondsRemaining = 0,
  isConfirming = false,
  confirmError = null,
  onConfirm,
  onCancel,
}: StakeSelectorProps) {
  const dialogTitleId = useId();
  const stakeAmountInputId = useId();
  const crowdPredictionInputId = useId();
  const contentLabel = useContentLabel(categoryId);
  const [amount, setAmount] = useState(0);
  const [isUp, setIsUp] = useState(() => initialIsUp ?? true);
  const [predictedUpPercent, setPredictedUpPercent] = useState(() => getInitialPredictedUpPercent(initialIsUp));
  const [hasAdjustedPrediction, setHasAdjustedPrediction] = useState(false);
  const [hasAdjustedStake, setHasAdjustedStake] = useState(false);
  const { address } = useAccount();
  const { identityKey } = useRaterRegistryIdentity(address);

  const roundSnapshot = useRoundSnapshot(contentId, openRound ?? undefined, roundConfig ?? undefined);
  const { roundId: currentRoundId, phase, isEpoch1, upPool, downPool } = roundSnapshot;
  const roundAcceptsVotes = isRoundAcceptingVotes(roundSnapshot);
  const effectiveIsBlind = phase !== "voting" || isEpoch1;

  const estimateSnapshot = useMemo(
    () => ({
      ...roundSnapshot,
      isEpoch1: effectiveIsBlind,
    }),
    [effectiveIsBlind, roundSnapshot],
  );

  const { remainingCapacity } = useRaterIdentityStake(contentId, currentRoundId, identityKey);

  const { data: lrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
  });

  const { data: tokenSymbol } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "symbol",
  });

  const symbol = tokenSymbol ?? "LREP";
  const normalizedCurrentRating = normalizeStakeSelectorRating(currentRating);
  const voteEstimate = estimateVoteReturn(estimateSnapshot, isUp, amount);
  const signalTone = isUp ? "Thumbs up" : "Thumbs down";
  const signalToneClassName = isUp ? "text-success" : "text-error";
  const currentRatingLabel =
    currentRating === null || currentRating === undefined || !Number.isFinite(currentRating)
      ? "N/A"
      : normalizedCurrentRating.toFixed(1);
  const dialogTitle = questionTitle?.trim() || "Vote on this question";

  const handleSignalChange = (nextIsUp: boolean) => {
    setIsUp(nextIsUp);
    if (!hasAdjustedPrediction) {
      setPredictedUpPercent(getInitialPredictedUpPercent(nextIsUp));
    }
  };

  const balanceFormatted = lrepBalance ? Number(lrepBalance) / 1e6 : 0;
  const capacityFormatted = remainingCapacity != null ? Number(remainingCapacity) / 1e6 : 10;
  const maxByBalance = Math.floor(balanceFormatted);
  const maxByCapacity = Math.floor(capacityFormatted);
  const maxStake = Math.min(maxByBalance, maxByCapacity);
  const sliderMax = Math.max(1, maxStake);

  useEffect(() => {
    if (!isOpen) return;
    setIsUp(initialIsUp ?? true);
    setPredictedUpPercent(getInitialPredictedUpPercent(initialIsUp));
    setHasAdjustedPrediction(false);
    setHasAdjustedStake(false);
  }, [contentId, initialIsUp, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(currentAmount => getNextStakeSelectorAmount(currentAmount, maxStake, hasAdjustedStake));
  }, [hasAdjustedStake, isOpen, maxStake]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isConfirming) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isConfirming, isOpen, onCancel]);

  const isCapacityLimited = amount > 0 && maxByCapacity < maxByBalance;
  const cooldownActive = cooldownSecondsRemaining > 0;
  const formDisabled = isConfirming || !roundAcceptsVotes;
  const confirmDisabled = formDisabled || cooldownActive || amount < 0 || (amount > 0 && amount > maxStake);
  const roundUnavailableMessage = getRoundVoteUnavailableMessage(roundSnapshot);
  const roundNotAcceptingMessage =
    !roundAcceptsVotes && !confirmError && !isConfirming ? roundUnavailableMessage : null;
  const phaseHeadline = effectiveIsBlind ? "Private round" : "Post-epoch reveal";
  const phaseHeadlineClassName = effectiveIsBlind ? "text-primary" : "text-warning";
  const sliderClassName = "range range-primary range-sm w-full";
  const sliderStyle = { "--range-thumb": "var(--rateloop-warm-white)" } as CSSProperties;
  const weightPercent = Math.round(
    (effectiveIsBlind ? EPOCH_WEIGHT_BPS.blind : EPOCH_WEIGHT_BPS.informed) / 100,
  ).toLocaleString();
  const launchRewardEstimateLabel = getLaunchRewardEstimateLabel(amount, symbol);
  const openPhaseGrossReturnMicro = voteEstimate.estimatedGrossReturnMicro;
  const openPhaseBelowMeanFloorMicro = voteEstimate.belowMeanFloorMicro;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          aria-busy={isConfirming}
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={isConfirming ? undefined : onCancel}
          />

          <motion.div
            className="relative max-h-[calc(100svh-1rem)] w-full max-w-md overflow-y-auto rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-ghost btn-sm btn-circle absolute right-3 top-3 text-base-content/70 hover:text-base-content"
              aria-label="Close vote dialog"
              disabled={isConfirming}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>

            <h3
              id={dialogTitleId}
              className="mb-3 px-9 text-balance break-words text-center text-lg font-semibold leading-tight"
            >
              {dialogTitle}
            </h3>

            <div className="mb-5 px-1 pt-1">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
                    <span>Your signal</span>
                    <InfoTooltip text={YOUR_VOTE_TOOLTIP} position="bottom" />
                  </p>
                  <p className={`mt-1 text-3xl font-bold ${signalToneClassName}`}>{signalTone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">Rating</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-base-content/75">{currentRatingLabel}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSignalChange(true)}
                  className={`btn min-h-12 rounded-lg ${isUp ? "btn-success text-success-content" : "pill-inactive-muted"}`}
                  disabled={formDisabled}
                  aria-pressed={isUp}
                >
                  <HandThumbUpIcon className="h-5 w-5" />
                  Thumbs up
                </button>
                <button
                  type="button"
                  onClick={() => handleSignalChange(false)}
                  className={`btn min-h-12 rounded-lg ${!isUp ? "btn-error text-error-content" : "pill-inactive-muted"}`}
                  disabled={formDisabled}
                  aria-pressed={!isUp}
                >
                  <HandThumbDownIcon className="h-5 w-5" />
                  Thumbs down
                </button>
              </div>
              <div className="mt-5 border-t border-base-content/10 pt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className={metricLabelClassName}>
                      <span>Crowd forecast</span>
                      <InfoTooltip text={EXPECTED_CROWD_TOOLTIP} position="bottom" />
                    </p>
                    <p className={metricValueClassName}>
                      {predictedUpPercent.toFixed(0)}
                      <span className={metricUnitClassName}>% up</span>
                    </p>
                  </div>
                </div>
                <label htmlFor={crowdPredictionInputId} className="sr-only">
                  Crowd thumbs-up forecast
                </label>
                <input
                  id={crowdPredictionInputId}
                  name="predicted-up-share"
                  type="range"
                  min={MIN_PREDICTED_UP_PERCENT}
                  max={MAX_PREDICTED_UP_PERCENT}
                  step={1}
                  value={predictedUpPercent}
                  onChange={e => {
                    setHasAdjustedPrediction(true);
                    setPredictedUpPercent(normalizeStakeSelectorPredictedUpPercent(Number(e.target.value)));
                  }}
                  className="crowd-forecast-range range range-sm mt-4 w-full"
                  style={sliderStyle}
                  disabled={formDisabled}
                  aria-label="Crowd thumbs-up forecast"
                  aria-valuetext={`${predictedUpPercent.toFixed(0)} percent up`}
                />
                <div className="mt-1 flex justify-between text-xs text-base-content/55">
                  <span>{MIN_PREDICTED_UP_PERCENT}%</span>
                  <span>{MAX_PREDICTED_UP_PERCENT}%</span>
                </div>
              </div>
            </div>

            <div className="mb-3 px-1">
              <div className="mb-4">
                <p className={metricLabelClassName}>Stake amount</p>
                <p className={metricValueClassName}>
                  {amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  <span className={metricUnitClassName}>{symbol}</span>
                  {isCapacityLimited && (
                    <span
                      className="tooltip tooltip-top ml-2 inline-block cursor-help align-middle"
                      data-tip={`Max per rater for this ${contentLabel}: ${maxByCapacity} ${symbol} remaining (10 limit per round)`}
                      role="img"
                      aria-label={`Max per rater for this ${contentLabel}: ${maxByCapacity} ${symbol} remaining (10 limit per round)`}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="opacity-60"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4" />
                        <path d="M12 8h.01" />
                      </svg>
                    </span>
                  )}
                </p>
              </div>
              <label htmlFor={stakeAmountInputId} className="sr-only">
                Stake amount
              </label>
              <input
                id={stakeAmountInputId}
                name="stake-amount"
                type="range"
                min={0}
                max={sliderMax}
                step={0.5}
                value={amount > 0 ? Math.min(amount, sliderMax) : 0}
                onChange={e => {
                  setHasAdjustedStake(true);
                  setAmount(normalizeStakeSelectorAmount(Number(e.target.value)));
                }}
                className={sliderClassName}
                style={sliderStyle}
                disabled={formDisabled || maxStake < 1}
                aria-label="Stake amount"
              />
              <div className="mt-1 flex justify-between text-base text-base-content/60">
                <span>0</span>
                <span>{sliderMax}</span>
              </div>
            </div>

            <div className="mb-4 border-t border-base-content/10 pt-4">
              <div className="flex items-center gap-1.5">
                <p className={`text-sm font-semibold ${phaseHeadlineClassName}`}>{phaseHeadline}</p>
                {!effectiveIsBlind && <InfoTooltip text={OPEN_PHASE_REWARDS_TOOLTIP} position="bottom" />}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-base-content/80">
                {effectiveIsBlind ? (
                  amount === 0 ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>Starter rewards</span>
                      <AccuracyBasedRewardLabel estimateLabel={launchRewardEstimateLabel} />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span>Launch rewards</span>
                        <AccuracyBasedRewardLabel estimateLabel={launchRewardEstimateLabel} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Reward weight</span>
                        <span className="font-semibold tabular-nums">{weightPercent}% (4x vs open)</span>
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span>Est. return if accurate</span>
                      <span className="font-semibold tabular-nums">
                        {formatLrepAmount(openPhaseGrossReturnMicro)} {symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Below-mean floor</span>
                      <span className="font-semibold tabular-nums">
                        {formatLrepAmount(openPhaseBelowMeanFloorMicro)} {symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Live pools</span>
                      <span className="font-semibold tabular-nums">
                        up {formatLrepAmount(upPool, 0)} · down {formatLrepAmount(downPool, 0)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="btn flex-1 border border-base-content/10 bg-base-300 text-base-content hover:bg-base-300/80"
                disabled={isConfirming}
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(amount, isUp, normalizeStakeSelectorPredictedUpPercent(predictedUpPercent))}
                className="btn flex-1 action-orange-control"
                disabled={confirmDisabled}
              >
                {isConfirming ? (
                  <span className="flex items-center gap-2 text-base-content">
                    <span className="loading loading-spinner loading-xs" />
                    <span>Submitting...</span>
                  </span>
                ) : amount === 0 ? (
                  "Submit"
                ) : (
                  `Stake ${amount} ${symbol}`
                )}
              </button>
            </div>

            {(confirmError || roundNotAcceptingMessage) && !isConfirming && (
              <p className="mt-3 text-center text-base text-error">{confirmError ?? roundNotAcceptingMessage}</p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
