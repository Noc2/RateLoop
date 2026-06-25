"use client";

import { useMemo } from "react";
import { buildClaimableQuestionRewardCandidateVoters } from "./useClaimableQuestionRewards";
import { useDelegation } from "./useDelegation";
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

export function mergeRecentVotesForConnectedWallet(
  pages: readonly PonderVoteItem[][],
  connectedWallet: string,
): PonderVoteItem[] {
  const me = connectedWallet.toLowerCase();
  const seen = new Set<string>();
  const merged: PonderVoteItem[] = [];

  for (const vote of pages.flat()) {
    const voter = vote.voter?.toLowerCase();
    const holder = (vote.identityHolder ?? vote.voter)?.toLowerCase();
    if (holder !== me && voter !== me) continue;

    const key = vote.id ?? `${vote.contentId}-${vote.roundId}-${voter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(vote);
  }

  return merged;
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
  const { delegateTo, delegateOf, isLoading: delegationLoading } = useDelegation(normalizedVoter);
  const candidateVoters = useMemo(
    () =>
      buildClaimableQuestionRewardCandidateVoters({
        address: normalizedVoter,
        delegateTo,
        delegateOf,
      }),
    [delegateOf, delegateTo, normalizedVoter],
  );
  const voterQuery = useMemo(() => candidateVoters.join(","), [candidateVoters]);

  const {
    data: result,
    isLoading,
    isError,
    refetch,
  } = usePonderQuery({
    queryKey: ["recentUserVotes", targetNetwork.id, deployment?.deploymentKey ?? null, voterQuery],
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!normalizedVoter || candidateVoters.length === 0) return [] as PonderVoteItem[];

      const pages = await Promise.all(
        candidateVoters.map(candidate =>
          ponderApi.getAllVotes(
            { voter: candidate },
            { chainId: targetNetwork.id, deploymentKey: deployment?.deploymentKey },
          ),
        ),
      );

      return mergeRecentVotesForConnectedWallet(pages, normalizedVoter);
    },
    rpcFn: async () => {
      throw new Error("Reward indexer unavailable");
    },
    rpcEnabled: false,
    enabled: !!normalizedVoter && candidateVoters.length > 0 && !delegationLoading,
    staleTime: 30_000,
    refetchInterval: isPageVisible ? 60_000 : false,
  });

  const votes = useMemo(() => result?.data ?? [], [result?.data]);
  const openVotes = useMemo(() => votes.filter(vote => vote.roundState === ROUND_STATE.Open), [votes]);

  return {
    votes,
    openVotes,
    isLoading: isLoading || delegationLoading,
    refetch,
    ponderUnavailable: isError,
  };
}
