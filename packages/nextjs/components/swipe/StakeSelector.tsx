"use client";

import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import { EPOCH_WEIGHT_BPS, USER_PREDICTION_PERCENT } from "@rateloop/contracts/protocol";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount } from "wagmi";
import { HandThumbDownIcon, HandThumbUpIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { InfoTooltip } from "~~/components/ui/InfoTooltip";
import type { ContentItem } from "~~/hooks/contentFeed/shared";
import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { useContentLabel } from "~~/hooks/useCategoryRegistry";
import { useConfidentialityBond } from "~~/hooks/useConfidentialityBond";
import { useRaterIdentityStake, useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { useRoundSnapshot } from "~~/hooks/useRoundSnapshot";
import { getBountyEligibilityBitForKind, getBountyEligibilityRequirement } from "~~/lib/bountyEligibility";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import {
  type OpenRoundFallbackData,
  type VotingConfig,
  getRoundVoteUnavailableMessage,
  isRoundAcceptingVotes,
} from "~~/lib/contracts/roundVotingEngine";
import {
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";
import { estimateVoteReturn, formatLrepAmount } from "~~/lib/vote/voteIncentives";
import {
  type WorldCredentialKind,
  type WorldIdProofPurpose,
  getWorldCredentialOption,
  isWorldCredentialEnabledForBountyUi,
} from "~~/lib/world-id/credentials";
import { notification } from "~~/utils/scaffold-eth";

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
  bountyEligibility?: number | null;
  confidentiality?: ContentItem["confidentiality"] | null;
  contextAccess?: ContentItem["contextAccess"];
  contextVisibility?: ContentItem["contextVisibility"];
  isConfirming?: boolean;
  confirmError?: string | null;
  recheckRefreshKey?: number;
  onConfirm: (stakeAmount: number, isUp: boolean, predictedUpPercent: number) => void;
  onCancel: () => void;
  onRequestWorldIdProof?: (request: { kind: WorldCredentialKind; purpose: WorldIdProofPurpose }) => void;
}

const MIN_COUNTED_STAKE_AMOUNT = 1;
const MIN_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.min;
const MAX_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.max;
const YOUR_VOTE_TOOLTIP =
  "Thumbs up means you think this content is useful for the question; thumbs down means it is unhelpful, broken, misleading, or unsafe.";
const EXPECTED_CROWD_TOOLTIP =
  "Your forecast of what share of revealed raters will choose thumbs up this round. This forecast helps determine rewards; it is separate from your own thumbs up/down vote.";
export const RATING_TOOLTIP =
  "Rating is N/A until this content has at least one settled round. After settlement, it uses the settled community score converted from the protocol's 0-100 scale to a 0-10 display.";
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

/**
 * Converts a display-scale (0-100) community rating to the 0-10 slider scale.
 * Matches formatRatingScoreOutOfTen: divide by 10 exactly once at display time.
 */
export function normalizeStakeSelectorRating(currentRating: number | null | undefined) {
  if (currentRating === null || currentRating === undefined || !Number.isFinite(currentRating)) return 5;
  return clampRating(currentRating / 10);
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

export function getStakeSelectorEligibilityAddress(
  address: string | undefined,
  holder: string | null | undefined,
  isIdentityResolved: boolean,
) {
  if (!address || !isIdentityResolved) return undefined;
  return holder ?? address;
}

export function canStakeSelectorRequestWorldIdProof(
  address: string | undefined,
  eligibilityAddress: string | undefined,
) {
  return Boolean(address && eligibilityAddress && address.toLowerCase() === eligibilityAddress.toLowerCase());
}

function normalizeCredentialStatusBits(data: unknown): { activeMask: number; freshMask: number } | undefined {
  if (!Array.isArray(data) || data.length < 2) return undefined;
  return {
    activeMask: Number(data[0] ?? 0),
    freshMask: Number(data[1] ?? 0),
  };
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
  bountyEligibility = null,
  confidentiality = null,
  contextAccess = "public",
  contextVisibility = "public",
  isConfirming = false,
  confirmError = null,
  recheckRefreshKey = 0,
  onConfirm,
  onCancel,
  onRequestWorldIdProof,
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
  const { holder, identityKey, isResolved: isIdentityResolved } = useRaterRegistryIdentity(address);
  const bountyRequirement = useMemo(() => getBountyEligibilityRequirement(bountyEligibility), [bountyEligibility]);
  const bountyEligibilityAddress = getStakeSelectorEligibilityAddress(address, holder, isIdentityResolved);
  const canRequestWorldIdProof = canStakeSelectorRequestWorldIdProof(address, bountyEligibilityAddress);
  const privateContext = isPrivateContextMetadata({ confidentiality, contextAccess, contextVisibility });
  const confidentialityBondRequirement = useMemo(
    () => getConfidentialityBondRequirement(confidentiality),
    [confidentiality],
  );
  const [hasAcceptedConfidentialTerms, setHasAcceptedConfidentialTerms] = useState(false);
  const [isCheckingConfidentialTerms, setIsCheckingConfidentialTerms] = useState(false);
  const confidentialityBond = useConfidentialityBond({
    bondRequirement: confidentialityBondRequirement,
    contentId,
    enabled: isOpen && privateContext && hasAcceptedConfidentialTerms,
  });

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
  const { data: credentialStatusBits, refetch: refetchCredentialStatusBits } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "credentialStatusBits",
    args: [bountyEligibilityAddress],
    query: { enabled: Boolean(bountyEligibilityAddress && bountyRequirement) },
  });
  const credentialStatus = useMemo(() => normalizeCredentialStatusBits(credentialStatusBits), [credentialStatusBits]);

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
    if (!isOpen || !privateContext) {
      setHasAcceptedConfidentialTerms(false);
      setIsCheckingConfidentialTerms(false);
      return;
    }

    if (!address) {
      setHasAcceptedConfidentialTerms(false);
      setIsCheckingConfidentialTerms(false);
      return;
    }

    let cancelled = false;
    setIsCheckingConfidentialTerms(true);
    fetchConfidentialityTermsStatus(address, contentId)
      .then(status => {
        if (!cancelled) setHasAcceptedConfidentialTerms(status.accepted);
      })
      .catch(() => {
        if (!cancelled) setHasAcceptedConfidentialTerms(false);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingConfidentialTerms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, contentId, isOpen, privateContext]);

  useEffect(() => {
    if (!isOpen || !bountyRequirement) return;
    if (!bountyEligibilityAddress) return;
    void refetchCredentialStatusBits();
  }, [bountyEligibilityAddress, bountyRequirement, isOpen, recheckRefreshKey, refetchCredentialStatusBits]);

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
  const hasRequiredCredential =
    bountyRequirement && credentialStatus
      ? (credentialStatus.activeMask & bountyRequirement.credentialMask) !== 0
      : undefined;
  const hasRecentCredentialRecheck =
    bountyRequirement?.requiresRecentRecheck === true && credentialStatus
      ? (credentialStatus.activeMask & credentialStatus.freshMask & bountyRequirement.credentialMask) !== 0
      : undefined;
  const isWorldIdEligibilityPending =
    Boolean(bountyRequirement) &&
    (!bountyEligibilityAddress || hasRequiredCredential === undefined || credentialStatus === undefined);
  const missingCredentialKinds = bountyRequirement && hasRequiredCredential === false ? bountyRequirement.kinds : [];
  const missingFreshRecheckKinds =
    bountyRequirement?.requiresRecentRecheck === true &&
    hasRequiredCredential === true &&
    hasRecentCredentialRecheck === false
      ? bountyRequirement.kinds.filter(kind => {
          const bit = getBountyEligibilityBitForKind(kind);
          return credentialStatus
            ? (credentialStatus.activeMask & bit) !== 0 && (credentialStatus.freshMask & bit) === 0
            : false;
        })
      : [];
  const worldIdActionPurpose: WorldIdProofPurpose | null =
    missingCredentialKinds.length > 0 ? "credential" : missingFreshRecheckKinds.length > 0 ? "presence" : null;
  const worldIdActionKinds = missingCredentialKinds.length > 0 ? missingCredentialKinds : missingFreshRecheckKinds;
  const worldIdActions =
    worldIdActionPurpose === null
      ? []
      : worldIdActionKinds.map(kind => ({
          kind,
          label: !isWorldCredentialEnabledForBountyUi(kind)
            ? `${getWorldCredentialOption(kind).shortLabel} unavailable`
            : !canRequestWorldIdProof
              ? worldIdActionPurpose === "presence"
                ? `Holder must recheck ${getWorldCredentialOption(kind).shortLabel}`
                : `Holder must verify ${getWorldCredentialOption(kind).shortLabel}`
              : worldIdActionPurpose === "presence"
                ? `Recheck ${getWorldCredentialOption(kind).shortLabel}`
                : `Verify ${getWorldCredentialOption(kind).shortLabel}`,
          purpose: worldIdActionPurpose,
        }));
  const hasEnabledWorldIdAction = worldIdActions.some(action => isWorldCredentialEnabledForBountyUi(action.kind));
  const worldIdActionMessage =
    worldIdActions.length === 0 || !worldIdActionPurpose
      ? null
      : canRequestWorldIdProof
        ? hasEnabledWorldIdAction
          ? worldIdActionPurpose === "presence"
            ? "Recheck one eligible credential before voting to qualify for this bounty."
            : "Verify one eligible credential before voting to qualify for this bounty."
          : "One of the selected credential lanes is not enabled for this deployment."
        : worldIdActionPurpose === "presence"
          ? "The delegated holder must recheck before this vote can qualify for the bounty."
          : "The delegated holder must verify before this vote can qualify for the bounty.";
  const formDisabled = isConfirming || !roundAcceptsVotes;
  const confidentialVoteBlocker = getConfidentialContextVoteBlocker({
    bondRequirement: confidentialityBondRequirement,
    escrowConfigured: Boolean(confidentialityBond.escrowAddress),
    hasAcceptedTerms: hasAcceptedConfidentialTerms,
    hasActiveBond: confidentialityBond.hasActiveBond,
    hasActiveHumanCredential: confidentialityBond.hasActiveHumanCredential && Boolean(confidentialityBond.identityKey),
    identityResolved: confidentialityBond.isIdentityResolved && !confidentialityBond.isIdentityLoading,
    isBondChecking: confidentialityBond.isCheckingBond,
    isGated: privateContext,
    isTermsChecking: isCheckingConfidentialTerms,
  });
  const confirmDisabled =
    formDisabled ||
    cooldownActive ||
    amount < 0 ||
    (amount > 0 && amount > maxStake) ||
    Boolean(confidentialVoteBlocker);
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
  const canPostConfidentialityBond =
    privateContext &&
    hasAcceptedConfidentialTerms &&
    confidentialityBondRequirement.isRequired &&
    confidentialityBond.hasActiveHumanCredential &&
    !confidentialityBond.hasActiveBond;

  const handlePostConfidentialityBond = async () => {
    const posted = await confidentialityBond.postBond();
    if (posted) {
      notification.success("Confidentiality bond posted.");
    } else if (confidentialityBond.error) {
      notification.error(confidentialityBond.error);
    }
  };

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
                  <p className="inline-flex items-center justify-end gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55">
                    <span>Rating</span>
                    <InfoTooltip text={RATING_TOOLTIP} position="bottom" className="[&>svg]:h-3.5 [&>svg]:w-3.5" />
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-base-content/75">{currentRatingLabel}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleSignalChange(true)}
                  data-testid="stake-signal-up"
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
                  data-testid="stake-signal-down"
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

            {(isWorldIdEligibilityPending || (worldIdActions.length > 0 && worldIdActionMessage)) && (
              <div className="mb-4 rounded-lg border border-base-content/10 bg-base-300/60 p-3 text-sm text-base-content/75">
                {isWorldIdEligibilityPending ? (
                  <div className="flex items-center gap-2">
                    <span className="loading loading-spinner loading-xs" />
                    <span>Checking bounty eligibility...</span>
                  </div>
                ) : worldIdActions.length > 0 && worldIdActionMessage ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>{worldIdActionMessage}</span>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {worldIdActions.map(action => (
                        <button
                          key={`${action.purpose}-${action.kind}`}
                          type="button"
                          onClick={() => {
                            if (!canRequestWorldIdProof) return;
                            if (!isWorldCredentialEnabledForBountyUi(action.kind)) return;
                            onRequestWorldIdProof?.({ kind: action.kind, purpose: action.purpose });
                          }}
                          className="btn btn-sm btn-outline shrink-0"
                          disabled={
                            isConfirming ||
                            !canRequestWorldIdProof ||
                            !isWorldCredentialEnabledForBountyUi(action.kind) ||
                            !onRequestWorldIdProof
                          }
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {privateContext ? (
              <div className="mb-4 rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm text-base-content/75">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-warning">Private context</p>
                    <p>
                      {confidentialVoteBlocker ??
                        (confidentialityBondRequirement.isRequired
                          ? `${confidentialityBondRequirement.label} confidentiality bond active.`
                          : "Confidentiality terms accepted. No bond required.")}
                    </p>
                    {confidentialityBond.error ? (
                      <p className="font-medium text-error">{confidentialityBond.error}</p>
                    ) : null}
                  </div>
                  {canPostConfidentialityBond ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline shrink-0"
                      onClick={handlePostConfidentialityBond}
                      disabled={
                        isConfirming ||
                        confidentialityBond.isPostingBond ||
                        !confidentialityBond.escrowAddress ||
                        !confidentialityBond.tokenAddress
                      }
                    >
                      {confidentialityBond.isPostingBond ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : null}
                      Post bond
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="btn flex-1 border border-base-content/10 bg-base-300 text-base-content hover:bg-base-300/80"
                disabled={isConfirming}
              >
                Cancel
              </button>
              <GradientActionButton
                onClick={() => onConfirm(amount, isUp, normalizeStakeSelectorPredictedUpPercent(predictedUpPercent))}
                className="flex-1"
                motion={getGradientActionMotion(Boolean(isConfirming))}
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
              </GradientActionButton>
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
