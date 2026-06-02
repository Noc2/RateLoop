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
  showTokenSymbol?: boolean;
};

export function buildClaimRewardsButtonLabel({
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

  return claimParts.length > 0 ? `Claim ${claimParts.join(" + ")}` : null;
}

export function ClaimRewardsButton({ className, showTokenSymbol = true }: ClaimRewardsButtonProps) {
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
  const claimLabel = buildClaimRewardsButtonLabel({ showTokenSymbol, totalLrepClaimable, totalUsdcClaimable });

  if (!claimLabel && !isClaiming && !isPreparingClaim) {
    return null;
  }

  const label = isPreparingClaim
    ? "Preparing..."
    : isClaiming
      ? `Claim ${progress.current}/${progress.total}`
      : claimLabel;

  return (
    <div className={className}>
      <GradientActionButton
        onClick={handleClaimAll}
        disabled={isClaiming || isPreparingClaim}
        className="w-full"
        size="sm"
        motion={getGradientActionMotion(isClaiming || isPreparingClaim)}
      >
        {label}
      </GradientActionButton>
    </div>
  );
}
