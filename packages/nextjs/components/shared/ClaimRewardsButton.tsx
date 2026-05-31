"use client";

import { GradientActionButton, getGradientActionMotion } from "~~/components/shared/GradientAction";
import { useAllClaimableRewards } from "~~/hooks/useAllClaimableRewards";
import { useClaimAll } from "~~/hooks/useClaimAll";
import { formatUsdAmount } from "~~/lib/questionRewardPools";

function formatLrepAmount(value: bigint) {
  return (Number(value) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

type ClaimRewardsButtonProps = {
  buttonClassName?: string;
  className?: string;
  showTokenSymbol?: boolean;
};

export function ClaimRewardsButton({ buttonClassName, className, showTokenSymbol = true }: ClaimRewardsButtonProps) {
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
  const label = isPreparingClaim
    ? "Preparing..."
    : isClaiming
      ? `Claim ${progress.current}/${progress.total}`
      : totalLrepClaimable > 0n && totalUsdcClaimable > 0n
        ? `Claim ${formatLrepAmount(totalLrepClaimable)}${showTokenSymbol ? " LREP" : ""} + ${formatUsdAmount(
            totalUsdcClaimable,
          )}`
        : totalLrepClaimable > 0n && totalUsdcClaimable <= 0n
          ? `Claim ${formatLrepAmount(totalLrepClaimable)}${showTokenSymbol ? " LREP" : ""}`
          : `Claim ${formatUsdAmount(totalUsdcClaimable)}`;

  if (buttonClassName) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={handleClaimAll}
          disabled={isClaiming || isPreparingClaim}
          className={buttonClassName}
        >
          {label}
        </button>
      </div>
    );
  }

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
