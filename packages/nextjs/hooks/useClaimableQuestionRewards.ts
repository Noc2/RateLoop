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

function normalizeClaimantAddress(value?: string | null): `0x${string}` | null {
  return value && isAddress(value) && value !== zeroAddress ? (value.toLowerCase() as `0x${string}`) : null;
}

export function resolveQuestionRewardClaimant(params: {
  candidateVoter?: string | null;
  connectedAddress?: string | null;
  identityHolder?: string | null;
  payoutWeight?: { account?: string | null } | null;
}) {
  return (
    normalizeClaimantAddress(params.payoutWeight?.account) ??
    normalizeClaimantAddress(params.identityHolder) ??
    normalizeClaimantAddress(params.candidateVoter) ??
    normalizeClaimantAddress(params.connectedAddress)
  );
}

// The ponder API derives `currency` from `asset` (0 -> "LREP", otherwise "USDC"),
// so exactly "LREP" is the only string form besides the numeric asset id.
export function getQuestionRewardAsset(candidate: { asset?: number | null; currency?: string | null }) {
  return candidate.currency === "LREP" || candidate.asset === 0 ? ("LREP" as const) : ("USDC" as const);
}

function normalizeClaimCandidateKeyPart(value: string | null | undefined) {
  return value?.toLowerCase() ?? "";
}

export function getQuestionBundleRewardClaimCandidateKey(
  candidate: Pick<
    PonderQuestionBundleRewardClaimCandidate,
    "bundleId" | "roundSetIndex" | "identityKey" | "identityHolder" | "payoutWeight"
  >,
) {
  const identityKey = candidate.identityKey ?? candidate.payoutWeight?.identityKey;
  const identityHolder = candidate.identityHolder ?? candidate.payoutWeight?.account;
  return [
    candidate.bundleId,
    candidate.roundSetIndex,
    normalizeClaimCandidateKeyPart(identityKey),
    normalizeClaimCandidateKeyPart(identityHolder),
  ].join("-");
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
  type QuestionRewardClaimCandidate = PonderQuestionRewardClaimCandidate & {
    candidateVoter?: string | null;
  };
  type QuestionBundleRewardClaimCandidate = PonderQuestionBundleRewardClaimCandidate & {
    candidateVoter?: string | null;
  };

  const {
    data: result,
    isLoading: candidatesLoading,
    isError: candidatesError,
    refetch: refetchCandidates,
  } = usePonderQuery({
    queryKey: getClaimableQuestionRewardsQueryKey(candidateVoters, targetNetwork.id, deployment?.deploymentKey),
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!voterQuery) return [];
      const pages = await Promise.all(
        candidateVoters.map(async candidateVoter =>
          (
            await ponderApi.getAllQuestionRewardClaimCandidates(candidateVoter, {
              chainId: targetNetwork.id,
              deploymentKey: deployment?.deploymentKey,
            })
          ).map(candidate => ({ ...candidate, candidateVoter })),
        ),
      );
      const seen = new Set<string>();
      return pages.flat().filter(candidate => {
        const key = `${candidate.rewardPoolId}-${candidate.roundId}-${candidate.payoutWeight?.account ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    rpcFn: async () => {
      throw new Error("Reward indexer unavailable");
    },
    rpcEnabled: false,
    enabled: candidateVoters.length > 0 && !delegationLoading,
    staleTime: 30_000,
  });

  const {
    data: bundleResult,
    isLoading: bundleCandidatesLoading,
    isError: bundleCandidatesError,
    refetch: refetchBundleCandidates,
  } = usePonderQuery({
    queryKey: getClaimableQuestionBundleRewardsQueryKey(candidateVoters, targetNetwork.id, deployment?.deploymentKey),
    availabilityDeploymentKey: deployment?.deploymentKey,
    ponderFn: async () => {
      if (!voterQuery) return [];
      const pages = await Promise.all(
        candidateVoters.map(async candidateVoter =>
          (
            await ponderApi.getAllQuestionBundleRewardClaimCandidates(candidateVoter, {
              chainId: targetNetwork.id,
              deploymentKey: deployment?.deploymentKey,
            })
          ).map(candidate => ({ ...candidate, candidateVoter })),
        ),
      );
      const seen = new Set<string>();
      return pages.flat().filter(candidate => {
        const key = getQuestionBundleRewardClaimCandidateKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    rpcFn: async () => {
      throw new Error("Reward indexer unavailable");
    },
    rpcEnabled: false,
    enabled: candidateVoters.length > 0 && !delegationLoading,
    staleTime: 30_000,
  });

  const candidates = useMemo<QuestionRewardClaimCandidate[]>(() => result?.data ?? [], [result?.data]);
  const bundleCandidates = useMemo<QuestionBundleRewardClaimCandidate[]>(
    () => bundleResult?.data ?? [],
    [bundleResult?.data],
  );
  const claimableRequests = useMemo(() => {
    if (!address || !escrowAddress || candidates.length === 0) return [];
    return candidates.flatMap(candidate => {
      const payoutProof = buildPayoutProof(candidate);
      if (candidate.requiresPayoutProof && !payoutProof) return [];
      const claimant = resolveQuestionRewardClaimant({
        candidateVoter: candidate.candidateVoter,
        connectedAddress: address,
        payoutWeight: payoutProof?.payoutWeight,
      });
      if (!claimant) return [];

      const rewardPoolId = safeBigInt(candidate.rewardPoolId);
      const roundId = safeBigInt(candidate.roundId);
      const contract = payoutProof
        ? {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionRewardWithPayoutWeight" as const,
            args: [rewardPoolId, roundId, claimant, payoutProof.payoutWeight, payoutProof.payoutProof],
          }
        : {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionReward" as const,
            args: [rewardPoolId, roundId, claimant],
          };

      return [{ candidate, claimant, payoutProof, contract }];
    });
  }, [address, candidates, escrowAddress, targetNetwork.id]);
  const claimableContracts = useMemo(() => claimableRequests.map(request => request.contract), [claimableRequests]);
  const bundleClaimableRequests = useMemo(() => {
    if (!address || !escrowAddress || bundleCandidates.length === 0) return [];
    return bundleCandidates.flatMap(candidate => {
      const payoutProof = buildPayoutProof(candidate);
      if (candidate.requiresPayoutProof && !payoutProof) return [];
      const claimant = resolveQuestionRewardClaimant({
        candidateVoter: candidate.candidateVoter,
        connectedAddress: address,
        identityHolder: candidate.identityHolder,
        payoutWeight: payoutProof?.payoutWeight,
      });
      if (!claimant) return [];
      const bundleId = safeBigInt(candidate.bundleId);
      const roundSetIndex = BigInt(candidate.roundSetIndex ?? 0);
      const contract = payoutProof
        ? {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionBundleRewardWithPayoutWeight" as const,
            args: [bundleId, roundSetIndex, claimant, payoutProof.payoutWeight, payoutProof.payoutProof],
          }
        : {
            address: escrowAddress,
            chainId: targetNetwork.id,
            abi: QUESTION_REWARD_POOL_ESCROW_ABI,
            functionName: "claimableQuestionBundleReward" as const,
            args: [bundleId, roundSetIndex, claimant],
          };

      return [{ candidate, claimant, payoutProof, contract }];
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
    return claimableRequests.flatMap(({ candidate, claimant, payoutProof }, index) => {
      const resultItem = claimableResults[index];
      const reward = resultItem?.status === "success" ? safeBigInt(resultItem.result) : 0n;
      if (reward <= 0n) return [];
      const item = {
        rewardPoolId: safeBigInt(candidate.rewardPoolId),
        contentId: safeBigInt(candidate.contentId),
        roundId: safeBigInt(candidate.roundId),
        claimant,
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
    return bundleClaimableRequests.flatMap(({ candidate, claimant, payoutProof }, index) => {
      const resultItem = bundleClaimableResults[index];
      const reward = resultItem?.status === "success" ? safeBigInt(resultItem.result) : 0n;
      if (reward <= 0n) return [];
      const bundleId = safeBigInt(candidate.bundleId);
      const roundSetIndex = BigInt(candidate.roundSetIndex ?? 0);
      return [
        {
          bundleId,
          roundSetIndex,
          claimant,
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
    ponderUnavailable: candidatesError || bundleCandidatesError,
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
