"use client";

import { useCallback, useRef, useState } from "react";
import {
  LoopReputationAbi,
  type VoteTlockRuntime,
  getVoteTlockChainInfo,
  packVoteRoundContext,
} from "@rateloop/contracts";
import { AdvisoryVoteRecorderAbi, ContentRegistryAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { buildCommitVoteParams, buildStakeAmountWei } from "@rateloop/sdk/vote";
import { useQueryClient } from "@tanstack/react-query";
import { type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useOptimisticVote } from "~~/contexts/OptimisticVoteContext";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useDeployedContractInfo, useTransactor } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
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
import { PREPARING_ROUND_VOTE_MESSAGE, ensureOpenStakedRoundRuntime } from "~~/lib/vote/openStakedRoundRuntime";
import { normalizeRoundVoteError } from "~~/lib/vote/roundVoteErrors";
import { resolveRoundVoteRuntime } from "~~/lib/vote/roundVoteRuntime";
import { type RoundVoteContractCall, buildRoundVoteTransactionPlan } from "~~/lib/vote/roundVoteTransactionPlan";
import scaffoldConfig from "~~/scaffold.config";
import { getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";

type RoundVoteCommitRuntime = Awaited<ReturnType<typeof resolveRoundVoteRuntime>> & {
  client?: VoteTlockRuntime["client"];
  encryptFn?: VoteTlockRuntime["encryptFn"];
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

function chunkString(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

function encodeAsciiBase64(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }

  throw new Error("Base64 encoder unavailable");
}

function buildLocalE2EArmoredTlockCiphertext(targetRound: bigint | number, drandChainHash: string): string {
  const normalizedHash = drandChainHash.replace(/^0x/u, "").toLowerCase();
  const stanzaBody = chunkString("A".repeat(108), 64).join("\n");
  const mac = "A".repeat(43);
  const encryptedBody = "x".repeat(65);
  const payload = [
    "age-encryption.org/v1",
    `-> tlock ${targetRound.toString()} ${normalizedHash}`,
    stanzaBody,
    `--- ${mac}`,
    encryptedBody,
  ].join("\n");
  const encodedPayload = chunkString(encodeAsciiBase64(payload), 64).join("\n");
  return `-----BEGIN AGE ENCRYPTED FILE-----\n${encodedPayload}\n-----END AGE ENCRYPTED FILE-----`;
}

function withLocalE2ETlockRuntime(runtime: RoundVoteCommitRuntime): RoundVoteCommitRuntime {
  const drandChainHash = runtime.drandChainHash?.toLowerCase();
  const genesisTimeSeconds = Number(runtime.drandGenesisTimeSeconds);
  const periodSeconds = Number(runtime.drandPeriodSeconds);

  if (!drandChainHash || !Number.isFinite(genesisTimeSeconds) || !Number.isFinite(periodSeconds)) {
    return runtime;
  }

  return {
    ...runtime,
    client: {
      chain: () => ({
        info: async () => ({
          genesis_time: genesisTimeSeconds,
          hash: drandChainHash.replace(/^0x/u, ""),
          period: periodSeconds,
        }),
      }),
    } as VoteTlockRuntime["client"],
    encryptFn: async (targetRound: bigint | number) => buildLocalE2EArmoredTlockCiphertext(targetRound, drandChainHash),
  };
}

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
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(address, targetNetwork.id);
  const writeTx = useTransactor(localE2ETestWalletClient);
  const wagmiTokenWrite = useWriteContract();
  const useDirectLocalE2EWrites = Boolean(localE2ETestWalletClient);
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
            requiresOpenRound: false,
            roundId: availability.roundId,
            roundReferenceRatingBps: availability.roundReferenceRatingBps,
            roundStartTimeSeconds: null,
            targetRound: availability.minTargetRound,
            drandChainHash: availability.drandChainHash,
            drandGenesisTimeSeconds: availability.drandGenesisTime,
            drandPeriodSeconds: availability.drandPeriod,
          };
          if (localE2ETestWalletClient) {
            runtime = withLocalE2ETlockRuntime(runtime);
          }
          await getVoteTlockChainInfo(runtime);
          if (process.env.NODE_ENV !== "production") {
            console.debug("[round-vote] advisory availability", {
              drandChainHash: availability.drandChainHash,
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
          const message =
            availabilityError instanceof Error ? availabilityError.message : "Preparing vote. Try again in a moment.";
          setError(normalizeRoundVoteError(message));
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
          if (localE2ETestWalletClient) {
            runtime = withLocalE2ETlockRuntime(runtime);
          }
          await getVoteTlockChainInfo(runtime);
        } catch (runtimeError) {
          console.warn("[round-vote] failed to anchor tlock target to the active round.", {
            contentId: contentId.toString(),
            error: runtimeError,
          });
          const message =
            runtimeError instanceof Error ? runtimeError.message : "Preparing vote. Try again in a moment.";
          setError(normalizeRoundVoteError(message));
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
        return writeTx(
          () =>
            localE2ETestWalletClient
              ? localE2ETestWalletClient.writeContract(request)
              : wagmiTokenWrite.writeContractAsync(request),
          {
            action,
            suppressSuccessToast: true,
          },
        );
      };

      const resolveFreshStakedRuntime = () =>
        resolveRoundVoteRuntime({
          publicClient,
          votingEngineAddress,
          contentId,
          fallbackEpochDuration: roundConfig?.epochDuration ?? DEFAULT_VOTING_CONFIG.epochDuration,
        }).then(async resolvedRuntime => {
          const preparedRuntime = localE2ETestWalletClient
            ? withLocalE2ETlockRuntime(resolvedRuntime)
            : resolvedRuntime;
          await getVoteTlockChainInfo(preparedRuntime);
          return preparedRuntime;
        });

      const submitOpenRound = async () => {
        const openRoundCall: RoundVoteContractCall = {
          abi: RoundVotingEngineAbi as any,
          address: votingEngineAddress,
          args: [contentId] as const,
          functionName: "openRound",
          kind: "openRound",
        };
        if (!useDirectLocalE2EWrites && canUseSponsoredBatchCalls) {
          await executeContractCallBatch([openRoundCall], {
            action: "open round",
            atomicRequired: true,
            sponsorshipMode: "sponsored",
          });
          return;
        }
        if (!useDirectLocalE2EWrites && canUseSelfFundedBatchCalls) {
          await executeContractCallBatch([openRoundCall], {
            action: "open round",
            atomicRequired: true,
            sponsorshipMode: "self-funded",
          });
          return;
        }
        const transactionHash = await writePlannedCall(openRoundCall, "open round");
        if (!transactionHash) {
          throw new Error("Preparing vote. Try again in a moment.");
        }
      };

      const ensureOpenStakedRuntime = () =>
        ensureOpenStakedRoundRuntime({
          buildOpenedRuntimeFallback: openedRuntime =>
            openedRuntime.roundId > 0n &&
            openedRuntime.roundStartTimeSeconds != null &&
            BigInt(openedRuntime.roundStartTimeSeconds) > 0n
              ? {
                  ...openedRuntime,
                  requiresOpenRound: false,
                }
              : null,
          openRound: submitOpenRound,
          resolveRuntime: resolveFreshStakedRuntime,
        });

      const buildFreshRoundVotePlan = async (allowanceForPlan: bigint) => {
        const freshRuntime = isRequestedAdvisoryVote ? runtime : await ensureOpenStakedRuntime();
        if (!freshRuntime) {
          throw new Error(PREPARING_ROUND_VOTE_MESSAGE);
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

      if (!useDirectLocalE2EWrites && canUseSponsoredBatchCalls) {
        const freshVote = await buildFreshRoundVotePlan(currentAllowance);
        await executeContractCallBatch(freshVote.plan.calls, {
          action: "vote",
          atomicRequired: true,
          sponsorshipMode: "sponsored",
        });
        submittedVote = freshVote;
      } else if (!useDirectLocalE2EWrites && canUseSelfFundedBatchCalls) {
        const freshVote = await buildFreshRoundVotePlan(currentAllowance);
        await executeContractCallBatch(freshVote.plan.calls, {
          action: "vote",
          atomicRequired: true,
          sponsorshipMode: "self-funded",
        });
        submittedVote = freshVote;
      } else {
        const needsApproval = !isZeroStakeVote && currentAllowance < requestedStakeWei;

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
