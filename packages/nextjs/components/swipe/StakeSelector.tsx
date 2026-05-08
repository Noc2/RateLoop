"use client";

import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { EPOCH_WEIGHT_BPS } from "@ratemesh/contracts/protocol";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
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
  openRound?: OpenRoundFallbackData | null;
  roundConfig?: VotingConfig | null;
  cooldownSecondsRemaining?: number;
  isConfirming?: boolean;
  confirmError?: string | null;
  onConfirm: (stakeAmount: number, predictedRating: number) => void;
  onCancel: () => void;
}

const PRESET_AMOUNTS = [1, 5, 25, 50, 100];
const MIN_RATING = 0;
const MAX_RATING = 10;

function clampRating(value: number) {
  if (!Number.isFinite(value)) return 5;
  return Math.min(MAX_RATING, Math.max(MIN_RATING, value));
}

function getInitialPredictionRating(currentRating: number | undefined) {
  const baseRating = clampRating(currentRating ?? 5);
  return Math.round(baseRating * 10) / 10;
}

/**
 * Bottom-sheet modal to select stake amount before committing a predicted rating.
 */
export function StakeSelector({
  isOpen,
  contentId,
  categoryId,
  currentRating,
  openRound,
  roundConfig,
  cooldownSecondsRemaining = 0,
  isConfirming = false,
  confirmError = null,
  onConfirm,
  onCancel,
}: StakeSelectorProps) {
  const stakeAmountInputId = useId();
  const predictionRatingInputId = useId();
  const contentLabel = useContentLabel(categoryId);
  const [amount, setAmount] = useState(5);
  const [predictedRating, setPredictedRating] = useState(() => getInitialPredictionRating(currentRating));
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
    setPredictedRating(getInitialPredictionRating(currentRating));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isConfirming) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentRating, isConfirming, isOpen, onCancel]);

  const symbol = tokenSymbol ?? "MREP";
  const { calculateBonus } = useParticipationRate();
  const voteBonus = calculateBonus(amount);
  const normalizedCurrentRating = clampRating(currentRating ?? 5);
  const predictionDelta = predictedRating - normalizedCurrentRating;
  const predictionDirectionIsHigher = predictionDelta >= 0;
  const voteEstimate = estimateVoteReturn(estimateSnapshot, predictionDirectionIsHigher, amount);
  const predictionTone =
    Math.abs(predictionDelta) < 0.05
      ? "Same final rating"
      : predictionDelta > 0
        ? "Higher final rating"
        : "Lower final rating";
  const predictionToneClassName =
    Math.abs(predictionDelta) < 0.05 ? "text-base-content/70" : predictionDelta > 0 ? "text-success" : "text-error";

  const balanceFormatted = hrepBalance ? Number(hrepBalance) / 1e6 : 0;
  const capacityFormatted = remainingCapacity != null ? Number(remainingCapacity) / 1e6 : 100;
  const maxByBalance = Math.floor(balanceFormatted);
  const maxByCapacity = Math.floor(capacityFormatted);
  const maxStake = Math.min(maxByBalance, maxByCapacity);
  const sliderMax = Math.max(1, maxStake);
  const isCapacityLimited = maxByCapacity < maxByBalance;
  const cooldownActive = cooldownSecondsRemaining > 0;
  const confirmDisabled = isConfirming || cooldownActive || amount < 1 || amount > maxStake || maxStake < 1;
  const phaseHeadline = effectiveIsBlind ? "Private round" : "Post-epoch reveal";
  const phaseToneClassName = effectiveIsBlind ? "bg-primary/10" : "bg-warning/10";
  const phaseHeadlineClassName = effectiveIsBlind ? "text-primary" : "text-warning";
  const selectedPresetClassName = "action-orange-control";
  const sliderClassName = "range range-primary range-sm w-full";
  const sliderStyle = { "--range-thumb": "var(--curyo-warm-white)" } as CSSProperties;
  const weightPercent = Math.round(
    (effectiveIsBlind ? EPOCH_WEIGHT_BPS.blind : EPOCH_WEIGHT_BPS.informed) / 100,
  ).toLocaleString();
  const participationBonusMicro = voteBonus !== undefined ? BigInt(Math.round(voteBonus * 1e6)) : null;
  const openPhaseGrossReturnMicro =
    participationBonusMicro !== null ? voteEstimate.estimatedGrossReturnMicro + participationBonusMicro : null;
  const openPhaseRevealedRefundMicro =
    participationBonusMicro !== null ? voteEstimate.revealedLoserRefundMicro + participationBonusMicro : null;
  const openPhaseParticipationTooltip =
    voteBonus !== undefined
      ? `Includes the current participation bonus of +${voteBonus.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${symbol}.`
      : "Includes the current participation bonus once it finishes loading.";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Select reputation lock and predicted final rating"
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
              Predict the final rating
              <span
                className="tooltip tooltip-bottom ml-1.5 inline-block cursor-help align-middle"
                data-tip="You can only submit one prediction per content per round. Choose your stake carefully!"
                role="img"
                aria-label="You can only submit one prediction per content per round. Choose your stake carefully!"
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

            <div className="mb-5 rounded-2xl bg-base-100/70 px-4 py-4 ring-1 ring-base-content/10">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
                    Your prediction
                  </p>
                  <p className="mt-1 text-4xl font-bold tabular-nums text-base-content">
                    {predictedRating.toFixed(1)}
                    <span className="ml-1 text-base font-semibold text-base-content/55">/ 10</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">Current</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-base-content/75">
                    {normalizedCurrentRating.toFixed(1)}
                  </p>
                  <p className={`mt-0.5 text-xs font-semibold ${predictionToneClassName}`}>{predictionTone}</p>
                </div>
              </div>
              <label htmlFor={predictionRatingInputId} className="sr-only">
                Predicted final rating
              </label>
              <input
                id={predictionRatingInputId}
                name="predicted-rating"
                type="range"
                min={MIN_RATING}
                max={MAX_RATING}
                step={0.1}
                value={predictedRating}
                onChange={e => setPredictedRating(Number(e.target.value))}
                className="range range-primary range-sm mt-4 w-full"
                style={sliderStyle}
                disabled={isConfirming}
                aria-label="Predicted final rating"
                aria-valuetext={`${predictedRating.toFixed(1)} out of 10`}
              />
              <div className="mt-1 flex justify-between text-xs text-base-content/55">
                <span>0</span>
                <span>10</span>
              </div>
            </div>

            <div className="mb-5 space-y-1 text-center text-base text-base-content/60">
              <p>
                Balance: {balanceFormatted.toLocaleString(undefined, { maximumFractionDigits: 0 })} {symbol}
              </p>
            </div>

            <div className="mb-5 flex flex-wrap justify-center gap-2">
              {PRESET_AMOUNTS.filter(a => a <= maxStake).map(preset => (
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
                min={1}
                max={sliderMax}
                value={Math.min(amount, sliderMax)}
                onChange={e => setAmount(Number(e.target.value))}
                className={sliderClassName}
                style={sliderStyle}
                disabled={isConfirming || maxStake < 1}
                aria-label="Stake amount"
              />
              <div className="mt-1 flex justify-between text-base text-base-content/60">
                <span>1</span>
                <span>{sliderMax}</span>
              </div>
            </div>

            <div className="my-5 text-center">
              <span className="text-4xl font-bold tabular-nums">{amount}</span>
              <span className="ml-2 text-base text-base-content/60">{symbol}</span>
              {isCapacityLimited && (
                <span
                  className="tooltip tooltip-top ml-2 inline-block cursor-help align-middle"
                  data-tip={`Max per ${contentLabel}: ${maxByCapacity} ${symbol} remaining (100 limit per round)`}
                  role="img"
                  aria-label={`Max per ${contentLabel}: ${maxByCapacity} ${symbol} remaining (100 limit per round)`}
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

            <div className={`mb-4 rounded-2xl px-4 py-3 ${phaseToneClassName}`}>
              <div className="flex items-center gap-1.5">
                <p className={`text-sm font-semibold ${phaseHeadlineClassName}`}>{phaseHeadline}</p>
                {!effectiveIsBlind && <InfoTooltip text={openPhaseParticipationTooltip} position="bottom" />}
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-base-content/80">
                {effectiveIsBlind ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span>Participation bonus</span>
                      <span className="font-semibold tabular-nums">
                        {voteBonus !== undefined
                          ? `+${voteBonus.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${symbol}`
                          : "Loading"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Reward weight</span>
                      <span className="font-semibold tabular-nums">{weightPercent}% (4x vs open)</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <span>Est. return if accurate</span>
                      <span className="font-semibold tabular-nums">
                        {openPhaseGrossReturnMicro !== null
                          ? `${formatHrepAmount(openPhaseGrossReturnMicro)} ${symbol}`
                          : "Loading"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>If missed but revealed</span>
                      <span className="font-semibold tabular-nums">
                        {openPhaseRevealedRefundMicro !== null
                          ? `${formatHrepAmount(openPhaseRevealedRefundMicro)} ${symbol}`
                          : "Loading"}
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
                onClick={() => onConfirm(amount, predictedRating)}
                className="btn flex-1 action-orange-control"
                disabled={confirmDisabled}
              >
                {isConfirming ? (
                  <span className="flex items-center gap-2 text-base-content">
                    <span className="loading loading-spinner loading-xs" />
                    <span>Submitting...</span>
                  </span>
                ) : (
                  `Stake ${amount} ${symbol}`
                )}
              </button>
            </div>

            {confirmError && !isConfirming && <p className="mt-3 text-center text-base text-error">{confirmError}</p>}

            {maxStake < 1 && maxByBalance < 1 && (
              <p className="mt-3 text-center text-base text-error">
                Insufficient {symbol} balance.{" "}
                <Link href="/governance" className="link link-primary">
                  Get some from the faucet!
                </Link>
              </p>
            )}
            {maxStake < 1 && maxByBalance >= 1 && maxByCapacity < 1 && (
              <p className="mt-3 text-center text-base text-warning">
                You have reached the 100 {symbol} stake limit for this {contentLabel} this round.
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
