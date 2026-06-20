"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { buildClaimableQuestionRewardCandidateVoters } from "~~/hooks/useClaimableQuestionRewards";
import { useDelegation } from "~~/hooks/useDelegation";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import { ponderApi } from "~~/services/ponder/client";

export interface ViewerRewardStatus {
  contentId: bigint;
  pendingBountyCount: number;
  claimableBountyCount: number;
  awaitingBountyAllocationCount: number;
  awaitingBountyPayoutCount: number;
  latestBountyRoundId: bigint | null;
  pendingFeedbackBonusCount: number;
  latestFeedbackBonusRoundId: bigint | null;
  hasPendingBounty: boolean;
  hasPendingFeedbackBonus: boolean;
}

function getViewerRewardStatusesQueryKey(
  deploymentKey: string,
  voters?: readonly string[],
  contentIds?: readonly bigint[],
) {
  return [
    "viewerRewardStatuses",
    deploymentKey,
    voters?.join(",") ?? null,
    contentIds?.map(contentId => contentId.toString()).join(",") ?? null,
  ] as const;
}

function safeBigInt(value: string | number | bigint | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizeContentIds(contentIds: readonly bigint[]) {
  const seen = new Set<string>();
  const normalized: bigint[] = [];
  for (const contentId of contentIds) {
    const key = contentId.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(contentId);
  }
  return normalized;
}

export function useViewerRewardStatuses(contentIds: readonly bigint[], enabled = true) {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const normalizedAddress = address?.toLowerCase();
  const { delegateTo, delegateOf, isLoading: delegationLoading } = useDelegation(normalizedAddress);
  const normalizedContentIds = useMemo(() => normalizeContentIds(contentIds), [contentIds]);
  const candidateVoters = useMemo(
    () =>
      buildClaimableQuestionRewardCandidateVoters({
        address: normalizedAddress,
        delegateTo,
        delegateOf,
      }),
    [delegateOf, delegateTo, normalizedAddress],
  );
  const voterQuery = useMemo(() => candidateVoters.join(","), [candidateVoters]);
  const contentIdsQuery = useMemo(
    () => normalizedContentIds.map(contentId => contentId.toString()).join(","),
    [normalizedContentIds],
  );
  const ponderDeploymentKey = useMemo(
    () => resolveProtocolDeploymentScope(targetNetwork.id)?.deploymentKey ?? `missing:${targetNetwork.id}`,
    [targetNetwork.id],
  );

  const { data, isLoading, refetch } = usePonderQuery({
    queryKey: getViewerRewardStatusesQueryKey(ponderDeploymentKey, candidateVoters, normalizedContentIds),
    ponderFn: async () => {
      if (!voterQuery || !contentIdsQuery) return { items: [] };
      return ponderApi.getViewerRewardStatuses(
        { voters: voterQuery, contentIds: contentIdsQuery },
        { chainId: targetNetwork.id, deploymentKey: ponderDeploymentKey },
      );
    },
    rpcFn: async () => ({ items: [] }),
    availabilityDeploymentKey: ponderDeploymentKey,
    enabled: enabled && candidateVoters.length > 0 && normalizedContentIds.length > 0 && !delegationLoading,
    staleTime: 30_000,
  });

  const statusByContentId = useMemo(() => {
    const map = new Map<string, ViewerRewardStatus>();
    for (const item of data?.data.items ?? []) {
      const contentId = safeBigInt(item.contentId);
      if (contentId === null) continue;
      map.set(contentId.toString(), {
        contentId,
        pendingBountyCount: item.pendingBountyCount,
        claimableBountyCount: item.claimableBountyCount,
        awaitingBountyAllocationCount: item.awaitingBountyAllocationCount,
        awaitingBountyPayoutCount: item.awaitingBountyPayoutCount,
        latestBountyRoundId: safeBigInt(item.latestBountyRoundId),
        pendingFeedbackBonusCount: item.pendingFeedbackBonusCount,
        latestFeedbackBonusRoundId: safeBigInt(item.latestFeedbackBonusRoundId),
        hasPendingBounty: item.hasPendingBounty,
        hasPendingFeedbackBonus: item.hasPendingFeedbackBonus,
      });
    }
    return map;
  }, [data]);

  return {
    isLoading: delegationLoading || isLoading,
    refetch,
    statusByContentId,
  };
}
