"use client";

import { useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { usePageVisibility } from "~~/hooks/usePageVisibility";

/**
 * Hook to read the current ParticipationPool reward rate.
 * Returns the rate as basis points, percentage, and a helper to calculate bonuses.
 */
export function useParticipationRate() {
  const isPageVisible = usePageVisibility();
  const {
    data: currentRateBps,
    isLoading: rateLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "ParticipationPool" as any,
    functionName: "getCurrentRateBps",
    query: {
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  } as any);
  const { data: poolBalance, isLoading: balanceLoading } = useScaffoldReadContract({
    contractName: "ParticipationPool" as any,
    functionName: "poolBalance",
    query: {
      staleTime: 30_000,
      refetchInterval: isPageVisible ? 60_000 : false,
    },
  } as any);

  const hasActiveParticipationRewards = typeof poolBalance === "bigint" && poolBalance > 0n;
  const rateBps = hasActiveParticipationRewards && currentRateBps ? Number(currentRateBps) : undefined;
  const ratePercent = rateBps !== undefined ? rateBps / 100 : undefined;

  const calculateBonus = (stakeAmount: number): number | undefined => {
    if (rateBps === undefined) return undefined;
    return (stakeAmount * rateBps) / 10_000;
  };

  return {
    rateBps,
    ratePercent,
    calculateBonus,
    hasActiveParticipationRewards,
    isLoading: rateLoading || balanceLoading,
    refetch,
  };
}
