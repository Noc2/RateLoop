"use client";

import { useMemo } from "react";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import { normalizeComparableAddress } from "~~/lib/address/normalization";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { type PonderVoterStreak, ponderApi } from "~~/services/ponder/client";

const EMPTY_STREAK: PonderVoterStreak = {
  currentDailyStreak: 0,
  bestDailyStreak: 0,
  totalActiveDays: 0,
  lastActiveDate: null,
  lastMilestoneDay: 0,
  milestones: [],
  nextMilestone: null,
  nextMilestoneBaseBonus: null,
};

export function getVoterStreakQueryKey(address?: string, chainId?: number, deploymentKey?: string | null) {
  return [
    "ponder-fallback",
    "voterStreak",
    chainId ?? null,
    deploymentKey ?? null,
    normalizeComparableAddress(address),
  ] as const;
}

/**
 * Fetches daily voting streak data from Ponder API.
 */
export function useVoterStreak(address?: string): PonderVoterStreak | null {
  const { targetNetwork } = useTargetNetwork();
  const isPageVisible = usePageVisibility();
  const normalizedAddress = normalizeComparableAddress(address) ?? undefined;
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);

  const { data } = usePonderQuery<PonderVoterStreak, PonderVoterStreak>({
    queryKey: ["voterStreak", targetNetwork.id, deployment?.deploymentKey ?? null, normalizedAddress],
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!normalizedAddress) {
        return EMPTY_STREAK;
      }

      return ponderApi.getVoterStreak(normalizedAddress, {
        chainId: targetNetwork.id,
        deploymentKey: deployment?.deploymentKey,
      });
    },
    rpcFn: async () => EMPTY_STREAK,
    enabled: Boolean(normalizedAddress),
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  return data?.data ?? null;
}
