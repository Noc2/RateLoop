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
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { getGasBalanceErrorMessage } from "~~/lib/transactionErrors";

export interface RaterRegistryProfile {
  raterType: RaterTypeValue;
  raterTypeName: ReturnType<typeof formatRaterTypeName>;
  metadataHash: `0x${string}`;
  updatedAt: bigint;
  hasProfile: boolean;
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
  const { data: raterRegistryContract } = useDeployedContractInfo({
    contractName: "RaterRegistry",
  });
  const { writeContractAsync, isPending } = useScaffoldWriteContract({
    contractName: "RaterRegistry",
  });
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls } = useThirdwebSponsoredSubmitCalls();
  const { canSponsorTransactions, isMissingGasBalance, nativeTokenSymbol } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });
  const [isSponsoredWritePending, setIsSponsoredWritePending] = useState(false);

  const setRaterProfile = useCallback(
    async (raterType: RaterTypeValue, metadataHash: `0x${string}` = zeroHash) => {
      if (isMissingGasBalance) {
        throw new Error(getGasBalanceErrorMessage(nativeTokenSymbol, { canSponsorTransactions }));
      }

      const args = [raterType, metadataHash] as const;
      if (canUseSponsoredSubmitCalls && raterRegistryContract) {
        setIsSponsoredWritePending(true);
        try {
          await executeSponsoredCalls(
            [
              {
                abi: raterRegistryContract.abi as Abi,
                address: raterRegistryContract.address as `0x${string}`,
                args,
                functionName: "setProfile",
              },
            ],
            { action: "rater profile update" },
          );
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
      canSponsorTransactions,
      canUseSponsoredSubmitCalls,
      executeSponsoredCalls,
      isMissingGasBalance,
      nativeTokenSymbol,
      raterRegistryContract,
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
    functionName: "identityRoundStake",
    args: [contentId, roundId, identityKey ?? zeroHash],
    query: {
      enabled: shouldReadStake,
    },
  });

  const MAX_STAKE = 10_000_000n; // 10 LREP in 6-decimal micro-units.
  const usedStake = typeof currentStake === "bigint" ? currentStake : 0n;
  const remainingCapacity = usedStake >= MAX_STAKE ? 0n : MAX_STAKE - usedStake;

  return {
    currentStake: usedStake,
    remainingCapacity,
  };
}
