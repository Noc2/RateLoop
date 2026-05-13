"use client";

import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import { EPOCH_WEIGHT_BPS } from "@rateloop/contracts/protocol";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import { HandThumbDownIcon, HandThumbUpIcon } from "@heroicons/react/24/outline";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useContentLabel } from "~~/hooks/useCategoryRegistry";
import { useParticipationRate } from "~~/hooks/useParticipationRate";
import { useRoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { useVoterIdNFT, useVoterIdStake } from "~~/hooks/useVoterIdNFT";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import type { OpenRoundFallbackData, VotingConfig } from "~~/lib/contracts/roundVotingEngine";
import { estimateVoteReturn, formatHrepAmount } from "~~/lib/vote/voteIncentives";

interface StakeSelectorProps {
  isOpen: boolean;
  contentId: bigint;
  categoryId?: bigint;
  currentRating?: number;
  initialIsUp?: boolean;
  openRound?: OpenRoundFallbackData | null;
  roundConfig?: VotingConfig | null;
  cooldownSecondsRemaining?: number;
  isConfirming?: boolean;
  confirmError?: string | null;
  onConfirm: (stakeAmount: number, isUp: boolean, predictedUpPercent: number) => void;
  onCancel: () => void;
}

const PRESET_AMOUNTS = [0, 1, 2.5, 5, 10];
const MIN_PREDICTED_UP_PERCENT = 0;
const MAX_PREDICTED_UP_PERCENT = 100;
const YOUR_VOTE_TOOLTIP =
  "Thumbs up means you expect the rating should move higher than the current/reference score; thumbs down means lower. Consider the current rating before choosing.";
const EXPECTED_CROWD_TOOLTIP =
  "Your forecast of what share of revealed raters will vote up this round. Rewards score this forecast against peer signals; it is separate from your thumbs up/down vote.";

function clampRating(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(10, Math.max(0, value));
}

export function normalizeStakeSelectorRating(currentRating: number | undefined) {
  if (currentRating === undefined || !Number.isFinite(currentRating)) return 5;
  if (currentRating > 100) return clampRating(currentRating / 1000);
  if (currentRating > 10) return clampRating(currentRating / 10);
  return clampRating(currentRating);
}

function getInitialPredictedUpPercent(currentRating: number | undefined) {
  const baseRating = normalizeStakeSelectorRating(currentRating);
  return Math.round(baseRating * 10);
}

/**
 * Bottom-sheet modal to select stake amount before committing a private RBTS vote.
 */
export function StakeSelector({
  isOpen,
  contentId,
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
  const stakeAmountInputId = useId();
  const crowdPredictionInputId = useId();
  const contentLabel = useContentLabel(categoryId);
  const [amount, setAmount] = useState(0);
  const [isUp, setIsUp] = useState(() => initialIsUp ?? normalizeStakeSelectorRating(currentRating) >= 5);
  const [predictedUpPercent, setPredictedUpPercent] = useState(() => getInitialPredictedUpPercent(currentRating));
  const { address } = useAccount();
  const voterIdData = useVoterIdNFT(address);
  const tokenId = voterIdData.tokenId as bigint;

  const roundSnapshot = useRoundSnapshot(contentId, openRound ?? undefined, roundConfig ?? undefined);
  const { roundId: currentRoundId, phase, isEpoch1, upPool, downPool } = roundSnapshot;
  const effectiveIsBlind = phase !== "voting" || isEpoch1;

  const estimateSnapshot = useMemo(
    () => ({
      ...roundSnapshot,
      isEpoch1: effectiveIsBlind,
    }),
    [effectiveIsBlind, roundSnapshot],
  );

  const { remainingCapacity } = useVoterIdStake(contentId, currentRoundId, tokenId);

  const { data: hrepBalance } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "balanceOf",
    args: [address],
  });

  const { data: tokenSymbol } = useScaffoldReadContract({
    contractName: REPUTATION_CONTRACT_NAME,
    functionName: "symbol",
  });

  useEffect(() => {
    if (!isOpen) return;
    setIsUp(initialIsUp ?? normalizeStakeSelectorRating(currentRating) >= 5);
    setPredictedUpPercent(getInitialPredictedUpPercent(currentRating));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isConfirming) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentRating, initialIsUp, isConfirming, isOpen, onCancel]);

  const symbol = tokenSymbol ?? "LREP";
  const { calculateBonus, hasActiveParticipationRewards } = useParticipationRate();
  const voteBonus = calculateBonus(amount);
  const normalizedCurrentRating = normalizeStakeSelectorRating(currentRating);
  const voteEstimate = estimateVoteReturn(estimateSnapshot, isUp, amount);
  const signalTone = isUp ? "Thumbs up" : "Thumbs down";
  const signalToneClassName = isUp ? "text-success" : "text-error";

  const balanceFormatted = hrepBalance ? Number(hrepBalance) / 1e6 : 0;
  const capacityFormatted = remainingCapacity != null ? Number(remainingCapacity) / 1e6 : 10;
  const maxByBalance = Math.floor(balanceFormatted);
  const maxByCapacity = Math.floor(capacityFormatted);
  const maxStake = Math.min(maxByBalance, maxByCapacity);
  const sliderMax = Math.max(1, maxStake);
  const isCapacityLimited = amount > 0 && maxByCapacity < maxByBalance;
  const cooldownActive = cooldownSecondsRemaining > 0;
  const confirmDisabled = isConfirming || cooldownActive || amount < 0 || (amount > 0 && amount > maxStake);
  const phaseHeadline = effectiveIsBlind ? "Private round" : "Post-epoch reveal";
  const phaseHeadlineClassName = effectiveIsBlind ? "text-primary" : "text-warning";
  const selectedPresetClassName = "action-orange-control";
  const sliderClassName = "range range-primary range-sm w-full";
  const sliderStyle = { "--range-thumb": "var(--curyo-warm-white)" } as CSSProperties;
  const weightPercent = Math.round(
    (effectiveIsBlind ? EPOCH_WEIGHT_BPS.blind : EPOCH_WEIGHT_BPS.informed) / 100,
  ).toLocaleString();
  const participationBonusMicro = voteBonus !== undefined ? BigInt(Math.round(voteBonus * 1e6)) : 0n;
  const openPhaseGrossReturnMicro = voteEstimate.estimatedGrossReturnMicro + participationBonusMicro;
  const openPhaseRevealedRefundMicro = voteEstimate.revealedLoserRefundMicro + participationBonusMicro;
  const openPhaseParticipationTooltip =
    voteBonus !== undefined
      ? `Includes the current participation bonus of +${voteBonus.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${symbol}.`
      : "No participation bonus is funded for this deployment.";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Select reputation lock and private RBTS vote"
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
            className="relative w-full max-w-md rounded-t-2xl bg-base-200 p-6 shadow-2xl sm:rounded-2xl"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <h3 className="mb-3 text-center text-lg font-semibold">
              Submit private vote
              <span
                className="tooltip tooltip-bottom ml-1.5 inline-block cursor-help align-middle"
                data-tip="You can only submit one private report per content per round. Choose your stake carefully!"
                role="img"
                aria-label="You can only submit one private report per content per round. Choose your stake carefully!"
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
                  className="opacity-50"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </span>
            </h3>

            <div className="mb-5 px-1 pt-1">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
                    <span>Your vote</span>
                    <InfoTooltip text={YOUR_VOTE_TOOLTIP} position="bottom" />
                  </p>
                  <p className={`mt-1 text-3xl font-bold ${signalToneClassName}`}>{signalTone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">Current</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-base-content/75">
                    {normalizedCurrentRating.toFixed(1)}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsUp(true)}
                  className={`btn min-h-12 rounded-lg ${isUp ? "btn-success text-success-content" : "pill-inactive-muted"}`}
                  disabled={isConfirming}
                  aria-pressed={isUp}
                >
                  <HandThumbUpIcon className="h-5 w-5" />
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => setIsUp(false)}
                  className={`btn min-h-12 rounded-lg ${!isUp ? "btn-error text-error-content" : "pill-inactive-muted"}`}
                  disabled={isConfirming}
                  aria-pressed={!isUp}
                >
                  <HandThumbDownIcon className="h-5 w-5" />
                  Down
                </button>
              </div>
              <div className="mt-5 border-t border-base-content/10 pt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
                      <span>Expected crowd</span>
                      <InfoTooltip text={EXPECTED_CROWD_TOOLTIP} position="bottom" />
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-base-content">
                      {predictedUpPercent.toFixed(0)}
                      <span className="ml-1 text-sm font-semibold text-base-content/55">% up</span>
                    </p>
                  </div>
                </div>
                <label htmlFor={crowdPredictionInputId} className="sr-only">
                  Expected crowd up share
                </label>
                <input
                  id={crowdPredictionInputId}
                  name="predicted-up-share"
                  type="range"
                  min={MIN_PREDICTED_UP_PERCENT}
                  max={MAX_PREDICTED_UP_PERCENT}
                  step={1}
                  value={predictedUpPercent}
                  onChange={e => setPredictedUpPercent(Number(e.target.value))}
                  className="range range-primary range-sm mt-4 w-full"
                  style={sliderStyle}
                  disabled={isConfirming}
                  aria-label="Expected crowd up share"
                  aria-valuetext={`${predictedUpPercent.toFixed(0)} percent up`}
                />
                <div className="mt-1 flex justify-between text-xs text-base-content/55">
                  <span>0%</span>
                  <span>100%</span>
                </div>
              </div>
            </div>

            <div className="mb-5 space-y-1 text-center text-base text-base-content/60">
              <p>
                Balance: {balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 0 })} {symbol}
              </p>
            </div>

            <div className="mb-5 flex flex-wrap justify-center gap-2">
              {PRESET_AMOUNTS.filter(a => a === 0 || a <= maxStake).map(preset => (
                <button
                  key={preset}
                  onClick={() => setAmount(preset)}
                  className={`rounded-lg px-4 py-2 text-base font-medium transition-colors ${
                    amount === preset ? selectedPresetClassName : "pill-inactive-muted"
                  }`}
                  disabled={isConfirming}
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="mb-3 px-1">
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
                onChange={e => setAmount(Number(e.target.value))}
                className={sliderClassName}
                style={sliderStyle}
                disabled={isConfirming || maxStake < 1}
                aria-label="Stake amount"
              />
              <div className="mt-1 flex justify-between text-base text-base-content/60">
                <span>0</span>
                <span>{sliderMax}</span>
              </div>
            </div>

            <div className="my-5 text-center">
              <span className="text-4xl font-bold tabular-nums">
                {amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
              <span className="ml-2 text-base text-base-content/60">{symbol}</span>
              {isCapacityLimited && (
                <span
                  className="tooltip tooltip-top ml-2 inline-block cursor-help align-middle"
                  data-tip={`Max per ${contentLabel}: ${maxByCapacity} ${symbol} remaining (10 limit per round)`}
                  role="img"
                  aria-label={`Max per ${contentLabel}: ${maxByCapacity} ${symbol} remaining (10 limit per round)`}
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
            </div>

            <div className="mb-4 border-t border-base-content/10 pt-4">
              <div className="flex items-center gap-1.5">
                <p className={`text-sm font-semibold ${phaseHeadlineClassName}`}>{phaseHeadline}</p>
                {!effectiveIsBlind && <InfoTooltip text={openPhaseParticipationTooltip} position="bottom" />}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-base-content/80">
                {effectiveIsBlind ? (
                  amount === 0 ? (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <span>Starter rewards</span>
                        <span className="font-semibold tabular-nums">Accuracy based</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>LREP at risk</span>
                        <span className="font-semibold tabular-nums">0 {symbol}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {hasActiveParticipationRewards ? (
                        <div className="flex items-center justify-between gap-3">
                          <span>Participation bonus</span>
                          <span className="font-semibold tabular-nums">
                            {voteBonus !== undefined
                              ? `+${voteBonus.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${symbol}`
                              : "Loading"}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <span>Launch rewards</span>
                          <span className="font-semibold tabular-nums">Accuracy based</span>
                        </div>
                      )}
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
                        {formatHrepAmount(openPhaseGrossReturnMicro)} {symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>If missed but revealed</span>
                      <span className="font-semibold tabular-nums">
                        {formatHrepAmount(openPhaseRevealedRefundMicro)} {symbol}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Live pools</span>
                      <span className="font-semibold tabular-nums">
                        above {formatHrepAmount(upPool, 0)} · below {formatHrepAmount(downPool, 0)}
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
                onClick={() => onConfirm(amount, isUp, predictedUpPercent)}
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

            {confirmError && !isConfirming && <p className="mt-3 text-center text-base text-error">{confirmError}</p>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
