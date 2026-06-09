"use client";

import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
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
  const {
    claimableItems,
    totalLrepClaimable,
    totalUsdcClaimable,
    refetch: refetchClaimable,
  } = useAllClaimableRewards();
  const { claimAll, isClaiming, isPreparingClaim, progress } = useClaimAll();

  if (claimableItems.length === 0 || (totalLrepClaimable <= 0n && totalUsdcClaimable <= 0n)) {
    return null;
  }

  const handleClaimAll = () => {
    void claimAll(claimableItems, () => refetchClaimable());
  };
  const claimParts = buildClaimRewardsButtonParts({ showTokenSymbol, totalLrepClaimable, totalUsdcClaimable });
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
        disabled={isClaiming || isPreparingClaim}
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
