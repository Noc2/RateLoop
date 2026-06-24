"use client";

import { useCallback, useState } from "react";
import {
  RATER_TYPE,
  type RaterTypeValue,
  formatRaterTypeName,
  normalizeRaterType,
} from "@rateloop/node-utils/profileSelfReport";
import type { Abi } from "viem";
import { zeroAddress, zeroHash } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import { raceTransactionWithPostcondition, waitForTransactionPostcondition } from "~~/lib/transactions/postcondition";
import scaffoldConfig from "~~/scaffold.config";

interface RaterRegistryProfile {
  raterType: RaterTypeValue;
  raterTypeName: ReturnType<typeof formatRaterTypeName>;
  metadataHash: `0x${string}`;
  updatedAt: bigint;
  hasProfile: boolean;
}

function getRaterRegistryPostconditionPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

/**
 * Reads the RaterRegistry credential status for a wallet.
 */
export function useRaterRegistryIdentity(address?: string) {
  const { data: raterRegistry, isLoading: registryLoading } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });

  const {
    data: hasActiveHumanCredential,
    isLoading: credentialLoading,
    isFetching: credentialFetching,
    isFetched: credentialFetched,
    isError: credentialError,
    refetch: refetchCredential,
  } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "hasActiveHumanCredential",
    args: [address],
    query: {
      enabled: !!address,
    },
  });

  const {
    data: resolvedRater,
    isLoading: resolvedRaterLoading,
    isFetching: resolvedRaterFetching,
    isFetched: resolvedRaterFetched,
    isError: resolvedRaterError,
    refetch: refetchResolvedRater,
  } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "resolveRater",
    args: [address],
    query: {
      enabled: !!address,
    },
  });

  const refetch = useCallback(async () => {
    const [credentialResult, resolvedRaterResult] = await Promise.all([refetchCredential(), refetchResolvedRater()]);
    return {
      hasActiveHumanCredential: credentialResult.data as boolean | undefined,
      resolvedRater: resolvedRaterResult.data,
    };
  }, [refetchCredential, refetchResolvedRater]);

  const hasAddress = Boolean(address);
  const contractUnavailable = hasAddress && !registryLoading && !raterRegistry;
  const credentialPending =
    hasAddress &&
    !contractUnavailable &&
    !credentialError &&
    !credentialFetched &&
    (credentialLoading || credentialFetching);
  const resolvedRaterPending =
    hasAddress &&
    !contractUnavailable &&
    !resolvedRaterError &&
    !resolvedRaterFetched &&
    (resolvedRaterLoading || resolvedRaterFetching);
  const resolved = resolvedRater as
    | {
        holder?: `0x${string}`;
        identityKey?: `0x${string}`;
        humanNullifier?: `0x${string}`;
        hasActiveHumanCredential?: boolean;
        delegated?: boolean;
      }
    | readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean]
    | undefined;
  const resolvedTuple = Array.isArray(resolved)
    ? (resolved as readonly [`0x${string}`, `0x${string}`, `0x${string}`, boolean, boolean])
    : null;
  const resolvedObject = !resolvedTuple
    ? (resolved as
        | {
            holder?: `0x${string}`;
            identityKey?: `0x${string}`;
            humanNullifier?: `0x${string}`;
            hasActiveHumanCredential?: boolean;
            delegated?: boolean;
          }
        | undefined)
    : undefined;
  const holder = resolvedTuple ? resolvedTuple[0] : resolvedObject?.holder;
  const identityKey = resolvedTuple ? resolvedTuple[1] : resolvedObject?.identityKey;
  const humanNullifier = resolvedTuple ? resolvedTuple[2] : resolvedObject?.humanNullifier;
  const resolvedHasActiveHumanCredential = resolvedTuple ? resolvedTuple[3] : resolvedObject?.hasActiveHumanCredential;
  const delegated = resolvedTuple ? resolvedTuple[4] : resolvedObject?.delegated;
  const normalizedIdentityKey = identityKey && identityKey !== zeroHash ? identityKey : null;

  return {
    hasActiveHumanCredential: credentialError
      ? false
      : ((resolvedHasActiveHumanCredential as boolean | undefined) ??
        (hasActiveHumanCredential as boolean | undefined) ??
        false),
    holder: holder && holder !== zeroAddress ? holder : null,
    identityKey: normalizedIdentityKey,
    humanNullifier: humanNullifier && humanNullifier !== zeroHash ? humanNullifier : null,
    delegated: Boolean(delegated),
    isLoading: credentialPending || resolvedRaterPending,
    isResolved: !hasAddress || contractUnavailable || (!credentialPending && !resolvedRaterPending),
    refetch,
  };
}

function parseRaterProfile(profileData: unknown): RaterRegistryProfile {
  const tuple = Array.isArray(profileData) ? (profileData as unknown[]) : [];
  const object =
    !Array.isArray(profileData) && profileData && typeof profileData === "object"
      ? (profileData as Record<string, unknown>)
      : {};
  const raterType = normalizeRaterType(object.raterType ?? tuple[0]);
  const metadataHash =
    typeof object.metadataHash === "string"
      ? (object.metadataHash as `0x${string}`)
      : typeof tuple[1] === "string"
        ? (tuple[1] as `0x${string}`)
        : zeroHash;
  const updatedAt =
    typeof object.updatedAt === "bigint" ? object.updatedAt : typeof tuple[2] === "bigint" ? tuple[2] : 0n;

  return {
    raterType,
    raterTypeName: formatRaterTypeName(raterType),
    metadataHash,
    updatedAt,
    hasProfile: raterType !== RATER_TYPE.Unknown || metadataHash !== zeroHash || updatedAt > 0n,
  };
}

export function useRaterRegistryProfile(address?: string) {
  const {
    data: profileData,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "RaterRegistry",
    functionName: "getProfile",
    args: [address],
    query: {
      enabled: !!address,
    },
  });

  return {
    profile: parseRaterProfile(profileData),
    isLoading,
    refetch,
  };
}

export function useSetRaterProfile() {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: raterRegistryContract } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const canUseBatchedRaterProfileCalls = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const raterProfileBatchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });
  const [isSponsoredWritePending, setIsSponsoredWritePending] = useState(false);

  const setRaterProfile = useCallback(
    async (raterType: RaterTypeValue, metadataHash: `0x${string}` = zeroHash) => {
      if (walletTransactionReadiness.isBlocked) {
        throw new Error(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      }

      const args = [raterType, metadataHash] as const;
      if (canUseBatchedRaterProfileCalls && raterRegistryContract) {
        setIsSponsoredWritePending(true);
        try {
          const registryAddress = raterRegistryContract.address as `0x${string}`;
          const registryAbi = raterRegistryContract.abi as Abi;
          const profileBefore =
            address && publicClient
              ? await publicClient
                  .readContract({
                    address: registryAddress,
                    abi: registryAbi,
                    functionName: "getProfile",
                    args: [address],
                  } as never)
                  .then(parseRaterProfile)
                  .catch(() => null)
              : null;

          if (address && publicClient && profileBefore) {
            await raceTransactionWithPostcondition({
              onPostconditionSuccessThenTransactionError: error => {
                console.warn("[rater-registry] profile postcondition succeeded before thirdweb status settled.", error);
              },
              transaction: () =>
                executeSponsoredCalls(
                  [
                    {
                      abi: registryAbi,
                      address: registryAddress,
                      args,
                      functionName: "setProfile",
                    },
                  ],
                  {
                    action: "rater profile update",
                    sponsorshipMode: raterProfileBatchSponsorshipMode,
                    suppressStatusToast: true,
                  },
                ),
              waitForPostcondition: shouldStop =>
                waitForTransactionPostcondition(
                  async () => {
                    const profile = parseRaterProfile(
                      await publicClient.readContract({
                        address: registryAddress,
                        abi: registryAbi,
                        functionName: "getProfile",
                        args: [address],
                      } as never),
                    );
                    return (
                      profile.raterType === raterType &&
                      profile.metadataHash.toLowerCase() === metadataHash.toLowerCase() &&
                      profile.updatedAt > profileBefore.updatedAt
                    );
                  },
                  "rater-registry-profile-postcondition",
                  {
                    pollingIntervalMs: getRaterRegistryPostconditionPollingInterval(targetNetwork.id),
                    shouldStop,
                  },
                ),
            });
          } else {
            await executeSponsoredCalls(
              [
                {
                  abi: registryAbi,
                  address: registryAddress,
                  args,
                  functionName: "setProfile",
                },
              ],
              { action: "rater profile update", sponsorshipMode: raterProfileBatchSponsorshipMode },
            );
          }
          return;
        } finally {
          setIsSponsoredWritePending(false);
        }
      }

      await (writeContractAsync as any)(
        {
          args,
          functionName: "setProfile",
        },
        { action: "rater profile update" },
      );
    },
    [
      address,
      canUseBatchedRaterProfileCalls,
      executeSponsoredCalls,
      publicClient,
      raterProfileBatchSponsorshipMode,
      raterRegistryContract,
      targetNetwork.id,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
      writeContractAsync,
    ],
  );

  return {
    isAvailable: Boolean(raterRegistryContract),
    isPending: isPending || isSponsoredWritePending,
    setRaterProfile,
  };
}

/**
 * Reads the current round stake used by a resolved rater identity.
 */
export function useRaterIdentityStake(contentId?: bigint, roundId?: bigint, identityKey?: `0x${string}` | null) {
  const shouldReadStake = Boolean(contentId !== undefined && roundId !== undefined && identityKey);
  const { data: currentStake } = useScaffoldReadContract({
    contractName: "RoundVotingEngine",
    functionName: "identityCommitState",
    args: [contentId, roundId, identityKey ?? zeroHash, zeroAddress],
    query: {
      enabled: shouldReadStake,
    },
  });

  const MAX_STAKE = 10_000_000n; // 10 LREP in 6-decimal micro-units.
  const usedStake = Array.isArray(currentStake) && typeof currentStake[2] === "bigint" ? currentStake[2] : 0n;
  const remainingCapacity = usedStake >= MAX_STAKE ? 0n : MAX_STAKE - usedStake;

  return {
    currentStake: usedStake,
    remainingCapacity,
  };
}
