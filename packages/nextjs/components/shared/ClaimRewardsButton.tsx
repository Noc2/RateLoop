"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import {
  getClaimableRewardItemKey,
  pollClaimableRewardsRefresh,
  sumClaimableRewardTotals,
} from "~~/hooks/claimableRewards";
import { useAllClaimableRewards } from "~~/hooks/useAllClaimableRewards";
import { useClaimAll } from "~~/hooks/useClaimAll";
import { formatUsdAmount } from "~~/lib/questionRewardPools";
import { formatLrepAmount } from "~~/lib/vote/voteIncentives";

const MIN_VISIBLE_LREP_AMOUNT = 50_000n;
const MIN_VISIBLE_USDC_AMOUNT = 5_000n;

type ClaimRewardsButtonProps = {
  className?: string;
  layout?: "default" | "compact";
  showUnavailableStatus?: boolean;
  showTokenSymbol?: boolean;
};

export function buildClaimRewardsButtonParts({
  showTokenSymbol,
  totalLrepClaimable,
  totalUsdcClaimable,
}: {
  showTokenSymbol: boolean;
  totalLrepClaimable: bigint;
  totalUsdcClaimable: bigint;
}) {
  const claimParts: string[] = [];

  if (totalLrepClaimable >= MIN_VISIBLE_LREP_AMOUNT) {
    claimParts.push(`${formatLrepAmount(totalLrepClaimable)}${showTokenSymbol ? " LREP" : ""}`);
  }
  if (totalUsdcClaimable >= MIN_VISIBLE_USDC_AMOUNT) {
    claimParts.push(formatUsdAmount(totalUsdcClaimable));
  }

  return claimParts;
}

export function buildClaimRewardsButtonLabel({
  showTokenSymbol,
  totalLrepClaimable,
  totalUsdcClaimable,
}: {
  showTokenSymbol: boolean;
  totalLrepClaimable: bigint;
  totalUsdcClaimable: bigint;
}) {
  const claimParts = buildClaimRewardsButtonParts({ showTokenSymbol, totalLrepClaimable, totalUsdcClaimable });

  return claimParts.length > 0 ? `Claim ${claimParts.join(" + ")}` : null;
}

export function shouldShowClaimPreparationLabel({
  isClaimAttemptInFlight,
  isClaiming,
  isPreparingClaim,
}: {
  isClaimAttemptInFlight: boolean;
  isClaiming: boolean;
  isPreparingClaim: boolean;
}) {
  return isClaimAttemptInFlight && isPreparingClaim && !isClaiming;
}

export function shouldShowClaimRewardsUnavailableStatus({
  claimablesLoading,
  isClaiming,
  isPreparingActiveClaim,
  ponderUnavailable,
  showUnavailableStatus,
  visibleClaimableItemsCount,
}: {
  claimablesLoading: boolean;
  isClaiming: boolean;
  isPreparingActiveClaim: boolean;
  ponderUnavailable: boolean;
  showUnavailableStatus: boolean;
  visibleClaimableItemsCount: number;
}) {
  return (
    showUnavailableStatus &&
    ponderUnavailable &&
    !claimablesLoading &&
    visibleClaimableItemsCount === 0 &&
    !isClaiming &&
    !isPreparingActiveClaim
  );
}

export function ClaimRewardsButton({
  className,
  layout = "default",
  showUnavailableStatus = true,
  showTokenSymbol = true,
}: ClaimRewardsButtonProps) {
  const { address } = useAccount();
  const {
    claimableItems,
    totalLrepClaimable,
    totalUsdcClaimable,
    ponderUnavailable,
    isLoading: claimablesLoading,
    refetch: refetchClaimable,
  } = useAllClaimableRewards();
  const { claimAll, isClaiming, isPreparingClaim, progress } = useClaimAll();
  const [optimisticallyClaimedKeys, setOptimisticallyClaimedKeys] = useState<Set<string>>(() => new Set());
  const [isClaimAttemptInFlight, setIsClaimAttemptInFlight] = useState(false);
  const claimInFlightRef = useRef(false);
  const claimableItemsRef = useRef(claimableItems);

  useEffect(() => {
    claimInFlightRef.current = false;
    setIsClaimAttemptInFlight(false);
    setOptimisticallyClaimedKeys(new Set());
  }, [address]);

  useEffect(() => {
    claimableItemsRef.current = claimableItems;
  }, [claimableItems]);

  const visibleClaimableItems = useMemo(
    () => claimableItems.filter(item => !optimisticallyClaimedKeys.has(getClaimableRewardItemKey(item))),
    [claimableItems, optimisticallyClaimedKeys],
  );

  const { totalLrepClaimable: visibleLrepClaimable, totalUsdcClaimable: visibleUsdcClaimable } = useMemo(
    () => sumClaimableRewardTotals(visibleClaimableItems),
    [visibleClaimableItems],
  );

  useEffect(() => {
    if (optimisticallyClaimedKeys.size === 0) return;

    setOptimisticallyClaimedKeys(previousKeys => {
      const nextKeys = new Set(previousKeys);
      let changed = false;

      for (const key of previousKeys) {
        const stillClaimable = claimableItems.some(item => getClaimableRewardItemKey(item) === key);
        if (!stillClaimable) {
          nextKeys.delete(key);
          changed = true;
        }
      }

      return changed ? nextKeys : previousKeys;
    });
  }, [claimableItems, optimisticallyClaimedKeys.size]);

  const handleClaimAll = useCallback(() => {
    if (claimInFlightRef.current || isClaiming) return;

    const itemsToClaim = visibleClaimableItems;
    if (itemsToClaim.length === 0) return;

    claimInFlightRef.current = true;
    setIsClaimAttemptInFlight(true);
    const claimKeys = itemsToClaim.map(getClaimableRewardItemKey);
    setOptimisticallyClaimedKeys(previousKeys => new Set([...previousKeys, ...claimKeys]));

    void claimAll(itemsToClaim, async ({ claimedItems, failedItems }) => {
      if (failedItems.length > 0) {
        const failedKeys = new Set(failedItems.map(getClaimableRewardItemKey));
        setOptimisticallyClaimedKeys(previousKeys => {
          const nextKeys = new Set(previousKeys);
          for (const key of failedKeys) {
            nextKeys.delete(key);
          }
          return nextKeys;
        });
      }

      const succeededKeys = claimedItems.map(getClaimableRewardItemKey);
      if (succeededKeys.length === 0) {
        if (failedItems.length === itemsToClaim.length) {
          setOptimisticallyClaimedKeys(new Set());
        }
        return;
      }

      await pollClaimableRewardsRefresh(refetchClaimable, {
        shouldStop: () =>
          !claimedItems.some(item =>
            claimableItemsRef.current.some(
              claimable => getClaimableRewardItemKey(claimable) === getClaimableRewardItemKey(item),
            ),
          ),
      });

      const converged = !claimedItems.some(item =>
        claimableItemsRef.current.some(
          claimable => getClaimableRewardItemKey(claimable) === getClaimableRewardItemKey(item),
        ),
      );
      if (!converged) return;

      setOptimisticallyClaimedKeys(previousKeys => {
        const nextKeys = new Set(previousKeys);
        for (const key of succeededKeys) {
          nextKeys.delete(key);
        }
        return nextKeys;
      });
    }).finally(() => {
      claimInFlightRef.current = false;
      setIsClaimAttemptInFlight(false);
    });
  }, [claimAll, isClaiming, refetchClaimable, visibleClaimableItems]);

  const isPreparingActiveClaim = shouldShowClaimPreparationLabel({
    isClaimAttemptInFlight,
    isClaiming,
    isPreparingClaim,
  });

  if (
    visibleClaimableItems.length === 0 &&
    totalLrepClaimable <= 0n &&
    totalUsdcClaimable <= 0n &&
    !isClaiming &&
    !isPreparingActiveClaim &&
    !ponderUnavailable
  ) {
    return null;
  }

  if (
    shouldShowClaimRewardsUnavailableStatus({
      claimablesLoading,
      isClaiming,
      isPreparingActiveClaim,
      ponderUnavailable,
      showUnavailableStatus,
      visibleClaimableItemsCount: visibleClaimableItems.length,
    })
  ) {
    return (
      <p className={`${className ?? ""} text-xs text-base-content/60`} role="status">
        Reward indexer unavailable
      </p>
    );
  }

  const claimParts = buildClaimRewardsButtonParts({
    showTokenSymbol,
    totalLrepClaimable: visibleLrepClaimable,
    totalUsdcClaimable: visibleUsdcClaimable,
  });
  const claimLabel = claimParts.length > 0 ? `Claim ${claimParts.join(" + ")}` : null;

  if (!claimLabel && !isClaiming && !isPreparingActiveClaim) {
    return null;
  }

  const isProcessing = isClaiming || isPreparingActiveClaim;
  const useCompactMixedRewardLabel = layout === "compact" && claimParts.length > 1 && !isProcessing;
  const label = isPreparingActiveClaim ? (
    "Preparing..."
  ) : isClaiming ? (
    `Claim ${progress.current}/${progress.total}`
  ) : useCompactMixedRewardLabel ? (
    <>
      <span>Claim</span>
      <span className="text-sm font-semibold text-base-content/78">{claimParts.join(" + ")}</span>
    </>
  ) : (
    claimLabel
  );

  return (
    <div className={className}>
      <GradientActionButton
        onClick={handleClaimAll}
        disabled={isClaiming || isPreparingActiveClaim || visibleClaimableItems.length === 0}
        fullWidth
        size="sm"
        data-claim-layout={useCompactMixedRewardLabel ? "compact" : undefined}
        motion={getGradientActionMotion(isProcessing)}
      >
        {label}
      </GradientActionButton>
    </div>
  );
}
