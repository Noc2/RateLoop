"use client";

import { useMemo } from "react";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { PonderVoterCategoryStats, PonderVoterStats, ponderApi } from "~~/services/ponder/client";

interface VoterAccuracyResult {
  stats: PonderVoterStats | null;
  categories: PonderVoterCategoryStats[];
}

const EMPTY: VoterAccuracyResult = { stats: null, categories: [] };

export function useVoterAccuracy(address: string | undefined) {
  const isPageVisible = usePageVisibility();
  const { targetNetwork } = useTargetNetwork();
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const deploymentKey = deployment?.deploymentKey ?? null;
  const { data } = usePonderQuery<VoterAccuracyResult, VoterAccuracyResult>({
    queryKey: ["voterAccuracy", address, targetNetwork.id, deploymentKey],
    availabilityDeploymentKey: deploymentKey,
    ponderFn: async () => {
      if (!address) return EMPTY;
      return ponderApi.getVoterAccuracy(address, { chainId: targetNetwork.id, deploymentKey });
    },
    rpcFn: async () => EMPTY, // No on-chain equivalent
    enabled: !!address,
    staleTime: 15_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  return data?.data ?? EMPTY;
}
