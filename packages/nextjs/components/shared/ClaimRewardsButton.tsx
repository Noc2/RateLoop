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

export function ClaimRewardsButton({ className, layout = "default", showTokenSymbol = true }: ClaimRewardsButtonProps) {
  const { address } = useAccount();
  const {
    claimableItems,
    totalLrepClaimable,
    totalUsdcClaimable,
    refetch: refetchClaimable,
  } = useAllClaimableRewards();
  const { claimAll, isClaiming, isPreparingClaim, progress } = useClaimAll();
  const [optimisticallyClaimedKeys, setOptimisticallyClaimedKeys] = useState<Set<string>>(() => new Set());
  const claimInFlightRef = useRef(false);
  const claimableItemsRef = useRef(claimableItems);

  useEffect(() => {
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
    if (claimInFlightRef.current || isClaiming || isPreparingClaim) return;

    const itemsToClaim = visibleClaimableItems;
    if (itemsToClaim.length === 0) return;

    claimInFlightRef.current = true;
    const claimKeys = itemsToClaim.map(getClaimableRewardItemKey);
    setOptimisticallyClaimedKeys(previousKeys => new Set([...previousKeys, ...claimKeys]));

    void claimAll(itemsToClaim, async ({ claimedItems }) => {
      setOptimisticallyClaimedKeys(previousKeys => {
        const nextKeys = new Set(previousKeys);
        for (const key of claimKeys) {
          nextKeys.delete(key);
        }
        return nextKeys;
      });

      if (claimedItems.length === 0) {
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
    }).finally(() => {
      claimInFlightRef.current = false;
    });
  }, [claimAll, isClaiming, isPreparingClaim, refetchClaimable, visibleClaimableItems]);

  if (
    visibleClaimableItems.length === 0 &&
    totalLrepClaimable <= 0n &&
    totalUsdcClaimable <= 0n &&
    !isClaiming &&
    !isPreparingClaim
  ) {
    return null;
  }

  const claimParts = buildClaimRewardsButtonParts({
    showTokenSymbol,
    totalLrepClaimable: visibleLrepClaimable,
    totalUsdcClaimable: visibleUsdcClaimable,
  });
  const claimLabel = claimParts.length > 0 ? `Claim ${claimParts.join(" + ")}` : null;

  if (!claimLabel && !isClaiming && !isPreparingClaim) {
    return null;
  }

  const isProcessing = isClaiming || isPreparingClaim;
  const useCompactMixedRewardLabel = layout === "compact" && claimParts.length > 1 && !isProcessing;
  const label = isPreparingClaim ? (
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
        disabled={isClaiming || isPreparingClaim || visibleClaimableItems.length === 0}
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
