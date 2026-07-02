"use client";

import { useCallback, useMemo } from "react";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useReadContracts } from "wagmi";
import {
  type ClaimableRewardItem,
  buildRoundClaimStateLookup,
  calculateLastClaimAwarePoolShare,
  hasIndexedRefundClaim,
} from "~~/hooks/claimableRewards";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useClaimableFrontendRewards } from "~~/hooks/useClaimableFrontendRewards";
import { useClaimableQuestionRewards } from "~~/hooks/useClaimableQuestionRewards";
import { useRecentUserVotes } from "~~/hooks/useRecentUserVotes";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
import type { PonderVoteItem } from "~~/services/ponder/client";

const RBTS_REWARD_STATE_FIELDS = 3;

type UseAllClaimableRewardsOptions = {
  includeFrontendRewards?: boolean;
};

export function resolveAllClaimableRewardsOptions(options: UseAllClaimableRewardsOptions = {}) {
  return {
    includeFrontendRewards: options.includeFrontendRewards ?? true,
  };
}

function safeBigInt(val: unknown): bigint {
  try {
    return BigInt(val as string | number | bigint);
  } catch {
    return 0n;
  }
}

function safeBigIntResult(results: readonly unknown[] | undefined, index: number): bigint | null {
  const result = results?.[index] as { status?: string; result?: unknown } | undefined;
  return result?.status === "success" ? safeBigInt(result.result) : null;
}

function safeTupleBigIntResult(
  results: readonly unknown[] | undefined,
  index: number,
  tupleIndex: number,
): bigint | null {
  const result = results?.[index] as { status?: string; result?: unknown } | undefined;
  if (result?.status !== "success" || !Array.isArray(result.result)) return null;
  return safeBigInt(result.result[tupleIndex]);
}

function isRbtsRewardRound(vote: PonderVoteItem) {
  return vote.roundRbtsRewardWeight !== null && vote.roundRbtsRewardWeight !== undefined;
}

function rbtsRewardWeight(vote: PonderVoteItem) {
  return safeBigInt(vote.rbtsRewardWeight);
}

function isRefundRound(vote: PonderVoteItem) {
  const state = vote.roundState;
  return state === ROUND_STATE.Cancelled || state === ROUND_STATE.Tied || state === ROUND_STATE.RevealFailed;
}

/**
 * Hook that identifies all claimable rewards across all rounds and content.
 * Uses Ponder API to find the user's recent votes, then checks on-chain state.
 */
export function useAllClaimableRewards(options: UseAllClaimableRewardsOptions = {}) {
  const { includeFrontendRewards } = resolveAllClaimableRewardsOptions(options);
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const {
    votes,
    refetch: refetchVotes,
    ponderUnavailable: votesPonderUnavailable,
    isLoading: votesLoading,
  } = useRecentUserVotes(address);
  const {
    claimableItems: frontendClaimableItems,
    isLoading: frontendClaimableLoading,
    feesUnavailable: frontendFeesUnavailable,
    refetch: refetchFrontendClaimables,
  } = useClaimableFrontendRewards({ enabled: includeFrontendRewards });
  const {
    claimableItems: questionRewardPoolClaimableItems,
    isLoading: questionRewardPoolClaimableLoading,
    refetch: refetchQuestionRewardPoolClaimables,
    ponderUnavailable: questionRewardsPonderUnavailable,
  } = useClaimableQuestionRewards();

  // --- Step 2: Filter to terminal rounds only ---
  const terminalVotes = useMemo(() => {
    return votes.filter(v => {
      const state = v.roundState;
      if (state === ROUND_STATE.Cancelled) return true;
      if ((state === ROUND_STATE.Tied || state === ROUND_STATE.RevealFailed) && v.revealed) return true;
      if (state === ROUND_STATE.Settled && v.revealed && v.isUp !== null) return true;
      return false;
    });
  }, [votes]);

  // --- Step 3: Multicall rewardClaimed to filter out already claimed ---
  const { data: distributorInfo } = useDeployedContractInfo({
    contractName: "RoundRewardDistributor",
    chainId: targetNetwork.id as any,
  });
  const { data: engineInfo } = useDeployedContractInfo({
    contractName: "RoundVotingEngine" as any,
    chainId: targetNetwork.id as any,
  });

  const claimLookups = useMemo(() => {
    return terminalVotes.map(v =>
      buildRoundClaimStateLookup({
        contentId: BigInt(v.contentId),
        roundId: BigInt(v.roundId),
        connectedAddress: address as `0x${string}`,
        voter: v.voter,
        commitKey: v.commitKey,
        settled: v.roundState === ROUND_STATE.Settled,
      }),
    );
  }, [address, terminalVotes]);

  const claimedContracts = useMemo(() => {
    if (!distributorInfo || !engineInfo || !address || terminalVotes.length === 0) return [];
    return claimLookups.flatMap(lookup => {
      if (!lookup) return [];
      return {
        address: lookup.contract === "distributor" ? distributorInfo.address : engineInfo.address,
        chainId: targetNetwork.id,
        abi: lookup.contract === "distributor" ? distributorInfo.abi : engineInfo.abi,
        functionName: lookup.functionName,
        args: lookup.args,
      };
    });
  }, [distributorInfo, engineInfo, address, terminalVotes.length, claimLookups, targetNetwork.id]);

  const {
    data: claimedResults,
    isLoading: claimedLoading,
    refetch: refetchClaimed,
  } = useReadContracts({
    contracts: claimedContracts,
    query: { enabled: claimedContracts.length > 0 },
  });

  // --- Step 4: Classify unclaimed votes into reward-path and refund-path claims ---
  const unclaimedVotes = useMemo(() => {
    if (terminalVotes.length === 0) return [];
    if (claimedLoading || !claimedResults || claimedResults.length !== claimedContracts.length) {
      return [];
    }
    let claimedIndex = 0;
    return terminalVotes.filter((vote, i) => {
      if (isRefundRound(vote)) return !hasIndexedRefundClaim(vote);
      const lookup = claimLookups[i];
      if (!lookup) return true;
      const r = claimedResults[claimedIndex++];
      if (r?.status !== "success") return true;
      return r.result === false;
    });
  }, [terminalVotes, claimedContracts.length, claimedLoading, claimedResults, claimLookups]);

  const { rewardVotes, refundVotes } = useMemo(() => {
    const rewards: typeof unclaimedVotes = [];
    const refunds: typeof unclaimedVotes = [];
    for (const v of unclaimedVotes) {
      const state = v.roundState;
      if (state === ROUND_STATE.Cancelled || state === ROUND_STATE.Tied || state === ROUND_STATE.RevealFailed) {
        refunds.push(v);
      } else if (state === ROUND_STATE.Settled) {
        rewards.push(v);
      }
    }
    return { rewardVotes: rewards, refundVotes: refunds };
  }, [unclaimedVotes]);

  const settledRbtsVotes = useMemo(() => rewardVotes.filter(v => isRbtsRewardRound(v)), [rewardVotes]);

  // --- Step 5: Multicall RBTS reward state for exact last-claimant estimates ---
  const rbtsRewardStateContracts = useMemo(() => {
    if (!engineInfo || !distributorInfo || settledRbtsVotes.length === 0) return [];
    return settledRbtsVotes
      .map(v => ({
        contentId: BigInt(v.contentId),
        roundId: BigInt(v.roundId),
      }))
      .flatMap(({ contentId, roundId }) => [
        {
          address: distributorInfo.address,
          chainId: targetNetwork.id,
          abi: distributorInfo.abi,
          functionName: "roundVoterRewardClaimedCount" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          chainId: targetNetwork.id,
          abi: distributorInfo.abi,
          functionName: "roundVoterRewardClaimedAmount" as const,
          args: [contentId, roundId],
        },
        {
          address: engineInfo.address,
          chainId: targetNetwork.id,
          abi: engineInfo.abi,
          functionName: "rbtsRoundState" as const,
          args: [contentId, roundId],
        },
      ]);
  }, [distributorInfo, engineInfo, settledRbtsVotes, targetNetwork.id]);

  const {
    data: rbtsRewardStateResults,
    isLoading: rbtsRewardsLoading,
    refetch: refetchRbtsRewardState,
  } = useReadContracts({
    contracts: rbtsRewardStateContracts,
    query: { enabled: rbtsRewardStateContracts.length > 0 },
  });

  // --- Step 6: Build claimable items with calculated rewards ---
  const { claimableItems, activeStake } = useMemo(() => {
    const items: ClaimableRewardItem[] = [];

    // Add cancelled / tied / reveal-failed refunds.
    for (const v of refundVotes) {
      const stake = safeBigInt(v.stake);
      items.push({
        commitKey: typeof v.commitKey === "string" ? (v.commitKey as `0x${string}`) : null,
        contentId: safeBigInt(v.contentId),
        roundId: safeBigInt(v.roundId),
        reward: stake,
        claimType: "refund",
        voter: typeof v.voter === "string" ? (v.voter as `0x${string}`) : null,
      });
    }

    // Add RBTS-scored rewards. Positive score spreads return stake and earn voter-pool share.
    if (
      !rbtsRewardsLoading &&
      rbtsRewardStateResults &&
      rbtsRewardStateResults.length === settledRbtsVotes.length * RBTS_REWARD_STATE_FIELDS
    ) {
      for (let i = 0; i < settledRbtsVotes.length; i++) {
        const v = settledRbtsVotes[i];
        const stateIndex = i * RBTS_REWARD_STATE_FIELDS;
        const scoreWeight = rbtsRewardWeight(v);
        const stakeReturned = safeBigInt(v.rbtsStakeReturned);
        const voterRewardClaimedCount = safeBigIntResult(rbtsRewardStateResults, stateIndex) ?? 0n;
        const voterRewardClaimedAmount = safeBigIntResult(rbtsRewardStateResults, stateIndex + 1) ?? 0n;
        const voterPool = safeTupleBigIntResult(rbtsRewardStateResults, stateIndex + 2, 4) ?? 0n;
        const totalScoreWeight =
          safeTupleBigIntResult(rbtsRewardStateResults, stateIndex + 2, 2) ?? safeBigInt(v.roundRbtsRewardWeight);
        const totalRewardClaimants =
          safeTupleBigIntResult(rbtsRewardStateResults, stateIndex + 2, 3) ?? safeBigInt(v.roundRbtsRewardClaimants);
        let reward = stakeReturned;

        reward += calculateLastClaimAwarePoolShare({
          claimantWeight: scoreWeight,
          totalWeight: totalScoreWeight,
          pool: voterPool,
          totalClaimants: totalRewardClaimants,
          claimedCount: voterRewardClaimedCount,
          claimedAmount: voterRewardClaimedAmount,
        });

        if (reward > 0n) {
          items.push({
            commitKey: typeof v.commitKey === "string" ? (v.commitKey as `0x${string}`) : null,
            contentId: safeBigInt(v.contentId),
            roundId: safeBigInt(v.roundId),
            reward,
            claimType: "reward",
            voter: typeof v.voter === "string" ? (v.voter as `0x${string}`) : null,
          });
        }
      }
    }

    // Active stake = sum of stakes in open rounds
    let active = 0n;
    for (const v of votes) {
      if (v.roundState === ROUND_STATE.Open) {
        active += safeBigInt(v.stake);
      }
    }

    return { claimableItems: items, activeStake: active };
  }, [refundVotes, rbtsRewardsLoading, rbtsRewardStateResults, settledRbtsVotes, votes]);

  const includedFrontendClaimableItems = useMemo(
    () => (includeFrontendRewards ? frontendClaimableItems : []),
    [frontendClaimableItems, includeFrontendRewards],
  );

  const combinedClaimableItems = useMemo(
    () => [...claimableItems, ...includedFrontendClaimableItems, ...questionRewardPoolClaimableItems],
    [claimableItems, includedFrontendClaimableItems, questionRewardPoolClaimableItems],
  );

  const combinedLrepClaimable = useMemo(
    () =>
      [
        ...claimableItems,
        ...includedFrontendClaimableItems,
        ...questionRewardPoolClaimableItems.filter(
          item =>
            (item.claimType === "question_reward" || item.claimType === "question_bundle_reward") &&
            item.asset === "LREP",
        ),
      ].reduce((sum, item) => sum + item.reward, 0n),
    [claimableItems, includedFrontendClaimableItems, questionRewardPoolClaimableItems],
  );

  const totalQuestionRewardPoolUsdcClaimable = useMemo(
    () =>
      questionRewardPoolClaimableItems
        .filter(
          item =>
            (item.claimType === "question_reward" || item.claimType === "question_bundle_reward") &&
            item.asset === "USDC",
        )
        .reduce((sum, item) => sum + item.reward, 0n),
    [questionRewardPoolClaimableItems],
  );

  const isLoading =
    votesLoading ||
    claimedLoading ||
    rbtsRewardsLoading ||
    (includeFrontendRewards && frontendClaimableLoading) ||
    questionRewardPoolClaimableLoading;
  const ponderUnavailable =
    votesPonderUnavailable || questionRewardsPonderUnavailable || (includeFrontendRewards && frontendFeesUnavailable);

  const refetch = useCallback(async () => {
    await Promise.all([
      refetchVotes(),
      refetchClaimed(),
      refetchRbtsRewardState(),
      ...(includeFrontendRewards ? [refetchFrontendClaimables()] : []),
      refetchQuestionRewardPoolClaimables(),
      refreshActiveWalletReadQueries(queryClient),
    ]);
  }, [
    includeFrontendRewards,
    queryClient,
    refetchClaimed,
    refetchFrontendClaimables,
    refetchQuestionRewardPoolClaimables,
    refetchRbtsRewardState,
    refetchVotes,
  ]);

  return {
    claimableItems: combinedClaimableItems,
    totalClaimable: combinedLrepClaimable,
    totalLrepClaimable: combinedLrepClaimable,
    totalUsdcClaimable: totalQuestionRewardPoolUsdcClaimable,
    activeStake,
    isLoading,
    ponderUnavailable,
    refetch,
  };
}
