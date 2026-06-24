"use client";

import { type CSSProperties, useEffect, useId, useMemo, useState } from "react";
import { USER_PREDICTION_PERCENT } from "@rateloop/contracts/protocol";
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
import {
  type VoteUiConfig,
  getCrowdForecastLabel,
  getExpectedCrowdTooltip,
  getSignalToneLabel,
  getVoteButtonPresentation,
  getYourVoteTooltip,
} from "~~/lib/vote/voteUiConfig";
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
  chainId?: number | null;
  questionTitle?: string;
  categoryId?: bigint;
  currentRating?: number | null;
  initialStakeAmount?: number;
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
  voteUiConfig?: VoteUiConfig;
}

const MIN_COUNTED_STAKE_AMOUNT = 1;
const MIN_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.min;
const MAX_PREDICTED_UP_PERCENT = USER_PREDICTION_PERCENT.max;
export const STAKE_AMOUNT_TOOLTIP =
  "Stake is optional LREP you put behind your vote. It represents your conviction in this rating and can affect rewards or losses after settlement.";
export const RATING_TOOLTIP =
  "Rating is N/A until this content has at least one settled round. After settlement, it uses the settled community score converted from the protocol's 0-100 scale to a 0-10 display.";
const metricLabelClassName =
  "inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-base-content/55";
const metricValueClassName = "mt-1 text-2xl font-bold tabular-nums text-base-content";
const metricUnitClassName = "ml-1 text-sm font-semibold text-base-content/55";

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

export function getNextStakeSelectorAmount(
  currentAmount: number,
  maxStake: number,
  hasAdjustedStake: boolean,
  initialStakeAmount = MIN_COUNTED_STAKE_AMOUNT,
) {
  if (!Number.isFinite(maxStake) || maxStake < MIN_COUNTED_STAKE_AMOUNT) return 0;
  if (!hasAdjustedStake) {
    return Math.min(normalizeStakeSelectorAmount(initialStakeAmount), maxStake);
  }
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

export function shouldShowConfidentialStakeStatus(params: {
  isPrivateContext: boolean;
  blocker: string | null;
  canPostBond: boolean;
  hasError?: boolean;
  isPending?: boolean;
}) {
  return (
    params.isPrivateContext &&
    (params.canPostBond || Boolean(params.hasError) || (Boolean(params.blocker) && !params.isPending))
  );
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
  chainId,
  questionTitle,
  categoryId,
  currentRating,
  initialStakeAmount,
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
  voteUiConfig = { mode: "thumbs" },
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
  const [hasCheckedConfidentialTerms, setHasCheckedConfidentialTerms] = useState(false);
  const confidentialityBond = useConfidentialityBond({
    bondRequirement: confidentialityBondRequirement,
    contentId,
    enabled: isOpen && privateContext && hasAcceptedConfidentialTerms,
  });

  const roundSnapshot = useRoundSnapshot(contentId, openRound ?? undefined, roundConfig ?? undefined);
  const { roundId: currentRoundId } = roundSnapshot;
  const roundAcceptsVotes = isRoundAcceptingVotes(roundSnapshot);

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
  const signalTone = getSignalToneLabel(voteUiConfig, isUp);
  const signalToneClassName = isUp ? "text-success" : "text-error";
  const upPresentation = getVoteButtonPresentation(voteUiConfig, "up");
  const downPresentation = getVoteButtonPresentation(voteUiConfig, "down");
  const yourVoteTooltip = getYourVoteTooltip(voteUiConfig);
  const expectedCrowdTooltip = getExpectedCrowdTooltip(voteUiConfig);
  const crowdForecastLabel = getCrowdForecastLabel(voteUiConfig);
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
    setAmount(currentAmount =>
      getNextStakeSelectorAmount(currentAmount, maxStake, hasAdjustedStake, initialStakeAmount),
    );
  }, [hasAdjustedStake, initialStakeAmount, isOpen, maxStake]);

  useEffect(() => {
    if (!isOpen || !privateContext) {
      setHasAcceptedConfidentialTerms(false);
      setIsCheckingConfidentialTerms(false);
      setHasCheckedConfidentialTerms(false);
      return;
    }

    if (!address) {
      setHasAcceptedConfidentialTerms(false);
      setIsCheckingConfidentialTerms(false);
      setHasCheckedConfidentialTerms(false);
      return;
    }

    let cancelled = false;
    setIsCheckingConfidentialTerms(true);
    fetchConfidentialityTermsStatus(address, contentId, { chainId })
      .then(status => {
        if (!cancelled) {
          setHasAcceptedConfidentialTerms(status.accepted);
          setHasCheckedConfidentialTerms(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasAcceptedConfidentialTerms(false);
          setHasCheckedConfidentialTerms(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsCheckingConfidentialTerms(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, chainId, contentId, isOpen, privateContext]);

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
            ? "Recheck before voting. Otherwise no bounty rewards."
            : "Verify one eligible credential before voting to qualify for this bounty."
          : "One of the selected credential lanes is not enabled for this deployment."
        : worldIdActionPurpose === "presence"
          ? "Holder must recheck. Otherwise no bounty rewards."
          : "The delegated holder must verify before this vote can qualify for the bounty.";
  const worldIdNoticeClassName =
    worldIdActionPurpose === "presence"
      ? "mb-4 rounded-lg border border-warning/50 bg-warning/15 p-3 text-sm text-base-content"
      : "mb-4 rounded-lg border border-base-content/10 bg-base-300/60 p-3 text-sm text-base-content/75";
  const formDisabled = isConfirming || !roundAcceptsVotes;
  const isConfidentialTermsStatusPending = Boolean(
    isOpen && privateContext && address && !hasAcceptedConfidentialTerms && !hasCheckedConfidentialTerms,
  );
  const isConfidentialBondStatusPending = Boolean(
    hasAcceptedConfidentialTerms &&
      confidentialityBondRequirement.isRequired &&
      confidentialityBond.hasActiveHumanCredential &&
      confidentialityBond.identityKey &&
      !confidentialityBond.hasCheckedBond &&
      !confidentialityBond.error,
  );
  const isConfidentialAccessPending =
    isCheckingConfidentialTerms ||
    isConfidentialTermsStatusPending ||
    confidentialityBond.isIdentityLoading ||
    confidentialityBond.isCheckingBond ||
    isConfidentialBondStatusPending;
  const confidentialVoteBlocker = getConfidentialContextVoteBlocker({
    bondRequirement: confidentialityBondRequirement,
    escrowConfigured: Boolean(confidentialityBond.escrowAddress),
    hasAcceptedTerms: hasAcceptedConfidentialTerms,
    hasActiveBond: confidentialityBond.hasActiveBond,
    hasActiveHumanCredential: confidentialityBond.hasActiveHumanCredential && Boolean(confidentialityBond.identityKey),
    identityResolved: confidentialityBond.isIdentityResolved && !confidentialityBond.isIdentityLoading,
    isBondChecking: confidentialityBond.isCheckingBond || isConfidentialBondStatusPending,
    isGated: privateContext,
    isTermsChecking: isCheckingConfidentialTerms || isConfidentialTermsStatusPending,
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
  const sliderClassName = "range range-primary range-sm w-full";
  const sliderStyle = { "--range-thumb": "var(--rateloop-warm-white)" } as CSSProperties;
  const canPostConfidentialityBond =
    privateContext &&
    hasAcceptedConfidentialTerms &&
    confidentialityBondRequirement.isRequired &&
    confidentialityBond.hasActiveHumanCredential &&
    confidentialityBond.hasCheckedBond &&
    !confidentialityBond.hasActiveBond;
  const showConfidentialStakeStatus = shouldShowConfidentialStakeStatus({
    blocker: confidentialVoteBlocker,
    canPostBond: canPostConfidentialityBond,
    hasError: Boolean(confidentialityBond.error),
    isPrivateContext: privateContext,
    isPending: isConfidentialAccessPending,
  });

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
                    <InfoTooltip text={yourVoteTooltip} position="bottom" />
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
                  {upPresentation.variant === "thumbs" ? <HandThumbUpIcon className="h-5 w-5" /> : null}
                  {upPresentation.longLabel}
                </button>
                <button
                  type="button"
                  onClick={() => handleSignalChange(false)}
                  data-testid="stake-signal-down"
                  className={`btn min-h-12 rounded-lg ${!isUp ? "btn-error text-error-content" : "pill-inactive-muted"}`}
                  disabled={formDisabled}
                  aria-pressed={!isUp}
                >
                  {downPresentation.variant === "thumbs" ? <HandThumbDownIcon className="h-5 w-5" /> : null}
                  {downPresentation.longLabel}
                </button>
              </div>
              <div className="mt-5 border-t border-base-content/10 pt-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className={metricLabelClassName}>
                      <span>Crowd forecast</span>
                      <InfoTooltip text={expectedCrowdTooltip} position="bottom" />
                    </p>
                    <p className={metricValueClassName}>
                      {predictedUpPercent.toFixed(0)}
                      <span className={metricUnitClassName}>{crowdForecastLabel}</span>
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
                  aria-label={
                    voteUiConfig.mode === "head_to_head" ? "Crowd forecast for option A" : "Crowd thumbs-up forecast"
                  }
                  aria-valuetext={`${predictedUpPercent.toFixed(0)} ${crowdForecastLabel}`}
                />
                <div className="mt-1 flex justify-between text-xs text-base-content/55">
                  <span>{MIN_PREDICTED_UP_PERCENT}%</span>
                  <span>{MAX_PREDICTED_UP_PERCENT}%</span>
                </div>
              </div>
            </div>

            <div className="mb-3 px-1">
              <div className="mb-4">
                <p className={metricLabelClassName}>
                  <span>Stake amount</span>
                  <InfoTooltip text={STAKE_AMOUNT_TOOLTIP} position="bottom" />
                </p>
                <p className={metricValueClassName}>
                  {amount.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  <span className={metricUnitClassName}>{symbol}</span>
                  {isCapacityLimited && (
                    <InfoTooltip
                      text={`Max per rater for this ${contentLabel}: ${maxByCapacity} ${symbol} remaining (10 limit per round)`}
                      position="top"
                      className="ml-2 align-middle"
                    />
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

            {(isWorldIdEligibilityPending || (worldIdActions.length > 0 && worldIdActionMessage)) && (
              <div className={worldIdNoticeClassName}>
                {isWorldIdEligibilityPending ? (
                  <div className="flex items-center gap-2">
                    <span className="loading loading-spinner loading-xs" />
                    <span>Checking bounty eligibility...</span>
                  </div>
                ) : worldIdActions.length > 0 && worldIdActionMessage ? (
                  <div className="flex flex-col items-start gap-2">
                    <div className="flex max-w-full flex-wrap gap-2">
                      {worldIdActions.map(action => (
                        <button
                          key={`${action.purpose}-${action.kind}`}
                          type="button"
                          onClick={() => {
                            if (!canRequestWorldIdProof) return;
                            if (!isWorldCredentialEnabledForBountyUi(action.kind)) return;
                            onRequestWorldIdProof?.({ kind: action.kind, purpose: action.purpose });
                          }}
                          className="btn btn-sm btn-outline h-auto max-w-full whitespace-normal px-3 py-2 text-left leading-tight"
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
                    <span className="block leading-relaxed">{worldIdActionMessage}</span>
                  </div>
                ) : null}
              </div>
            )}

            {showConfidentialStakeStatus ? (
              <div className="mb-4 rounded-lg border border-warning/20 bg-warning/10 p-3 text-sm text-base-content/75">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold text-warning">Private context</p>
                    {confidentialVoteBlocker ? <p>{confidentialVoteBlocker}</p> : null}
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
