"use client";

import { useMemo } from "react";
import { isAddress, zeroAddress } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import { type ClaimableRewardItem, type QuestionRewardPayoutWeight } from "~~/hooks/claimableRewards";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useDelegation } from "~~/hooks/useDelegation";
import { usePonderQuery } from "~~/hooks/usePonderQuery";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import {
  QUESTION_REWARD_POOL_ESCROW_ABI,
  getConfiguredQuestionRewardPoolEscrowAddress,
} from "~~/lib/questionRewardPools";
import {
  type PonderQuestionBundleRewardClaimCandidate,
  type PonderQuestionRewardClaimCandidate,
  ponderApi,
} from "~~/services/ponder/client";

export function getClaimableQuestionRewardsQueryKey(
  addresses?: readonly string[],
  chainId?: number,
  deploymentKey?: string | null,
) {
  return ["claimableQuestionRewards", addresses?.join(",") ?? null, chainId ?? null, deploymentKey ?? null] as const;
}

function getClaimableQuestionBundleRewardsQueryKey(
  addresses?: readonly string[],
  chainId?: number,
  deploymentKey?: string | null,
) {
  return [
    "claimableQuestionBundleRewards",
    addresses?.join(",") ?? null,
    chainId ?? null,
    deploymentKey ?? null,
  ] as const;
}

export function buildClaimableQuestionRewardCandidateVoters(params: {
  address?: string | null;
  delegateTo?: string | null;
  delegateOf?: string | null;
}) {
  const voters = [params.address, params.delegateTo, params.delegateOf]
    .map(value => value?.toLowerCase())
    .filter((value): value is string => !!value && isAddress(value) && value !== zeroAddress);

  return [...new Set(voters)];
}

function safeBigInt(value: unknown): bigint {
  try {
    return BigInt(value as string | number | bigint);
  } catch {
    return 0n;
  }
}

// The ponder API derives `currency` from `asset` (0 -> "LREP", otherwise "USDC"),
// so exactly "LREP" is the only string form besides the numeric asset id.
export function getQuestionRewardAsset(candidate: { asset?: number | null; currency?: string | null }) {
  return candidate.currency === "LREP" || candidate.asset === 0 ? ("LREP" as const) : ("USDC" as const);
}

function buildPayoutWeight(
  payoutWeight?:
    | PonderQuestionRewardClaimCandidate["payoutWeight"]
    | PonderQuestionBundleRewardClaimCandidate["payoutWeight"],
): QuestionRewardPayoutWeight | null {
  if (!payoutWeight) return null;

  return {
    domain: payoutWeight.domain,
    rewardPoolId: safeBigInt(payoutWeight.rewardPoolId),
    contentId: safeBigInt(payoutWeight.contentId),
    roundId: safeBigInt(payoutWeight.roundId),
    commitKey: payoutWeight.commitKey,
    identityKey: payoutWeight.identityKey,
    account: payoutWeight.account,
    baseWeight: safeBigInt(payoutWeight.baseWeight),
    independenceBps: payoutWeight.independenceBps,
    effectiveWeight: safeBigInt(payoutWeight.effectiveWeight),
    reasonHash: payoutWeight.reasonHash,
  };
}

function buildPayoutProof(candidate: PonderQuestionRewardClaimCandidate | PonderQuestionBundleRewardClaimCandidate) {
  const payoutWeight = buildPayoutWeight(candidate.payoutWeight);
  const payoutProof = candidate.payoutProof ?? null;
  if (!payoutWeight || !payoutProof) return null;
  return { payoutWeight, payoutProof };
}

export function useClaimableQuestionRewards() {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const deployment = useMemo(() => resolveProtocolDeploymentScope(targetNetwork.id), [targetNetwork.id]);
  const normalizedAddress = address?.toLowerCase();
  const { delegateTo, delegateOf, isLoading: delegationLoading } = useDelegation(normalizedAddress);
  const escrowAddress = useMemo(
    () => getConfiguredQuestionRewardPoolEscrowAddress(targetNetwork.id),
    [targetNetwork.id],
  );
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

  const {
    data: result,
    isLoading: candidatesLoading,
    refetch: refetchCandidates,
  } = usePonderQuery({
    queryKey: getClaimableQuestionRewardsQueryKey(candidateVoters, targetNetwork.id, deployment?.deploymentKey),
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!voterQuery) return [];
      const response = await ponderApi.getQuestionRewardClaimCandidates(
        voterQuery,
        { limit: "500" },
        { chainId: targetNetwork.id, deploymentKey: deployment?.deploymentKey },
      );
      return response.items;
    },
    rpcFn: async () => [],
    enabled: candidateVoters.length > 0 && !delegationLoading,
    staleTime: 30_000,
  });

  const {
    data: bundleResult,
    isLoading: bundleCandidatesLoading,
    refetch: refetchBundleCandidates,
  } = usePonderQuery({
    queryKey: getClaimableQuestionBundleRewardsQueryKey(candidateVoters, targetNetwork.id, deployment?.deploymentKey),
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!voterQuery) return [];
      const response = await ponderApi.getQuestionBundleRewardClaimCandidates(
        voterQuery,
        { limit: "500" },
        { chainId: targetNetwork.id, deploymentKey: deployment?.deploymentKey },
      );
      return response.items;
    },
    rpcFn: async () => [],
    enabled: candidateVoters.length > 0 && !delegationLoading,
    staleTime: 30_000,
  });

  const candidates = useMemo(() => result?.data ?? [], [result?.data]);
  const bundleCandidates = useMemo(() => bundleResult?.data ?? [], [bundleResult?.data]);
  const claimableRequests = useMemo(() => {
    if (!address || !escrowAddress || candidates.length === 0) return [];
    return candidates.flatMap(candidate => {
      const payoutProof = buildPayoutProof(candidate);
      if (candidate.requiresPayoutProof && !payoutProof) return [];

      const rewardPoolId = safeBigInt(candidate.rewardPoolId);
      const roundId = safeBigInt(candidate.roundId);
      const contract = payoutProof
        ? {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionRewardWithPayoutWeight" as const,
            args: [rewardPoolId, roundId, address, payoutProof.payoutWeight, payoutProof.payoutProof],
          }
        : {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionReward" as const,
            args: [rewardPoolId, roundId, address],
          };

      return [{ candidate, payoutProof, contract }];
    });
  }, [address, candidates, escrowAddress, targetNetwork.id]);
  const claimableContracts = useMemo(() => claimableRequests.map(request => request.contract), [claimableRequests]);
  const bundleClaimableRequests = useMemo(() => {
    if (!address || !escrowAddress || bundleCandidates.length === 0) return [];
    return bundleCandidates.flatMap(candidate => {
      const payoutProof = buildPayoutProof(candidate);
      if (candidate.requiresPayoutProof && !payoutProof) return [];
      const bundleId = safeBigInt(candidate.bundleId);
      const roundSetIndex = BigInt(candidate.roundSetIndex ?? 0);
      const contract = payoutProof
        ? {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionBundleRewardWithPayoutWeight" as const,
            args: [bundleId, roundSetIndex, address, payoutProof.payoutWeight, payoutProof.payoutProof],
          }
        : {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionBundleReward" as const,
            args: [bundleId, roundSetIndex, address],
          };

      return [{ candidate, payoutProof, contract }];
    });
  }, [address, bundleCandidates, escrowAddress, targetNetwork.id]);
  const bundleClaimableContracts = useMemo(
    () => bundleClaimableRequests.map(request => request.contract),
    [bundleClaimableRequests],
  );

  const {
    data: claimableResults,
    isLoading: claimablesLoading,
    refetch: refetchClaimables,
  } = useReadContracts({
    contracts: claimableContracts,
    query: { enabled: claimableContracts.length > 0 },
  });
  const {
    data: bundleClaimableResults,
    isLoading: bundleClaimablesLoading,
    refetch: refetchBundleClaimables,
  } = useReadContracts({
    contracts: bundleClaimableContracts,
    query: { enabled: bundleClaimableContracts.length > 0 },
  });

  const claimableItems = useMemo<ClaimableRewardItem[]>(() => {
    if (!claimableResults || claimableResults.length !== claimableRequests.length) return [];
    return claimableRequests.flatMap(({ candidate, payoutProof }, index) => {
      const resultItem = claimableResults[index];
      const reward = resultItem?.status === "success" ? safeBigInt(resultItem.result) : 0n;
      if (reward <= 0n) return [];
      const item = {
        rewardPoolId: safeBigInt(candidate.rewardPoolId),
        contentId: safeBigInt(candidate.contentId),
        roundId: safeBigInt(candidate.roundId),
        reward,
        asset: getQuestionRewardAsset(candidate),
        title: candidate.title,
        claimType: "question_reward" as const,
      };
      if (!payoutProof) return [item];
      return [
        {
          ...item,
          payoutWeight: payoutProof.payoutWeight,
          payoutProof: payoutProof.payoutProof,
        },
      ];
    });
  }, [claimableRequests, claimableResults]);

  const bundleClaimableItems = useMemo<ClaimableRewardItem[]>(() => {
    if (!bundleClaimableResults || bundleClaimableResults.length !== bundleClaimableRequests.length) return [];
    return bundleClaimableRequests.flatMap(({ candidate, payoutProof }, index) => {
      const resultItem = bundleClaimableResults[index];
      const reward = resultItem?.status === "success" ? safeBigInt(resultItem.result) : 0n;
      if (reward <= 0n) return [];
      const bundleId = safeBigInt(candidate.bundleId);
      const roundSetIndex = BigInt(candidate.roundSetIndex ?? 0);
      return [
        {
          bundleId,
          roundSetIndex,
          reward,
          asset: getQuestionRewardAsset(candidate),
          title: `Bundle #${bundleId.toString()} round set ${roundSetIndex + 1n}`,
          claimType: "question_bundle_reward" as const,
          ...(payoutProof
            ? {
                payoutWeight: payoutProof.payoutWeight,
                payoutProof: payoutProof.payoutProof,
              }
            : {}),
        },
      ];
    });
  }, [bundleClaimableRequests, bundleClaimableResults]);

  const allClaimableItems = useMemo(
    () => [...claimableItems, ...bundleClaimableItems],
    [bundleClaimableItems, claimableItems],
  );

  return {
    claimableItems: allClaimableItems,
    isLoading:
      candidatesLoading || claimablesLoading || bundleCandidatesLoading || bundleClaimablesLoading || delegationLoading,
    refetch: async () => {
      await Promise.all([
        refetchCandidates(),
        refetchClaimables(),
        refetchBundleCandidates(),
        refetchBundleClaimables(),
      ]);
    },
  };
}
