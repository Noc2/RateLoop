"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AdvisoryVoteRecorderAbi,
  ContentRegistryAbi,
  LoopReputationAbi,
  RoundVotingEngineAbi,
} from "@rateloop/contracts/abis";
import { type VoteTlockRuntime, getVoteTlockChainInfo } from "@rateloop/contracts/voting";
import { packVoteRoundContext } from "@rateloop/contracts/votingCore";
import { buildCommitVoteParams, buildStakeAmountWei } from "@rateloop/sdk/vote";
import { useQueryClient } from "@tanstack/react-query";
import { type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useOptimisticVote } from "~~/contexts/OptimisticVoteContext";
import { useTermsAcceptance } from "~~/contexts/TermsAcceptanceContext";
import { useDeployedContractInfo, useTransactor } from "~~/hooks/scaffold-eth";
import { useLocalE2ETestWalletClient } from "~~/hooks/scaffold-eth/useLocalE2ETestWalletClient";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { CONFIDENTIALITY_ESCROW_ABI, getConfiguredConfidentialityEscrowAddress } from "~~/hooks/useConfidentialityBond";
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
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { fetchConfidentialityTermsStatus } from "~~/lib/confidentiality/clientTermsStatus";
import { REPUTATION_CONTRACT_NAME } from "~~/lib/contracts/reputation";
import { DEFAULT_VOTING_CONFIG, type VotingConfig } from "~~/lib/contracts/roundVotingEngine";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";
import {
  getGasBalanceErrorMessage,
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
} from "~~/lib/transactionErrors";
import { raceTransactionWithPostcondition } from "~~/lib/transactions/postcondition";
import {
  getAdvisoryVoteUnavailableMessage,
  parseAdvisoryCommitAvailability,
} from "~~/lib/vote/advisoryVoteAvailability";
import {
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "~~/lib/vote/confidentialContext";
import { recordLocalVoteCooldown } from "~~/lib/vote/localCooldown";
import { readEffectiveOnChainVoteCooldownRemainingSeconds } from "~~/lib/vote/onChainVoteCooldown";
import {
  PREPARING_ROUND_VOTE_MESSAGE,
  ensureOpenStakedRoundRuntime,
  predictPostOpenRoundRuntime,
  preflightRoundVoteBatchCalls,
} from "~~/lib/vote/openStakedRoundRuntime";
import { normalizeRoundVoteError } from "~~/lib/vote/roundVoteErrors";
import {
  waitForRoundOpenPostcondition,
  waitForRoundVoteCommitPostcondition,
} from "~~/lib/vote/roundVotePostconditions";
import { resolveRoundVoteRuntime } from "~~/lib/vote/roundVoteRuntime";
import {
  type RoundVoteContractCall,
  type RoundVotePermitSignature,
  buildRoundVoteTransactionPlan,
} from "~~/lib/vote/roundVoteTransactionPlan";
import { buildLrepPermitTypedData, getDefaultSignatureDeadline, getSignatureParts } from "~~/lib/walletSignatures";
import { isWalletTransactionReadinessMessage } from "~~/lib/walletTransactionReadiness";
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
  contextAccess?: "public" | "gated" | string;
  contextVisibility?: "public" | "gated" | string;
  confidentiality?: {
    bondAmount?: string;
    bondAsset?: "LREP" | "USDC" | string;
    visibility?: "public" | "gated" | string;
  } | null;
}

const COUNTED_VOTE_MIN_STAKE_WEI = 1_000_000n;

function getRoundVotePostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

function isRoundVoteCommitCallKind(kind: RoundVoteContractCall["kind"]) {
  return kind === "commitVote" || kind === "commitVoteWithPermit" || kind === "recordAdvisoryVote";
}

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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function createRoundVoteTimingLog(params: {
  chainId: number;
  contentId: bigint;
  isGatedContext: boolean;
  stakeAmount: number;
}) {
  const startedAt = nowMs();
  let lastMarkAt = startedAt;
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const basePayload = {
    chainId: params.chainId,
    contentId: params.contentId.toString(),
    isGatedContext: params.isGatedContext,
    runId,
    stakeAmount: params.stakeAmount,
  };

  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    const timestamp = nowMs();
    const elapsedMs = Math.round(timestamp - startedAt);
    const deltaMs = Math.round(timestamp - lastMarkAt);
    lastMarkAt = timestamp;

    console.info("[round-vote-timing]", {
      ...basePayload,
      ...extra,
      deltaMs,
      elapsedMs,
      event,
    });
  };

  emit("start");

  return { emit, runId };
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

async function getConfidentialContextAccessStatus(address: string, contentId: bigint, chainId: number) {
  return fetchConfidentialityTermsStatus(address, contentId, { chainId });
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
  const {
    hasActiveHumanCredential,
    holder,
    identityKey,
    isLoading: isIdentityLoading,
    isResolved: isIdentityResolved,
  } = useRaterRegistryIdentity(address);
  const [isCommitting, setIsCommitting] = useState(false);
  const commitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { requireAcceptance } = useTermsAcceptance();
  const queryClient = useQueryClient();
  const localE2ETestWalletClient = useLocalE2ETestWalletClient(address, targetNetwork.id);
  const writeTx = useTransactor(localE2ETestWalletClient);
  const wagmiTokenWrite = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const useDirectLocalE2EWrites = Boolean(localE2ETestWalletClient);
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
    sponsoredWalletSyncStatus,
  } = useThirdwebSponsoredSubmitCalls();
  const { canSponsorTransactions, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
    syncInAppSponsorship: false,
  });
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredBatchCalls,
    syncInAppSponsorship: false,
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
  const lastWalletReadinessErrorRef = useRef<string | null>(null);
  const clearError = useCallback(() => {
    lastWalletReadinessErrorRef.current = null;
    setError(null);
  }, []);

  useEffect(() => {
    if (
      !walletTransactionReadiness.isReady ||
      !error ||
      error !== lastWalletReadinessErrorRef.current ||
      !isWalletTransactionReadinessMessage(error)
    ) {
      return;
    }

    lastWalletReadinessErrorRef.current = null;
    setError(null);
  }, [error, walletTransactionReadiness.isReady]);

  const commitVote = async ({
    contentId,
    isUp,
    predictedUpPercent,
    stakeAmount,
    frontendCode,
    isOwnContent,
    roundConfig,
    submitter,
    contextAccess,
    contextVisibility,
    confidentiality,
  }: RoundVoteParams) => {
    const isGatedContext = isPrivateContextMetadata({
      confidentiality,
      contextAccess,
      contextVisibility,
    });
    const timingLog = createRoundVoteTimingLog({
      chainId: targetNetwork.id,
      contentId,
      isGatedContext,
      stakeAmount,
    });
    setError(null);
    const accepted = await requireAcceptance("vote");
    if (!accepted) {
      timingLog.emit("terms-rejected");
      return false;
    }
    timingLog.emit("terms-accepted");

    if (walletTransactionReadiness.isBlocked) {
      const message = walletTransactionReadiness.message ?? "Wallet is unavailable.";
      lastWalletReadinessErrorRef.current = isWalletTransactionReadinessMessage(message) ? message : null;
      timingLog.emit("blocked", {
        reason: walletTransactionReadiness.status,
        message,
        sponsoredWalletSyncStatus,
      });
      setError(message);
      return false;
    }

    if (!address) {
      timingLog.emit("blocked", { reason: "missing_address" });
      setError("Please connect your wallet");
      return false;
    }

    if (!chain?.id) {
      timingLog.emit("blocked", { reason: "missing_chain" });
      setError("Please connect your wallet");
      return false;
    }

    if (chain.id !== targetNetwork.id) {
      timingLog.emit("blocked", { reason: "wrong_network", walletChainId: chain.id });
      setError(`Wallet is connected to the wrong network. Please switch to ${targetNetwork.name}.`);
      return false;
    }

    if (isOwnContent || (submitter && address && submitter.toLowerCase() === address.toLowerCase())) {
      timingLog.emit("blocked", { reason: "self_vote" });
      setError(normalizeRoundVoteError("SelfVote"));
      return false;
    }

    if (isGatedContext) {
      const bondRequirement = getConfidentialityBondRequirement(confidentiality);
      let hasAcceptedTerms = false;
      let hasReadSession = false;
      try {
        const accessStatus = await getConfidentialContextAccessStatus(address, contentId, targetNetwork.id);
        hasAcceptedTerms = accessStatus.accepted;
        hasReadSession = accessStatus.hasSession;
        timingLog.emit("confidentiality-terms-checked", { hasAcceptedTerms, hasReadSession });
      } catch (termsError) {
        console.warn("[round-vote] failed to check confidentiality terms before commit.", {
          contentId: contentId.toString(),
          error: termsError,
        });
        timingLog.emit("blocked", { reason: "confidentiality_terms_check_failed" });
        setError("Could not verify confidentiality terms acceptance. Try unlocking the private context again.");
        return false;
      }
      let hasActiveBond = !bondRequirement.isRequired;
      const escrowAddress = getConfiguredConfidentialityEscrowAddress(targetNetwork.id);

      if (bondRequirement.isRequired && !publicClient) {
        timingLog.emit("blocked", { reason: "missing_public_client_for_bond" });
        setError("Checking confidentiality bond status. Try again in a moment.");
        return false;
      }

      if (bondRequirement.isRequired && escrowAddress && publicClient && identityKey) {
        try {
          hasActiveBond = (await publicClient.readContract({
            address: escrowAddress,
            abi: CONFIDENTIALITY_ESCROW_ABI,
            functionName: "hasActiveBond",
            args: [contentId, identityKey],
          })) as boolean;
          timingLog.emit("confidentiality-bond-checked", { hasActiveBond });
        } catch (bondError) {
          console.warn("[round-vote] failed to check confidentiality bond before commit.", {
            contentId: contentId.toString(),
            error: bondError,
          });
          timingLog.emit("blocked", { reason: "confidentiality_bond_check_failed" });
          setError(`Could not verify the required ${bondRequirement.label} confidentiality bond. Try again.`);
          return false;
        }
      }

      const privateContextBlocker = getConfidentialContextVoteBlocker({
        bondRequirement,
        escrowConfigured: Boolean(escrowAddress),
        hasAcceptedTerms,
        hasReadSession,
        hasActiveBond,
        hasActiveHumanCredential: hasActiveHumanCredential && Boolean(identityKey),
        identityResolved: isIdentityResolved && !isIdentityLoading,
        isGated: true,
      });
      if (privateContextBlocker) {
        timingLog.emit("blocked", { reason: "private_context_blocker" });
        setError(privateContextBlocker);
        return false;
      }
    }

    if (isVotingEngineLoading || isContentRegistryLoading || isLrepLoading) {
      timingLog.emit("blocked", { reason: "contracts_loading" });
      setError("Preparing vote. Try again in a moment.");
      return false;
    }

    if (!votingEngineInfo?.address || !contentRegistryInfo?.address || !lrepInfo?.address) {
      timingLog.emit("blocked", { reason: "missing_contract_info" });
      setError("Voting is unavailable right now.");
      return false;
    }

    if (isUp === undefined || predictedUpPercent === undefined) {
      timingLog.emit("blocked", { reason: "missing_vote_inputs" });
      setError("Choose your vote and expected up-share before submitting.");
      return false;
    }

    // Synchronous guard against double-submission (React state updates are async)
    if (commitLock.current) {
      timingLog.emit("blocked", { reason: "commit_lock" });
      return false;
    }
    commitLock.current = true;
    setIsCommitting(true);
    setError(null);
    timingLog.emit("commit-lock-acquired");

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
            timingLog.emit("blocked", { reason: "content_not_active" });
            setError(normalizeRoundVoteError("ContentNotActive"));
            return false;
          }
          timingLog.emit("content-active-checked");
        } catch (activeCheckError) {
          console.warn("[round-vote] failed to check content activity before commit.", {
            contentId: contentId.toString(),
            error: activeCheckError,
          });
          timingLog.emit("content-active-check-failed-nonfatal");
        }
      }

      if (publicClient) {
        const cooldownRemaining = await readEffectiveOnChainVoteCooldownRemainingSeconds({
          advisoryVoteRecorderAddress: advisoryVoteRecorderInfo?.address as Address | undefined,
          contentId,
          identityHolder: holder,
          identityKey: identityKey as Hex | undefined,
          includeAdvisoryCooldown: stakeAmount <= 0,
          nowSeconds: Math.floor(Date.now() / 1000),
          publicClient,
          voter: address,
          votingEngineAddress: votingEngineInfo.address as Address,
        });
        if (cooldownRemaining > 0) {
          timingLog.emit("blocked", { reason: "cooldown_active", cooldownRemaining });
          setError(normalizeRoundVoteError("CooldownActive"));
          return false;
        }
        timingLog.emit("cooldown-checked", { cooldownRemaining });
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
            account: address as Address,
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
          timingLog.emit("advisory-runtime-prepared", {
            roundId: availability.roundId.toString(),
            targetRound: availability.minTargetRound.toString(),
          });
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
          timingLog.emit("blocked", { reason: "advisory_runtime_failed", message });
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
          timingLog.emit("staked-runtime-prepared", {
            requiresOpenRound: runtime.requiresOpenRound,
            roundId: runtime.roundId.toString(),
            targetRound: runtime.targetRound?.toString() ?? null,
          });
        } catch (runtimeError) {
          console.warn("[round-vote] failed to anchor tlock target to the active round.", {
            contentId: contentId.toString(),
            error: runtimeError,
          });
          const message =
            runtimeError instanceof Error ? runtimeError.message : "Preparing vote. Try again in a moment.";
          timingLog.emit("blocked", { reason: "staked_runtime_failed", message });
          setError(normalizeRoundVoteError(message));
          return false;
        }
      }

      if (!runtime || !publicClient) {
        timingLog.emit("blocked", { reason: "missing_runtime_or_public_client" });
        setError("Preparing vote. Try again in a moment.");
        return false;
      }

      const requestedStakeWei = buildStakeAmountWei(stakeAmount);
      if (stakeAmount > 0 && requestedStakeWei < COUNTED_VOTE_MIN_STAKE_WEI) {
        timingLog.emit("blocked", { reason: "stake_too_low" });
        setError("Stake at least 1 LREP or choose 0 for advisory voting.");
        return false;
      }
      const isZeroStakeVote = requestedStakeWei === 0n;
      if (isZeroStakeVote && isAdvisoryVoteRecorderLoading) {
        timingLog.emit("blocked", { reason: "advisory_recorder_loading" });
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
      timingLog.emit("allowance-read", {
        currentAllowance: currentAllowance.toString(),
        requestedStakeWei: requestedStakeWei.toString(),
      });
      const signPermitForVote = async (stakeWei: bigint): Promise<RoundVotePermitSignature | undefined> => {
        if (useDirectLocalE2EWrites || stakeWei === 0n) return undefined;
        try {
          const nonce = (await publicClient.readContract({
            address: lrepAddress,
            abi: LoopReputationAbi,
            functionName: "nonces",
            args: [address as Address],
          })) as bigint;
          const deadline = getDefaultSignatureDeadline();
          const signature = await signTypedDataAsync(
            buildLrepPermitTypedData({
              chainId: targetNetwork.id,
              deadline,
              nonce,
              owner: address as Address,
              spender: votingEngineAddress,
              tokenAddress: lrepAddress,
              value: stakeWei,
            }),
          );
          const parts = getSignatureParts(signature);
          timingLog.emit("permit-signed");
          return { deadline, ...parts };
        } catch (permitError) {
          console.warn("LREP permit signing unavailable; falling back to approve + vote.", permitError);
          timingLog.emit("permit-signing-failed");
          return undefined;
        }
      };
      const writePlannedCall = async (call: RoundVoteContractCall, action: string) => {
        if (call.data) {
          const estimatedGas = await publicClient.estimateGas({
            account: address as Address,
            data: call.data,
            to: call.address,
            ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
          });
          const request = {
            account: address as Address,
            data: call.data,
            gas: (estimatedGas * 120n) / 100n,
            to: call.address,
            ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
          };

          wagmiTokenWrite.reset();
          return writeTx(request as any, {
            action,
            parentRunId: timingLog.runId,
            suppressSuccessToast: true,
          });
        }

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
            parentRunId: timingLog.runId,
            suppressSuccessToast: true,
          },
        );
      };
      const submitDirectOpenRound = async (call: RoundVoteContractCall) => {
        const { confirmation } = await raceTransactionWithPostcondition({
          onPostconditionSuccessThenTransactionError: directError => {
            console.warn("[round-vote] open round postcondition succeeded before direct wallet status settled.", {
              contentId: contentId.toString(),
              error: directError,
            });
          },
          transaction: () => writePlannedCall(call, "open round"),
          waitForPostcondition: shouldStop =>
            waitForRoundOpenPostcondition(
              {
                client: publicClient,
                contentId,
                votingEngineAddress,
              },
              {
                onEvent: timingLog.emit,
                pollingIntervalMs: getRoundVotePostconditionPollingInterval(targetNetwork.id),
                shouldStop,
              },
            ),
        });
        timingLog.emit("open-round-submit-complete", { confirmation, transport: "direct-wallet" });
      };
      const submitDirectPlannedCall = async (
        call: RoundVoteContractCall,
        action: string,
        vote?: Awaited<ReturnType<typeof buildFreshRoundVotePlan>>,
      ) => {
        timingLog.emit("direct-call-submit-start", { callKind: call.kind });
        if (vote && isRoundVoteCommitCallKind(call.kind)) {
          const commitHash = vote.plan.commitVoteArgs[4] as Hex;
          const { confirmation } = await raceTransactionWithPostcondition({
            onPostconditionSuccessThenTransactionError: directError => {
              console.warn("[round-vote] vote postcondition succeeded before direct wallet status settled.", {
                contentId: contentId.toString(),
                error: directError,
              });
            },
            transaction: () => writePlannedCall(call, action),
            waitForPostcondition: shouldStop =>
              waitForRoundVoteCommitPostcondition(
                {
                  advisoryVoteRecorderAddress,
                  client: publicClient,
                  commitHash,
                  contentId,
                  isAdvisoryVote: vote.plan.isAdvisoryVote,
                  roundId: vote.runtime.roundId,
                  voter: address as Address,
                  votingEngineAddress,
                },
                {
                  onEvent: timingLog.emit,
                  pollingIntervalMs: getRoundVotePostconditionPollingInterval(targetNetwork.id),
                  shouldStop,
                },
              ),
          });
          timingLog.emit("direct-call-submit-complete", { callKind: call.kind, confirmation });
          return true;
        }

        const transactionHash = await writePlannedCall(call, action);
        if (!transactionHash) {
          return false;
        }
        timingLog.emit("direct-call-submit-complete", { callKind: call.kind, transactionHash });
        return true;
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
        timingLog.emit("open-round-submit-start");
        if (!useDirectLocalE2EWrites && canUseSponsoredBatchCalls) {
          const { confirmation } = await raceTransactionWithPostcondition({
            onPostconditionSuccessThenTransactionError: batchError => {
              console.warn("[round-vote] open round postcondition succeeded before thirdweb status settled.", {
                contentId: contentId.toString(),
                error: batchError,
              });
            },
            transaction: () =>
              executeContractCallBatch([openRoundCall], {
                action: "open round",
                atomicRequired: true,
                parentRunId: timingLog.runId,
                sponsorshipMode: "sponsored",
                suppressStatusToast: true,
              }),
            waitForPostcondition: shouldStop =>
              waitForRoundOpenPostcondition(
                {
                  client: publicClient,
                  contentId,
                  votingEngineAddress,
                },
                {
                  onEvent: timingLog.emit,
                  pollingIntervalMs: getRoundVotePostconditionPollingInterval(targetNetwork.id),
                  shouldStop,
                },
              ),
          });
          timingLog.emit("open-round-submit-complete", { confirmation, transport: "sponsored-batch" });
          return;
        }
        if (!useDirectLocalE2EWrites && canUseSelfFundedBatchCalls) {
          const { confirmation } = await raceTransactionWithPostcondition({
            onPostconditionSuccessThenTransactionError: batchError => {
              console.warn("[round-vote] open round postcondition succeeded before thirdweb status settled.", {
                contentId: contentId.toString(),
                error: batchError,
              });
            },
            transaction: () =>
              executeContractCallBatch([openRoundCall], {
                action: "open round",
                atomicRequired: true,
                parentRunId: timingLog.runId,
                sponsorshipMode: "self-funded",
                suppressStatusToast: true,
              }),
            waitForPostcondition: shouldStop =>
              waitForRoundOpenPostcondition(
                {
                  client: publicClient,
                  contentId,
                  votingEngineAddress,
                },
                {
                  onEvent: timingLog.emit,
                  pollingIntervalMs: getRoundVotePostconditionPollingInterval(targetNetwork.id),
                  shouldStop,
                },
              ),
          });
          timingLog.emit("open-round-submit-complete", { confirmation, transport: "self-funded-batch" });
          return;
        }
        await submitDirectOpenRound(openRoundCall);
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

      const buildFreshRoundVotePlan = async (
        allowanceForPlan: bigint,
        permitSignature?: RoundVotePermitSignature,
        options?: {
          includeOpenRound?: boolean;
          runtimeOverride?: RoundVoteCommitRuntime;
        },
      ) => {
        const freshRuntime =
          options?.runtimeOverride ?? (isRequestedAdvisoryVote ? runtime : await ensureOpenStakedRuntime());
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
        timingLog.emit("commit-artifacts-built", {
          roundId: freshRuntime.roundId.toString(),
          targetRound: targetRound.toString(),
        });
        const roundContext = packVoteRoundContext(freshRuntime.roundId, roundReferenceRatingBps);
        const plan = buildRoundVoteTransactionPlan({
          advisoryVoteRecorderAddress,
          ciphertext,
          commitHash,
          contentId,
          currentAllowance: allowanceForPlan,
          drandChainHash,
          frontend,
          includeOpenRound: options?.includeOpenRound,
          lrepAddress,
          permitSignature,
          roundContext,
          stakeWei,
          targetRound,
          votingEngineAddress,
        });
        timingLog.emit("transaction-plan-built", {
          callKinds: plan.calls.map(call => call.kind).join(","),
          isAdvisoryVote: plan.isAdvisoryVote,
          needsApproval: plan.needsApproval,
        });
        return { plan, runtime: freshRuntime, stakeWei };
      };
      const simulatePlannedCall = async (call: RoundVoteContractCall) => {
        if (call.data) {
          await publicClient.call({
            account: address as Address,
            data: call.data,
            to: call.address,
            ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
          });
          return;
        }

        await publicClient.simulateContract({
          account: address as Address,
          address: call.address,
          abi: call.abi,
          args: call.args as never,
          functionName: call.functionName as never,
          ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
        } as any);
      };
      const buildBatchFreshVotePlan = async () => {
        const permitSignature = isZeroStakeVote ? undefined : await signPermitForVote(requestedStakeWei);
        return buildFreshRoundVotePlan(currentAllowance, permitSignature);
      };
      const buildCombinedOpenRoundVotePlan = async () => {
        const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
        let predictedRuntime = predictPostOpenRoundRuntime({
          latestBlockTimestampSeconds: Number(latestBlock.timestamp),
          runtime,
        });
        if (localE2ETestWalletClient) {
          predictedRuntime = withLocalE2ETlockRuntime(predictedRuntime);
        }
        await getVoteTlockChainInfo(predictedRuntime);
        const permitSignature = isZeroStakeVote ? undefined : await signPermitForVote(requestedStakeWei);
        return buildFreshRoundVotePlan(currentAllowance, permitSignature, {
          includeOpenRound: true,
          runtimeOverride: predictedRuntime,
        });
      };
      const executeSequentialOpenRoundVoteBatch = async (sponsorshipMode: "sponsored" | "self-funded") => {
        const freshVote = await buildBatchFreshVotePlan();
        await preflightAdvisoryBatchPlan(freshVote);
        timingLog.emit("vote-batch-submit-start", { sponsorshipMode });
        const confirmation = await executeVoteBatchWithPostcondition(freshVote, sponsorshipMode);
        timingLog.emit("vote-batch-submit-complete", { confirmation, sponsorshipMode });
        return freshVote;
      };
      const executeBatchVoteWithCombinedOpenRoundFallback = async (sponsorshipMode: "sponsored" | "self-funded") => {
        const needsCombinedOpenRound = !isRequestedAdvisoryVote && runtime.requiresOpenRound;
        if (!needsCombinedOpenRound) {
          return executeSequentialOpenRoundVoteBatch(sponsorshipMode);
        }

        const combinedVote = await buildCombinedOpenRoundVotePlan();
        timingLog.emit("combined-open-vote-preflight-start");
        const preflightResult = await preflightRoundVoteBatchCalls({
          account: address as Address,
          calls: combinedVote.plan.calls,
          publicClient,
          simulatePlannedCall,
        });
        timingLog.emit("combined-open-vote-preflight-complete", {
          ...preflightResult,
          preflightPassed: preflightResult.passed,
        });

        if (preflightResult.passed) {
          timingLog.emit("combined-open-vote-batch-submit-start", { sponsorshipMode });
          const confirmation = await executeVoteBatchWithPostcondition(combinedVote, sponsorshipMode);
          timingLog.emit("combined-open-vote-batch-submit-complete", { confirmation, sponsorshipMode });
          return combinedVote;
        }

        timingLog.emit("combined-open-vote-fallback-sequential", { sponsorshipMode });
        return executeSequentialOpenRoundVoteBatch(sponsorshipMode);
      };
      const preflightAdvisoryBatchPlan = async (vote: Awaited<ReturnType<typeof buildFreshRoundVotePlan>>) => {
        if (!vote.plan.isAdvisoryVote) return;

        timingLog.emit("advisory-batch-preflight-start");
        for (const call of vote.plan.calls) {
          await simulatePlannedCall(call);
        }
        timingLog.emit("advisory-batch-preflight-complete");
      };
      const executeVoteBatchWithPostcondition = async (
        vote: Awaited<ReturnType<typeof buildFreshRoundVotePlan>>,
        sponsorshipMode: "sponsored" | "self-funded",
      ) => {
        const commitHash = vote.plan.commitVoteArgs[4] as Hex;
        const { confirmation } = await raceTransactionWithPostcondition({
          onPostconditionSuccessThenTransactionError: batchError => {
            console.warn("[round-vote] vote postcondition succeeded before thirdweb status settled.", {
              contentId: contentId.toString(),
              error: batchError,
            });
          },
          transaction: () =>
            executeContractCallBatch(vote.plan.calls, {
              action: "vote",
              atomicRequired: true,
              parentRunId: timingLog.runId,
              sponsorshipMode,
              suppressStatusToast: true,
            }),
          waitForPostcondition: shouldStop =>
            waitForRoundVoteCommitPostcondition(
              {
                advisoryVoteRecorderAddress,
                client: publicClient,
                commitHash,
                contentId,
                isAdvisoryVote: vote.plan.isAdvisoryVote,
                roundId: vote.runtime.roundId,
                voter: address as Address,
                votingEngineAddress,
              },
              {
                onEvent: timingLog.emit,
                pollingIntervalMs: getRoundVotePostconditionPollingInterval(targetNetwork.id),
                shouldStop,
              },
            ),
        });
        return confirmation;
      };
      let submittedVote: Awaited<ReturnType<typeof buildFreshRoundVotePlan>> | null = null;

      if (!useDirectLocalE2EWrites && canUseSponsoredBatchCalls) {
        submittedVote = await executeBatchVoteWithCombinedOpenRoundFallback("sponsored");
      } else if (!useDirectLocalE2EWrites && canUseSelfFundedBatchCalls) {
        submittedVote = await executeBatchVoteWithCombinedOpenRoundFallback("self-funded");
      } else {
        const needsApproval = !isZeroStakeVote && currentAllowance < requestedStakeWei;

        if (needsApproval) {
          const permitSignature = await signPermitForVote(requestedStakeWei);
          if (permitSignature) {
            const freshVote = await buildFreshRoundVotePlan(currentAllowance, permitSignature);
            for (const call of freshVote.plan.calls) {
              if (!(await submitDirectPlannedCall(call, "vote", freshVote))) {
                return false;
              }
            }
            submittedVote = freshVote;
          }
        }

        if (needsApproval && !submittedVote) {
          const approvalPlan = await buildFreshRoundVotePlan(0n);
          const approvalCall = approvalPlan.plan.calls.find(call => call.kind === "approve");
          if (!approvalCall) {
            throw new Error("Preparing approval. Try again in a moment.");
          }
          if (!(await submitDirectPlannedCall(approvalCall, "approve"))) {
            return false;
          }
          currentAllowance = requestedStakeWei;
        }

        if (!submittedVote) {
          const freshVote = await buildFreshRoundVotePlan(currentAllowance);
          for (const call of freshVote.plan.calls) {
            if (
              !(await submitDirectPlannedCall(
                call,
                call.kind === "approve" ? "approve" : "vote",
                call.kind === "approve" ? undefined : freshVote,
              ))
            ) {
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
      const deployment = resolveProtocolDeploymentScope(targetNetwork.id);
      const deploymentKey = deployment?.deploymentKey ?? null;

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
        }>(getVotingStakesQueryKey(address, targetNetwork.id, deploymentKey), old => {
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
      queryClient.invalidateQueries({ queryKey: getVotingStakesQueryKey(address, targetNetwork.id, deploymentKey) });
      queryClient.invalidateQueries({ queryKey: getRecentUserVotesQueryKey(address, targetNetwork.id, deploymentKey) });
      queryClient.invalidateQueries({ queryKey: getVoteHistoryQueryKey(address, targetNetwork.id, deploymentKey) });

      timingLog.emit("success", {
        isAdvisoryVote: submittedPlan.isAdvisoryVote,
        roundId: submittedRuntime.roundId.toString(),
      });
      return true;
    } catch (e: any) {
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      console.error("Round vote commit failed:", e);
      timingLog.emit("failure", {
        message: e?.shortMessage || e?.message || "Failed to submit vote",
      });
      if (isFreeTransactionExhaustedError(e)) {
        setError("Free transactions used up. Add ETH to continue.");
        return false;
      }
      if (isInsufficientFundsError(e)) {
        setError(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
        return false;
      }
      const parsedError = getParsedErrorWithAllAbis(e, targetNetwork.id as any);
      const normalizedError = normalizeRoundVoteError(
        parsedError || e?.shortMessage || e?.message || "Failed to submit vote",
      );
      if (normalizedError === normalizeRoundVoteError("CooldownActive")) {
        recordLocalVoteCooldown({
          address,
          chainId: targetNetwork.id,
          contentId,
          identityKey: identityKey ?? undefined,
          votingEngineAddress: votingEngineInfo?.address,
        });
        void queryClient.invalidateQueries({ queryKey: ["voteCooldowns"] });
        void queryClient.invalidateQueries({ queryKey: ["voteCooldownsOnChain"] });
      }
      setError(normalizedError);
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
