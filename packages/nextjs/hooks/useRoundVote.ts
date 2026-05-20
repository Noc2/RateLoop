"use client";

import { useCallback, useRef, useState } from "react";
import { LoopReputationAbi, packVoteRoundContext } from "@rateloop/contracts";
import { AdvisoryVoteRecorderAbi, ContentRegistryAbi } from "@rateloop/contracts/abis";
import { buildCommitVoteParams, buildStakeAmountWei } from "@rateloop/sdk/vote";
import { useQueryClient } from "@tanstack/react-query";
import { type Address, parseSignature } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { useOptimisticVote } from "~~/contexts/OptimisticVoteContext";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useDeployedContractInfo, useTransactor } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { FREE_TRANSACTION_ALLOWANCE_QUERY_KEY } from "~~/hooks/useFreeTransactionAllowance";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRaterRegistryIdentity } from "~~/hooks/useRaterRegistryIdentity";
import { getRecentUserVotesQueryKey } from "~~/hooks/useRecentUserVotes";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { getVoteHistoryQueryKey } from "~~/hooks/useVoteHistoryQuery";
import { getVotingStakesQueryKey } from "~~/hooks/useVotingStakes";
import {
  type WalletDisplaySummary,
  getWalletDisplaySummaryQueryKey,
  persistWalletDisplaySummarySnapshot,
} from "~~/hooks/useWalletDisplaySummary";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { DEFAULT_VOTING_CONFIG, type VotingConfig } from "~~/lib/contracts/roundVotingEngine";
import { getGasBalanceErrorMessage, isFreeTransactionExhaustedError } from "~~/lib/transactionErrors";
import {
  getAdvisoryVoteUnavailableMessage,
  parseAdvisoryCommitAvailability,
} from "~~/lib/vote/advisoryVoteAvailability";
import { recordLocalVoteCooldown } from "~~/lib/vote/localCooldown";
import { normalizeRoundVoteError } from "~~/lib/vote/roundVoteErrors";
import { resolveRoundVoteRuntime } from "~~/lib/vote/roundVoteRuntime";
import {
  type RoundVoteContractCall,
  buildCommitVoteWithPermitCall,
  buildRoundVoteTransactionPlan,
} from "~~/lib/vote/roundVoteTransactionPlan";
import scaffoldConfig from "~~/scaffold.config";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";
import { isSignatureRejected } from "~~/utils/signatureErrors";

type RoundVoteCommitRuntime = Awaited<ReturnType<typeof resolveRoundVoteRuntime>> & {
  targetRound?: bigint | number;
};

interface RoundVoteParams {
  contentId: bigint;
  isUp: boolean;
  predictedUpPercent: number;
  stakeAmount: number; // In display tokens (e.g., 2.5 = 2.5 LREP)
  frontendCode?: `0x${string}`; // Optional frontend operator address for fee distribution
  isOwnContent?: boolean;
  roundConfig?: VotingConfig | null;
  submitter?: string; // Content submitter address (for self-vote prevention)
}

const COUNTED_VOTE_MIN_STAKE_WEI = 1_000_000n;

/**
 * Hook for tlock commit-reveal RBTS vote commits using reputation approval + commit.
 * Handles: optional allowance approval followed by a vote commit.
 *
 * Binary signals and predicted up-share are tlock-encrypted to the current epoch's drand round.
 */
export function useRoundVote() {
  const { address, chain } = useAccount();
  const { addOptimisticVote } = useOptimisticVote();
  const { targetNetwork } = useTargetNetwork();
  const { hasActiveHumanCredential, identityKey } = useRaterRegistryIdentity(address);
  const [isCommitting, setIsCommitting] = useState(false);
  const commitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { requireAcceptance } = useTermsAcceptance();
  const queryClient = useQueryClient();
  const writeTx = useTransactor();
  const wagmiTokenWrite = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });

  const { data: votingEngineInfo, isLoading: isVotingEngineLoading } = useDeployedContractInfo({
    contractName: "RoundVotingEngine",
  } as any);
  const { data: advisoryVoteRecorderInfo, isLoading: isAdvisoryVoteRecorderLoading } = useDeployedContractInfo({
    contractName: "AdvisoryVoteRecorder",
  } as any);
  const { data: contentRegistryInfo, isLoading: isContentRegistryLoading } = useDeployedContractInfo({
    contractName: "ContentRegistry",
  } as any);
  const { data: lrepInfo, isLoading: isLrepLoading } = useDeployedContractInfo({
    contractName: REPUTATION_CONTRACT_NAME,
  });
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const clearError = useCallback(() => setError(null), []);

  const commitVote = async ({
    contentId,
    isUp,
    predictedUpPercent,
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

    if (!chain?.id) {
      setError("Please connect your wallet");
      return false;
    }

    if (chain.id !== targetNetwork.id) {
      setError(`Wallet is connected to the wrong network. Please switch to ${targetNetwork.name}.`);
      return false;
    }

    if (isOwnContent || (submitter && address && submitter.toLowerCase() === address.toLowerCase())) {
      setError(normalizeRoundVoteError("SelfVote"));
      return false;
    }

    if (isVotingEngineLoading || isContentRegistryLoading || isLrepLoading) {
      setError("Preparing vote. Try again in a moment.");
      return false;
    }

    if (!votingEngineInfo?.address || !contentRegistryInfo?.address || !lrepInfo?.address) {
      setError("Voting is unavailable right now.");
      return false;
    }

    if (isAwaitingSponsoredBatchCalls) {
      setError("Preparing wallet. Try again in a moment.");
      return false;
    }

    if (isAwaitingSelfFundedBatchCalls) {
      setError("Wallet switching to paid gas. Retry in a moment.");
      return false;
    }

    if (isMissingGasBalance) {
      setError(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      return false;
    }

    if (isUp === undefined || predictedUpPercent === undefined) {
      setError("Choose your vote and expected up-share before submitting.");
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

      let runtime: RoundVoteCommitRuntime | undefined;
      const isRequestedAdvisoryVote = stakeAmount <= 0;
      const advisoryVoteRecorderAddress = advisoryVoteRecorderInfo?.address as `0x${string}` | undefined;
      if (isRequestedAdvisoryVote) {
        if (isAdvisoryVoteRecorderLoading) {
          setError("Preparing vote. Try again in a moment.");
          return false;
        }
        if (!advisoryVoteRecorderAddress) {
          setError("Zero-LREP advisory voting is unavailable right now.");
          return false;
        }
        if (!publicClient) {
          setError("Preparing vote. Try again in a moment.");
          return false;
        }

        try {
          const rawAvailability = await publicClient.readContract({
            address: advisoryVoteRecorderAddress,
            abi: AdvisoryVoteRecorderAbi,
            functionName: "advisoryCommitAvailability",
            args: [contentId],
          });
          const availability = parseAdvisoryCommitAvailability(rawAvailability);
          if (!availability.canCommit) {
            setError(getAdvisoryVoteUnavailableMessage(availability) ?? "Zero-LREP voting is unavailable right now.");
            return false;
          }
          runtime = {
            baseTotalStake: 0n,
            baseVoteCount: 0n,
            epochDuration: roundConfig?.epochDuration ?? DEFAULT_VOTING_CONFIG.epochDuration,
            now: () => Number(availability.epochEnd) * 1000,
            roundId: availability.roundId,
            roundReferenceRatingBps: availability.roundReferenceRatingBps,
            roundStartTimeSeconds: null,
            targetRound: availability.minTargetRound,
          };
          if (process.env.NODE_ENV !== "production") {
            console.debug("[round-vote] advisory availability", {
              contentId: contentId.toString(),
              epochEnd: availability.epochEnd.toString(),
              maxTargetRound: availability.maxTargetRound.toString(),
              minTargetRound: availability.minTargetRound.toString(),
              roundId: availability.roundId.toString(),
            });
          }
        } catch (availabilityError) {
          console.warn("[round-vote] failed to check advisory vote availability before commit.", {
            contentId: contentId.toString(),
            error: availabilityError,
          });
          setError("Preparing vote. Try again in a moment.");
          return false;
        }
      } else if (publicClient) {
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

      const requestedStakeWei = buildStakeAmountWei(stakeAmount);
      if (stakeAmount > 0 && requestedStakeWei < COUNTED_VOTE_MIN_STAKE_WEI) {
        setError("Stake at least 1 LREP or choose 0 for advisory voting.");
        return false;
      }
      const isZeroStakeVote = requestedStakeWei === 0n;
      if (isZeroStakeVote && isAdvisoryVoteRecorderLoading) {
        setError("Preparing vote. Try again in a moment.");
        return false;
      }
      const lrepAddress = lrepInfo.address as `0x${string}`;
      const votingEngineAddress = votingEngineInfo.address as `0x${string}`;
      const readCurrentAllowance = async () =>
        isZeroStakeVote
          ? 0n
          : ((await publicClient.readContract({
              address: lrepAddress,
              abi: LoopReputationAbi,
              functionName: "allowance",
              args: [address as Address, votingEngineAddress],
            })) as bigint);
      let currentAllowance = await readCurrentAllowance();
      const buildFreshRoundVotePlan = async (allowanceForPlan: bigint) => {
        let freshRuntime = runtime;
        if (!isRequestedAdvisoryVote) {
          freshRuntime = await resolveRoundVoteRuntime({
            publicClient,
            votingEngineAddress,
            contentId,
            fallbackEpochDuration: roundConfig?.epochDuration ?? DEFAULT_VOTING_CONFIG.epochDuration,
          });
        }
        if (!freshRuntime) {
          throw new Error("Preparing vote. Try again in a moment.");
        }

        const commitParams = await buildCommitVoteParams({
          voter: address as `0x${string}`,
          contentId,
          isUp,
          predictedUpPercent,
          stakeAmount,
          epochDuration: freshRuntime.epochDuration,
          roundId: freshRuntime.roundId,
          roundReferenceRatingBps: freshRuntime.roundReferenceRatingBps,
          frontendCode,
          defaultFrontendCode: scaffoldConfig.frontendCode,
          runtime: freshRuntime,
        });
        const { ciphertext, commitHash, roundReferenceRatingBps, targetRound, drandChainHash, frontend, stakeWei } =
          commitParams;
        const roundContext = packVoteRoundContext(freshRuntime.roundId, roundReferenceRatingBps);
        const plan = buildRoundVoteTransactionPlan({
          advisoryVoteRecorderAddress,
          ciphertext,
          commitHash,
          contentId,
          currentAllowance: allowanceForPlan,
          drandChainHash,
          frontend,
          lrepAddress,
          roundContext,
          stakeWei,
          targetRound,
          votingEngineAddress,
        });
        return { plan, runtime: freshRuntime, stakeWei };
      };
      let submittedVote: Awaited<ReturnType<typeof buildFreshRoundVotePlan>> | null = null;

      const writePlannedCall = async (call: RoundVoteContractCall, action: string) => {
        const request: any = {
          abi: call.abi,
          address: call.address,
          args: call.args,
          chainId: targetNetwork.id,
          functionName: call.functionName,
          ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
        };
        const estimatedGas = await publicClient.estimateContractGas({
          account: address as Address,
          address: call.address,
          abi: call.abi,
          args: call.args as never,
          functionName: call.functionName as never,
          ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
        } as any);
        request.gas = (estimatedGas * 120n) / 100n;

        wagmiTokenWrite.reset();
        return writeTx(() => wagmiTokenWrite.writeContractAsync(request), {
          action,
          suppressSuccessToast: true,
        });
      };

      if (canUseSponsoredBatchCalls) {
        const freshVote = await buildFreshRoundVotePlan(currentAllowance);
        await executeContractCallBatch(freshVote.plan.calls, {
          action: "vote",
          atomicRequired: true,
          sponsorshipMode: "sponsored",
        });
        submittedVote = freshVote;
      } else if (canUseSelfFundedBatchCalls) {
        const freshVote = await buildFreshRoundVotePlan(currentAllowance);
        await executeContractCallBatch(freshVote.plan.calls, {
          action: "vote",
          atomicRequired: true,
          sponsorshipMode: "self-funded",
        });
        submittedVote = freshVote;
      } else {
        let submittedWithPermit = false;
        const needsApproval = !isZeroStakeVote && currentAllowance < requestedStakeWei;

        if (needsApproval) {
          let permitCall: RoundVoteContractCall | null = null;
          let permitVote: Awaited<ReturnType<typeof buildFreshRoundVotePlan>> | null = null;

          try {
            const nonce = (await publicClient.readContract({
              address: lrepAddress,
              abi: LoopReputationAbi,
              functionName: "nonces",
              args: [address as Address],
            })) as bigint;
            let permitTokenName = "Loop Reputation";
            try {
              permitTokenName = (await publicClient.readContract({
                address: lrepAddress,
                abi: LoopReputationAbi,
                functionName: "name",
              })) as string;
            } catch (permitTokenNameError) {
              console.warn("[round-vote] token name unavailable; using Loop Reputation permit domain.", {
                error: permitTokenNameError,
              });
            }
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
            const signature = await signTypedDataAsync({
              domain: {
                chainId: targetNetwork.id,
                name: permitTokenName,
                verifyingContract: lrepAddress,
                version: "1",
              },
              message: {
                deadline,
                nonce,
                owner: address as Address,
                spender: votingEngineAddress,
                value: requestedStakeWei,
              },
              primaryType: "Permit",
              types: {
                Permit: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "nonce", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                ],
              },
            });
            const parsedSignature = parseSignature(signature);
            permitVote = await buildFreshRoundVotePlan(requestedStakeWei);
            permitCall = buildCommitVoteWithPermitCall(permitVote.plan, {
              deadline,
              r: parsedSignature.r,
              s: parsedSignature.s,
              v: Number(parsedSignature.v ?? BigInt((parsedSignature.yParity ?? 0) + 27)),
              votingEngineAddress,
            });
          } catch (permitSignatureError) {
            if (isSignatureRejected(permitSignatureError)) {
              setError("Signature cancelled. Submit again to continue.");
              return false;
            }

            console.warn("[round-vote] permit signing unavailable; falling back to approval then commit.", {
              error: permitSignatureError,
            });
          }

          if (permitCall) {
            const transactionHash = await writePlannedCall(permitCall, "vote");
            if (!transactionHash) {
              return false;
            }
            submittedWithPermit = true;
            submittedVote = permitVote;
          }
        }

        if (!submittedWithPermit) {
          if (needsApproval) {
            const approvalPlan = await buildFreshRoundVotePlan(0n);
            const approvalCall = approvalPlan.plan.calls.find(call => call.kind === "approve");
            if (!approvalCall) {
              throw new Error("Preparing approval. Try again in a moment.");
            }
            const transactionHash = await writePlannedCall(approvalCall, "approve");
            if (!transactionHash) {
              return false;
            }
            currentAllowance = requestedStakeWei;
          }

          const freshVote = await buildFreshRoundVotePlan(currentAllowance);
          for (const call of freshVote.plan.calls) {
            const transactionHash = await writePlannedCall(call, call.kind === "approve" ? "approve" : "vote");
            if (!transactionHash) {
              return false;
            }
          }
          submittedVote = freshVote;
        }
      }

      if (!submittedVote) {
        throw new Error("Vote submission did not complete.");
      }

      const { plan: submittedPlan, runtime: submittedRuntime, stakeWei: submittedStakeWei } = submittedVote;

      if (!submittedPlan.isAdvisoryVote) {
        addOptimisticVote(contentId, submittedStakeWei, {
          baseTotalStake: submittedRuntime.baseTotalStake,
          baseVoteCount: submittedRuntime.baseVoteCount,
          roundId: submittedRuntime.roundId,
        });
      }
      recordLocalVoteCooldown({
        address,
        chainId: targetNetwork.id,
        contentId,
        identityKey,
        votingEngineAddress,
      });
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });

      if (!submittedPlan.isAdvisoryVote) {
        queryClient.setQueryData<WalletDisplaySummary | undefined>(
          getWalletDisplaySummaryQueryKey(address.toLowerCase(), targetNetwork.id),
          current => {
            if (!current || current.liquidMicro < submittedStakeWei) return current;
            const nextSnapshot: WalletDisplaySummary = {
              ...current,
              liquidMicro: current.liquidMicro - submittedStakeWei,
              votingStakedMicro: current.votingStakedMicro + submittedStakeWei,
              totalStakedMicro: current.totalStakedMicro + submittedStakeWei,
              totalMicro: current.totalMicro,
              updatedAt: Date.now(),
            };
            persistWalletDisplaySummarySnapshot(address.toLowerCase(), targetNetwork.id, nextSnapshot);
            return nextSnapshot;
          },
        );

        queryClient.setQueryData<{
          data: { activeStaked: number; activeCount: number; totalVotingStake: number };
          source: string;
        }>(getVotingStakesQueryKey(address, targetNetwork.id), old => {
          if (!old?.data) return old;
          const added = Number(submittedStakeWei) / 1e6;
          return {
            ...old,
            data: {
              activeStaked: old.data.activeStaked + added,
              activeCount: old.data.activeCount + 1,
              totalVotingStake: old.data.totalVotingStake + added,
            },
          };
        });
      }
      queryClient.invalidateQueries({ queryKey: getVotingStakesQueryKey(address, targetNetwork.id) });
      queryClient.invalidateQueries({ queryKey: getRecentUserVotesQueryKey(address, targetNetwork.id) });
      queryClient.invalidateQueries({ queryKey: getVoteHistoryQueryKey(address, targetNetwork.id) });

      return true;
    } catch (e: any) {
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      console.error("Round vote commit failed:", e);
      if (isFreeTransactionExhaustedError(e)) {
        setError("Free transactions used up. Add ETH to continue.");
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
    hasActiveHumanCredential,
    identityKey,
  };
}
