"use client";

import { useCallback, useMemo } from "react";
import { EPOCH_WEIGHT_BPS, REWARD_SPLIT_BPS, ROUND_STATE } from "@ratemesh/contracts/protocol";
import { useAccount, useReadContracts } from "wagmi";
import { type ClaimableRewardItem, buildVoterParticipationClaimableRewards } from "~~/hooks/claimableRewards";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { useClaimableFrontendRewards } from "~~/hooks/useClaimableFrontendRewards";
import { useClaimableQuestionRewards } from "~~/hooks/useClaimableQuestionRewards";
import { useRecentUserVotes } from "~~/hooks/useRecentUserVotes";
import type { PonderVoteItem } from "~~/services/ponder/client";

const BPS_SCALE = 10000n;

function safeBigInt(val: unknown): bigint {
  try {
    return BigInt(val as string | number | bigint);
  } catch {
    return 0n;
  }
}

function epochWeightBps(epochIndex: number): number {
  return epochIndex === 0 ? EPOCH_WEIGHT_BPS.blind : EPOCH_WEIGHT_BPS.informed;
}

function isPredictionRewardRound(vote: PonderVoteItem) {
  return Number(vote.roundFinalPredictionRatingBps ?? 0) > 0;
}

function isBinaryWinningVote(vote: PonderVoteItem) {
  return vote.isUp !== null && vote.roundUpWins !== null && vote.isUp === vote.roundUpWins;
}

function predictionRewardWeight(vote: PonderVoteItem) {
  return safeBigInt(vote.predictionRewardWeight);
}

function predictionForfeitedStake(vote: PonderVoteItem) {
  return safeBigInt(vote.predictionForfeitedStake);
}

function participationStake(vote: PonderVoteItem) {
  if (isPredictionRewardRound(vote)) return predictionRewardWeight(vote);
  const stake = safeBigInt(vote.stake);
  return (stake * BigInt(epochWeightBps(vote.epochIndex))) / BPS_SCALE;
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

  const settledPredictionVotes = useMemo(
    () => rewardVotes.filter(v => isPredictionRewardRound(v)),
    [rewardVotes],
  );
  const settledBinaryWinners = useMemo(
    () => rewardVotes.filter(v => !isPredictionRewardRound(v) && isBinaryWinningVote(v)),
    [rewardVotes],
  );
  const settledBinaryLosers = useMemo(
    () =>
      rewardVotes.filter(
        v => !isPredictionRewardRound(v) && v.isUp !== null && v.roundUpWins !== null && v.isUp !== v.roundUpWins,
      ),
    [rewardVotes],
  );
  const settledParticipationTerminalVotes = useMemo(
    () =>
      terminalVotes.filter(
        v =>
          v.roundState === ROUND_STATE.Settled &&
          v.revealed &&
          (isPredictionRewardRound(v) ? predictionRewardWeight(v) > 0n : isBinaryWinningVote(v)),
      ),
    [terminalVotes],
  );

  // --- Step 5: Multicall roundVoterPool + roundWinningStake for winners ---
  const binaryRewardContracts = useMemo(() => {
    if (!engineInfo || settledBinaryWinners.length === 0) return [];
    return settledBinaryWinners.flatMap(v => [
      {
        address: engineInfo.address,
        abi: engineInfo.abi,
        functionName: "roundVoterPool" as const,
        args: [BigInt(v.contentId), BigInt(v.roundId)],
      },
      {
        address: engineInfo.address,
        abi: engineInfo.abi,
        functionName: "roundWinningStake" as const,
        args: [BigInt(v.contentId), BigInt(v.roundId)],
      },
    ]);
  }, [engineInfo, settledBinaryWinners]);

  const { data: binaryRewardResults, isLoading: binaryRewardsLoading } = useReadContracts({
    contracts: binaryRewardContracts,
    query: { enabled: binaryRewardContracts.length > 0 },
  });

  const predictionPoolContracts = useMemo(() => {
    if (!engineInfo || settledPredictionVotes.length === 0) return [];
    return settledPredictionVotes.map(v => ({
      address: engineInfo.address,
      abi: engineInfo.abi,
      functionName: "roundVoterPool" as const,
      args: [BigInt(v.contentId), BigInt(v.roundId)],
    }));
  }, [engineInfo, settledPredictionVotes]);

  const { data: predictionPoolResults, isLoading: predictionRewardsLoading } = useReadContracts({
    contracts: predictionPoolContracts,
    query: { enabled: predictionPoolContracts.length > 0 },
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

    // Add binary settled winners (stake + weighted share of the winner pool).
    if (binaryRewardResults && binaryRewardResults.length === settledBinaryWinners.length * 2) {
      for (let i = 0; i < settledBinaryWinners.length; i++) {
        const v = settledBinaryWinners[i];
        const stake = safeBigInt(v.stake);
        const poolResult = binaryRewardResults[i * 2];
        const winStakeResult = binaryRewardResults[i * 2 + 1];

        let reward = stake; // at minimum, get stake back
        if (poolResult?.status === "success" && winStakeResult?.status === "success") {
          const pool = safeBigInt(poolResult.result);
          const weighted = safeBigInt(winStakeResult.result);
          if (weighted > 0n) {
            const w = BigInt(epochWeightBps(v.epochIndex));
            const effectiveStake = (stake * w) / 10000n;
            const poolShare = (effectiveStake * pool) / weighted;
            reward += poolShare;
          }
        }

        items.push({
          contentId: safeBigInt(v.contentId),
          roundId: safeBigInt(v.roundId),
          reward,
          claimType: "reward",
        });
      }
    }

    // Add prediction-scored rewards. Positive score returns stake and earns pool share; forfeited stake gets a rebate.
    if (predictionPoolResults && predictionPoolResults.length === settledPredictionVotes.length) {
      for (let i = 0; i < settledPredictionVotes.length; i++) {
        const v = settledPredictionVotes[i];
        const scoreWeight = predictionRewardWeight(v);
        const stakeReturned = safeBigInt(v.predictionStakeReturned);
        const forfeitedStake = predictionForfeitedStake(v);
        const totalScoreWeight = safeBigInt(v.roundPredictionRewardWeight);
        const poolResult = predictionPoolResults[i];
        let reward = stakeReturned;

        if (forfeitedStake > 0n) {
          reward += (forfeitedStake * BigInt(REWARD_SPLIT_BPS.revealedLoserRefund)) / BPS_SCALE;
        }

        if (scoreWeight > 0n && poolResult?.status === "success" && totalScoreWeight > 0n) {
          reward += (scoreWeight * safeBigInt(poolResult.result)) / totalScoreWeight;
        }

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

    // Add binary settled losers (fixed 5% rebate for revealed losing votes).
    for (const v of settledBinaryLosers) {
      const stake = safeBigInt(v.stake);
      const reward = (stake * BigInt(REWARD_SPLIT_BPS.revealedLoserRefund)) / BPS_SCALE;
      items.push({
        contentId: safeBigInt(v.contentId),
        roundId: safeBigInt(v.roundId),
        reward,
        claimType: "reward",
      });
    }

    // Active stake = sum of stakes in open rounds
    let active = 0n;
    for (const v of votes) {
      if (v.roundState === ROUND_STATE.Open) {
        active += safeBigInt(v.stake);
      }
    }

    return { claimableItems: items, activeStake: active };
  }, [
    refundVotes,
    settledBinaryWinners,
    settledPredictionVotes,
    settledBinaryLosers,
    binaryRewardResults,
    predictionPoolResults,
    votes,
  ]);

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
            item.asset === "HREP",
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
    binaryRewardsLoading ||
    predictionRewardsLoading ||
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
