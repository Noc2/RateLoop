"use client";

import { useCallback, useMemo } from "react";
import { REWARD_SPLIT_BPS, ROUND_STATE } from "@rateloop/contracts/protocol";
import { useAccount, useReadContracts } from "wagmi";
import {
  type ClaimableRewardItem,
  buildVoterParticipationClaimableRewards,
  calculateLastClaimAwarePoolShare,
  calculateRevealedLoserRebate,
} from "~~/hooks/claimableRewards";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useClaimableFrontendRewards } from "~~/hooks/useClaimableFrontendRewards";
import { useClaimableQuestionRewards } from "~~/hooks/useClaimableQuestionRewards";
import { useRecentUserVotes } from "~~/hooks/useRecentUserVotes";
import type { PonderVoteItem } from "~~/services/ponder/client";

const RBTS_REWARD_STATE_FIELDS = 8;

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

function isRbtsRewardRound(vote: PonderVoteItem) {
  return vote.roundRbtsRewardWeight !== null && vote.roundRbtsRewardWeight !== undefined;
}

function rbtsRewardWeight(vote: PonderVoteItem) {
  return safeBigInt(vote.rbtsRewardWeight);
}

function rbtsForfeitedStake(vote: PonderVoteItem) {
  return safeBigInt(vote.rbtsForfeitedStake);
}

function participationStake(vote: PonderVoteItem) {
  return rbtsRewardWeight(vote);
}

/**
 * Hook that identifies all claimable rewards across all rounds and content.
 * Uses Ponder API to find the user's recent votes, then checks on-chain state.
 */
export function useAllClaimableRewards() {
  const { address } = useAccount();
  const { votes, refetch: refetchVotes } = useRecentUserVotes(address);
  const {
    claimableItems: frontendClaimableItems,
    isLoading: frontendClaimableLoading,
    refetch: refetchFrontendClaimables,
  } = useClaimableFrontendRewards();
  const {
    claimableItems: questionRewardPoolClaimableItems,
    isLoading: questionRewardPoolClaimableLoading,
    refetch: refetchQuestionRewardPoolClaimables,
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
  const { data: distributorInfo } = useDeployedContractInfo({ contractName: "RoundRewardDistributor" });
  const { data: engineInfo } = useDeployedContractInfo({ contractName: "RoundVotingEngine" as any });

  const claimedContracts = useMemo(() => {
    if (!distributorInfo || !engineInfo || !address || terminalVotes.length === 0) return [];
    return terminalVotes.map(v => ({
      address: v.roundState === ROUND_STATE.Settled ? distributorInfo.address : engineInfo.address,
      abi: v.roundState === ROUND_STATE.Settled ? distributorInfo.abi : engineInfo.abi,
      functionName:
        v.roundState === ROUND_STATE.Settled ? ("rewardClaimed" as const) : ("cancelledRoundRefundClaimed" as const),
      args: [BigInt(v.contentId), BigInt(v.roundId), address],
    }));
  }, [distributorInfo, engineInfo, address, terminalVotes]);

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
    if (!claimedResults || claimedResults.length !== terminalVotes.length) return [];
    return terminalVotes.filter((_, i) => {
      const r = claimedResults[i];
      return r?.status === "success" && r.result === false;
    });
  }, [terminalVotes, claimedResults]);

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
  const settledParticipationTerminalVotes = useMemo(
    () =>
      terminalVotes.filter(
        v => v.roundState === ROUND_STATE.Settled && v.revealed && isRbtsRewardRound(v) && rbtsRewardWeight(v) > 0n,
      ),
    [terminalVotes],
  );

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
          address: engineInfo.address,
          abi: engineInfo.abi,
          functionName: "roundVoterPool" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundVoterRewardClaimedCount" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundVoterRewardClaimedAmount" as const,
          args: [contentId, roundId],
        },
        {
          address: engineInfo.address,
          abi: engineInfo.abi,
          functionName: "roundRbtsRewardClaimants" as const,
          args: [contentId, roundId],
        },
        {
          address: engineInfo.address,
          abi: engineInfo.abi,
          functionName: "roundRbtsForfeitedPool" as const,
          args: [contentId, roundId],
        },
        {
          address: engineInfo.address,
          abi: engineInfo.abi,
          functionName: "roundRbtsForfeitClaimants" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundLoserRebateClaimedCount" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundLoserRebateClaimedAmount" as const,
          args: [contentId, roundId],
        },
      ]);
  }, [distributorInfo, engineInfo, settledRbtsVotes]);

  const { data: rbtsRewardStateResults, isLoading: rbtsRewardsLoading } = useReadContracts({
    contracts: rbtsRewardStateContracts,
    query: { enabled: rbtsRewardStateContracts.length > 0 },
  });

  const participationRewardContracts = useMemo(() => {
    if (!distributorInfo || !address || settledParticipationTerminalVotes.length === 0) return [];
    return settledParticipationTerminalVotes.flatMap(v => {
      const contentId = BigInt(v.contentId);
      const roundId = BigInt(v.roundId);

      return [
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "participationRewardClaimed" as const,
          args: [contentId, roundId, address],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "participationRewardPaid" as const,
          args: [contentId, roundId, address],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundParticipationRewardRateBps" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundParticipationRewardOwed" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundParticipationRewardReserved" as const,
          args: [contentId, roundId],
        },
        {
          address: distributorInfo.address,
          abi: distributorInfo.abi,
          functionName: "roundParticipationRewardPool" as const,
          args: [contentId, roundId],
        },
      ];
    });
  }, [address, distributorInfo, settledParticipationTerminalVotes]);

  const {
    data: participationRewardResults,
    isLoading: participationRewardsLoading,
    refetch: refetchParticipationRewards,
  } = useReadContracts({
    contracts: participationRewardContracts,
    query: { enabled: participationRewardContracts.length > 0 },
  });

  // --- Step 6: Build claimable items with calculated rewards ---
  const { claimableItems, activeStake } = useMemo(() => {
    const items: ClaimableRewardItem[] = [];

    // Add cancelled / tied / reveal-failed refunds.
    for (const v of refundVotes) {
      const stake = safeBigInt(v.stake);
      items.push({
        contentId: safeBigInt(v.contentId),
        roundId: safeBigInt(v.roundId),
        reward: stake,
        claimType: "refund",
      });
    }

    // Add RBTS-scored rewards. Positive score returns stake and earns pool share; forfeited stake gets a rebate.
    if (
      rbtsRewardStateResults &&
      rbtsRewardStateResults.length === settledRbtsVotes.length * RBTS_REWARD_STATE_FIELDS
    ) {
      for (let i = 0; i < settledRbtsVotes.length; i++) {
        const v = settledRbtsVotes[i];
        const stateIndex = i * RBTS_REWARD_STATE_FIELDS;
        const scoreWeight = rbtsRewardWeight(v);
        const stakeReturned = safeBigInt(v.rbtsStakeReturned);
        const forfeitedStake = rbtsForfeitedStake(v);
        const totalScoreWeight = safeBigInt(v.roundRbtsRewardWeight);
        const voterPool = safeBigIntResult(rbtsRewardStateResults, stateIndex) ?? 0n;
        const voterRewardClaimedCount = safeBigIntResult(rbtsRewardStateResults, stateIndex + 1) ?? 0n;
        const voterRewardClaimedAmount = safeBigIntResult(rbtsRewardStateResults, stateIndex + 2) ?? 0n;
        const totalRewardClaimants =
          safeBigIntResult(rbtsRewardStateResults, stateIndex + 3) ?? safeBigInt(v.roundRbtsRewardClaimants);
        const forfeitedPool =
          safeBigIntResult(rbtsRewardStateResults, stateIndex + 4) ?? safeBigInt(v.roundRbtsForfeitedPool);
        const totalForfeitClaimants =
          safeBigIntResult(rbtsRewardStateResults, stateIndex + 5) ?? safeBigInt(v.roundRbtsForfeitClaimants);
        const loserRebateClaimedCount = safeBigIntResult(rbtsRewardStateResults, stateIndex + 6) ?? 0n;
        const loserRebateClaimedAmount = safeBigIntResult(rbtsRewardStateResults, stateIndex + 7) ?? 0n;
        let reward = stakeReturned;

        reward += calculateRevealedLoserRebate({
          forfeitedStake,
          forfeitedPool,
          refundBps: BigInt(REWARD_SPLIT_BPS.revealedLoserRefund),
          totalClaimants: totalForfeitClaimants,
          claimedCount: loserRebateClaimedCount,
          claimedAmount: loserRebateClaimedAmount,
        });

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
            contentId: safeBigInt(v.contentId),
            roundId: safeBigInt(v.roundId),
            reward,
            claimType: "reward",
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
  }, [refundVotes, settledRbtsVotes, rbtsRewardStateResults, votes]);

  const participationClaimableItems = useMemo<ClaimableRewardItem[]>(() => {
    if (
      !participationRewardResults ||
      participationRewardResults.length !== settledParticipationTerminalVotes.length * 6
    ) {
      return [];
    }

    const candidates = settledParticipationTerminalVotes.map((vote, index) => {
      const claimed = participationRewardResults[index * 6];
      const paid = participationRewardResults[index * 6 + 1];
      const rate = participationRewardResults[index * 6 + 2];
      const owed = participationRewardResults[index * 6 + 3];
      const reserved = participationRewardResults[index * 6 + 4];
      const pool = participationRewardResults[index * 6 + 5];
      const rewardPool =
        pool?.status === "success" && typeof pool.result === "string" && !/^0x0{40}$/i.test(pool.result)
          ? (pool.result.toLowerCase() as `0x${string}`)
          : null;

      return {
        contentId: safeBigInt(vote.contentId),
        roundId: safeBigInt(vote.roundId),
        stake: participationStake(vote),
        alreadyClaimed: claimed?.status === "success" && claimed.result === true,
        alreadyPaid: paid?.status === "success" ? safeBigInt(paid.result) : 0n,
        rateBps: rate?.status === "success" ? safeBigInt(rate.result) : 0n,
        totalReward: owed?.status === "success" ? safeBigInt(owed.result) : 0n,
        reservedReward: reserved?.status === "success" ? safeBigInt(reserved.result) : 0n,
        rewardPool,
      };
    });

    return buildVoterParticipationClaimableRewards(candidates);
  }, [participationRewardResults, settledParticipationTerminalVotes]);

  const combinedClaimableItems = useMemo(
    () => [
      ...claimableItems,
      ...participationClaimableItems,
      ...frontendClaimableItems,
      ...questionRewardPoolClaimableItems,
    ],
    [claimableItems, participationClaimableItems, frontendClaimableItems, questionRewardPoolClaimableItems],
  );

  const combinedHrepClaimable = useMemo(
    () =>
      [
        ...claimableItems,
        ...participationClaimableItems,
        ...frontendClaimableItems,
        ...questionRewardPoolClaimableItems.filter(
          item =>
            (item.claimType === "question_reward" || item.claimType === "question_bundle_reward") &&
            item.asset === "LREP",
        ),
      ].reduce((sum, item) => sum + item.reward, 0n),
    [claimableItems, participationClaimableItems, frontendClaimableItems, questionRewardPoolClaimableItems],
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
    claimedLoading ||
    rbtsRewardsLoading ||
    participationRewardsLoading ||
    frontendClaimableLoading ||
    questionRewardPoolClaimableLoading;

  const refetch = useCallback(() => {
    refetchVotes();
    refetchClaimed();
    refetchParticipationRewards();
    refetchFrontendClaimables();
    refetchQuestionRewardPoolClaimables();
  }, [
    refetchVotes,
    refetchClaimed,
    refetchParticipationRewards,
    refetchFrontendClaimables,
    refetchQuestionRewardPoolClaimables,
  ]);

  return {
    claimableItems: combinedClaimableItems,
    totalClaimable: combinedHrepClaimable,
    totalHrepClaimable: combinedHrepClaimable,
    totalUsdcClaimable: totalQuestionRewardPoolUsdcClaimable,
    activeStake,
    isLoading,
    refetch,
  };
}
