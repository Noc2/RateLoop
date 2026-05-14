"use client";

import { useCallback } from "react";
import { zeroAddress, zeroHash } from "viem";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";

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
