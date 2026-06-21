"use client";

import { useMemo } from "react";
import { usePonderQuery } from "./usePonderQuery";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { QueryClient } from "@tanstack/react-query";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { usePageVisibility } from "~~/hooks/usePageVisibility";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { type PonderVoteItem, ponderApi } from "~~/services/ponder/client";

function normalizeVoter(voter?: string) {
  return voter?.toLowerCase() ?? null;
}

export function getRecentUserVotesQueryKey(voter?: string, chainId?: number, deploymentKey?: string | null) {
  return ["ponder-fallback", "recentUserVotes", chainId ?? null, deploymentKey ?? null, normalizeVoter(voter)] as const;
}

export function invalidateRecentUserVotes(
  queryClient: QueryClient,
  voter?: string,
  chainId?: number,
  deploymentKey?: string | null,
) {
  return queryClient.invalidateQueries({ queryKey: getRecentUserVotesQueryKey(voter, chainId, deploymentKey) });
}

export function useRecentUserVotes(voter?: string) {
  const { targetNetwork } = useTargetNetwork();
  const isPageVisible = usePageVisibility();
  const normalizedVoter = normalizeVoter(voter) ?? undefined;
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const {
    data: result,
    isLoading,
    refetch,
  } = usePonderQuery({
    queryKey: ["recentUserVotes", targetNetwork.id, deployment?.deploymentKey ?? null, normalizedVoter],
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!normalizedVoter) return [] as PonderVoteItem[];
      return ponderApi.getAllVotes(
        { voter: normalizedVoter },
        { chainId: targetNetwork.id, deploymentKey: deployment?.deploymentKey },
      );
    },
    rpcFn: async () => [] as PonderVoteItem[],
    enabled: !!normalizedVoter,
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  const votes = useMemo(() => result?.data ?? [], [result?.data]);
  const openVotes = useMemo(() => votes.filter(vote => vote.roundState === ROUND_STATE.Open), [votes]);

  return {
    votes,
    openVotes,
    isLoading,
    refetch,
  };
}
