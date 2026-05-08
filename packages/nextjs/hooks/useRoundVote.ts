"use client";

import { useCallback, useRef, useState } from "react";
import { MeshReputationAbi, packVoteRoundContext } from "@ratemesh/contracts";
import { ContentRegistryAbi, RoundVotingEngineAbi } from "@ratemesh/contracts/abis";
import { buildCommitPredictionParams, buildCommitVoteParams } from "@ratemesh/sdk/vote";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useOptimisticVote } from "~~/contexts/OptimisticVoteContext";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useDeployedContractInfo, useTransactor } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { FREE_TRANSACTION_ALLOWANCE_QUERY_KEY } from "~~/hooks/useFreeTransactionAllowance";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { getRecentUserVotesQueryKey } from "~~/hooks/useRecentUserVotes";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { getVoteHistoryQueryKey } from "~~/hooks/useVoteHistoryQuery";
import { useVoterIdNFT } from "~~/hooks/useVoterIdNFT";
import { getVotingStakesQueryKey } from "~~/hooks/useVotingStakes";
import {
  type WalletDisplaySummary,
  getWalletDisplaySummaryQueryKey,
  persistWalletDisplaySummarySnapshot,
} from "~~/hooks/useWalletDisplaySummary";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { DEFAULT_VOTING_CONFIG, type VotingConfig } from "~~/lib/contracts/roundVotingEngine";
import { getGasBalanceErrorMessage, isFreeTransactionExhaustedError } from "~~/lib/transactionErrors";
import { recordLocalVoteCooldown } from "~~/lib/vote/localCooldown";
import { normalizeRoundVoteError } from "~~/lib/vote/roundVoteErrors";
import { resolveRoundVoteRuntime } from "~~/lib/vote/roundVoteRuntime";
import scaffoldConfig from "~~/scaffold.config";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";

interface RoundVoteParams {
  contentId: bigint;
  isUp?: boolean;
  predictedRating?: number;
  stakeAmount: number; // In whole tokens (e.g., 5 = 5 MREP)
  frontendCode?: `0x${string}`; // Optional frontend operator address for fee distribution
  isOwnContent?: boolean;
  roundConfig?: VotingConfig | null;
  submitter?: string; // Content submitter address (for self-vote prevention)
}

/**
 * Hook for tlock commit-reveal rating commits using reputation approval + commit.
 * Handles: optional allowance approval followed by a vote commit.
 *
 * Predicted final ratings are tlock-encrypted to the current epoch's drand round,
 * keeping the rating private until reveal. The binary isUp path remains as a
 * legacy bridge until the new prediction engine is fully deployed.
 */
export function useRoundVote() {
  const { address } = useAccount();
  const { addOptimisticVote } = useOptimisticVote();
  const { targetNetwork } = useTargetNetwork();
  const { hasVoterId, tokenId } = useVoterIdNFT(address);
  const [isCommitting, setIsCommitting] = useState(false);
  const commitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { requireAcceptance } = useTermsAcceptance();
  const queryClient = useQueryClient();
  const writeTx = useTransactor();
  const wagmiTokenWrite = useWriteContract();
  const {
    canUseSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });

  const { data: votingEngineInfo, isLoading: isVotingEngineLoading } = useDeployedContractInfo({
    contractName: "RoundVotingEngine",
  } as any);
  const { data: contentRegistryInfo, isLoading: isContentRegistryLoading } = useDeployedContractInfo({
    contractName: "ContentRegistry",
  } as any);
  const { data: hrepInfo, isLoading: isHrepLoading } = useDeployedContractInfo({
    contractName: REPUTATION_CONTRACT_NAME,
  });
  const publicClient = usePublicClient();
  const clearError = useCallback(() => setError(null), []);

  const commitVote = async ({
    contentId,
    isUp,
    predictedRating,
    stakeAmount,
    frontendCode,
    isOwnContent,
    roundConfig,
    submitter,
  }: RoundVoteParams) => {
    const accepted = await requireAcceptance("vote");
    if (!accepted) return false;

    if (!address) {
      setError("Please connect your wallet");
      return false;
    }

    if (isOwnContent || (submitter && address && submitter.toLowerCase() === address.toLowerCase())) {
      setError(normalizeRoundVoteError("SelfVote"));
      return false;
    }

    if (isVotingEngineLoading || isContentRegistryLoading || isHrepLoading) {
      setError("Preparing vote. Try again in a moment.");
      return false;
    }

    if (!votingEngineInfo?.address || !contentRegistryInfo?.address || !hrepInfo?.address) {
      setError("Voting is unavailable right now.");
      return false;
    }

    if (isAwaitingSponsoredSubmitCalls) {
      setError("Preparing wallet. Try again in a moment.");
      return false;
    }

    if (isAwaitingSelfFundedSubmitCalls) {
      setError("Wallet switching to paid gas. Retry in a moment.");
      return false;
    }

    if (isMissingGasBalance) {
      setError(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      return false;
    }

    if (predictedRating === undefined && isUp === undefined) {
      setError("Choose a predicted final rating before submitting.");
      return false;
    }

    // Synchronous guard against double-submission (React state updates are async)
    if (commitLock.current) return false;
    commitLock.current = true;
    setIsCommitting(true);
    setError(null);

    try {
      if (publicClient) {
        try {
          const isContentActive = await publicClient.readContract({
            address: contentRegistryInfo.address as `0x${string}`,
            abi: ContentRegistryAbi,
            functionName: "isContentActive",
            args: [contentId],
          });

          if (!isContentActive) {
            setError(normalizeRoundVoteError("ContentNotActive"));
            return false;
          }
        } catch (activeCheckError) {
          console.warn("[round-vote] failed to check content activity before commit.", {
            contentId: contentId.toString(),
            error: activeCheckError,
          });
        }
      }

      let runtime;
      if (publicClient) {
        try {
          runtime = await resolveRoundVoteRuntime({
            publicClient,
            votingEngineAddress: votingEngineInfo.address as `0x${string}`,
            contentId,
            fallbackEpochDuration: roundConfig?.epochDuration ?? DEFAULT_VOTING_CONFIG.epochDuration,
          });
        } catch (runtimeError) {
          console.warn("[round-vote] failed to anchor tlock target to the active round.", {
            contentId: contentId.toString(),
            error: runtimeError,
          });
          setError("Preparing vote. Try again in a moment.");
          return false;
        }
      }

      if (!runtime || !publicClient) {
        setError("Preparing vote. Try again in a moment.");
        return false;
      }

      const commitParams =
        predictedRating !== undefined
          ? await buildCommitPredictionParams({
              voter: address as `0x${string}`,
              contentId,
              predictedRating,
              stakeAmount,
              epochDuration: runtime.epochDuration,
              roundId: runtime.roundId,
              roundReferenceRatingBps: runtime.roundReferenceRatingBps,
              frontendCode,
              defaultFrontendCode: scaffoldConfig.frontendCode,
              runtime,
            })
          : await buildCommitVoteParams({
              voter: address as `0x${string}`,
              contentId,
              isUp: isUp ?? true,
              stakeAmount,
              epochDuration: runtime.epochDuration,
              roundId: runtime.roundId,
              roundReferenceRatingBps: runtime.roundReferenceRatingBps,
              frontendCode,
              defaultFrontendCode: scaffoldConfig.frontendCode,
              runtime,
            });
      const { ciphertext, commitHash, roundReferenceRatingBps, targetRound, drandChainHash, frontend, stakeWei } =
        commitParams;

      const roundContext = packVoteRoundContext(runtime.roundId, roundReferenceRatingBps);
      const commitVoteArgs = [
        contentId,
        roundContext,
        targetRound,
        drandChainHash,
        commitHash,
        ciphertext,
        stakeWei,
        frontend,
      ] as const;
      const approveRequest: any = {
        abi: MeshReputationAbi,
        address: hrepInfo.address,
        functionName: "approve",
        args: [votingEngineInfo.address, stakeWei] as const,
      };
      const commitVoteRequest: any = {
        abi: RoundVotingEngineAbi,
        address: votingEngineInfo.address,
        functionName: "commitVote",
        args: commitVoteArgs,
      };
      const currentAllowance = (await publicClient.readContract({
        address: hrepInfo.address as `0x${string}`,
        abi: MeshReputationAbi,
        functionName: "allowance",
        args: [address as `0x${string}`, votingEngineInfo.address as `0x${string}`],
      })) as bigint;
      const needsApproval = currentAllowance < stakeWei;

      if (canUseSponsoredSubmitCalls) {
        await executeSponsoredCalls(
          [
            ...(needsApproval
              ? [
                  {
                    abi: MeshReputationAbi,
                    address: hrepInfo.address as `0x${string}`,
                    args: [votingEngineInfo.address, stakeWei] as const,
                    functionName: "approve",
                  },
                ]
              : []),
            {
              abi: RoundVotingEngineAbi,
              address: votingEngineInfo.address as `0x${string}`,
              args: commitVoteArgs,
              functionName: "commitVote",
            },
          ],
          { action: "vote", atomicRequired: true },
        );
      }

      if (!canUseSponsoredSubmitCalls) {
        if (needsApproval) {
          wagmiTokenWrite.reset();
          const approvalHash = await writeTx(() => wagmiTokenWrite.writeContractAsync(approveRequest), {
            action: "approve",
            suppressSuccessToast: true,
          });
          if (!approvalHash) {
            return false;
          }
        }

        // Direct writes are self-funded here; only the sponsored helper can
        // safely confirm free-transaction reservations with the backend.
        const estimatedGas = await publicClient.estimateContractGas({
          address: votingEngineInfo.address,
          abi: RoundVotingEngineAbi,
          functionName: "commitVote",
          args: commitVoteArgs,
          account: address,
        });
        commitVoteRequest.gas = (estimatedGas * 120n) / 100n;

        wagmiTokenWrite.reset();
        const transactionHash = await writeTx(() => wagmiTokenWrite.writeContractAsync(commitVoteRequest), {
          action: "vote",
          suppressSuccessToast: true,
        });
        if (!transactionHash) {
          return false;
        }
      }

      addOptimisticVote(contentId, stakeWei, {
        baseTotalStake: runtime.baseTotalStake,
        baseVoteCount: runtime.baseVoteCount,
        roundId: runtime.roundId,
      });
      recordLocalVoteCooldown({
        address,
        chainId: targetNetwork.id,
        contentId,
        voterIdTokenId: tokenId,
      });
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });

      queryClient.setQueryData<WalletDisplaySummary | undefined>(
        getWalletDisplaySummaryQueryKey(address.toLowerCase()),
        current => {
          if (!current || current.liquidMicro < stakeWei) return current;
          const nextSnapshot: WalletDisplaySummary = {
            ...current,
            liquidMicro: current.liquidMicro - stakeWei,
            votingStakedMicro: current.votingStakedMicro + stakeWei,
            totalStakedMicro: current.totalStakedMicro + stakeWei,
            totalMicro: current.totalMicro,
            updatedAt: Date.now(),
          };
          persistWalletDisplaySummarySnapshot(address.toLowerCase(), nextSnapshot);
          return nextSnapshot;
        },
      );

      queryClient.setQueryData<{
        data: { activeStaked: number; activeCount: number; totalVotingStake: number };
        source: string;
      }>(getVotingStakesQueryKey(address, targetNetwork.id), old => {
        if (!old?.data) return old;
        const added = Number(stakeWei) / 1e6;
        return {
          ...old,
          data: {
            activeStaked: old.data.activeStaked + added,
            activeCount: old.data.activeCount + 1,
            totalVotingStake: old.data.totalVotingStake + added,
          },
        };
      });
      queryClient.invalidateQueries({ queryKey: getVotingStakesQueryKey(address, targetNetwork.id) });
      queryClient.invalidateQueries({ queryKey: getRecentUserVotesQueryKey(address, targetNetwork.id) });
      queryClient.invalidateQueries({ queryKey: getVoteHistoryQueryKey(address, targetNetwork.id) });

      return true;
    } catch (e: any) {
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      console.error("Round vote commit failed:", e);
      if (isFreeTransactionExhaustedError(e)) {
        setError("Free transactions used up. Add CELO to continue.");
        return false;
      }
      const parsedError = getParsedErrorWithAllAbis(e, targetNetwork.id as any);
      setError(normalizeRoundVoteError(parsedError || e?.shortMessage || e?.message || "Failed to submit vote"));
      return false;
    } finally {
      commitLock.current = false;
      setIsCommitting(false);
    }
  };

  return {
    commitVote,
    isCommitting,
    error,
    clearError,
    hasVoterId,
    tokenId,
  };
}
