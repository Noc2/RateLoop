"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import type { LegacyClaimLookupResult } from "~~/lib/legacy-claim/lookup";

async function fetchLegacyClaim(address: `0x${string}`): Promise<LegacyClaimLookupResult> {
  const response = await fetch(`/api/legacy-claim/${address}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load legacy claim allocation.");
  }
  return response.json() as Promise<LegacyClaimLookupResult>;
}

export function useLegacyClaim() {
  const { address, isConnected } = useAccount();
  const connectedAddress = address as `0x${string}` | undefined;

  const claimQuery = useQuery({
    queryKey: ["legacy-claim", connectedAddress],
    queryFn: () => fetchLegacyClaim(connectedAddress as `0x${string}`),
    enabled: !!connectedAddress,
    staleTime: 30_000,
  });

  const claimEntry = claimQuery.data?.status === "eligible" ? claimQuery.data : undefined;
  const allocation = useMemo(() => {
    return claimEntry ? BigInt(claimEntry.allocation) : undefined;
  }, [claimEntry]);
  const proof = claimEntry?.proof;
  const hasClaimEntry = !!connectedAddress && allocation !== undefined && !!proof;

  const claimArgs = hasClaimEntry ? ([connectedAddress, allocation, proof] as const) : undefined;
  const writeArgs = hasClaimEntry ? ([allocation, proof] as const) : undefined;

  const { data: vestedRaw, refetch: refetchVested } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "vestedLegacyContributorAllocation",
    args: claimArgs as any,
    query: { enabled: hasClaimEntry },
  } as any);

  const { data: claimableRaw, refetch: refetchClaimable } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "claimableLegacyContributorAllocation",
    args: claimArgs as any,
    query: { enabled: hasClaimEntry },
  } as any);

  const { data: claimedRaw, refetch: refetchClaimed } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "legacyContributorClaimed",
    args: connectedAddress ? ([connectedAddress] as const) : undefined,
    query: { enabled: !!connectedAddress && claimQuery.data?.status === "eligible" },
  } as any);

  const { data: vestingStartRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "legacyContributorVestingStart",
    query: { enabled: claimQuery.data?.status === "eligible" },
  } as any);

  const { data: vestingDurationRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "LEGACY_VESTING_DURATION",
    query: { enabled: claimQuery.data?.status === "eligible" },
  } as any);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  } as any);

  const refetchOnChainState = async () => {
    await Promise.all([refetchVested(), refetchClaimable(), refetchClaimed()]);
  };

  const claim = async () => {
    if (!writeArgs || (claimableRaw as bigint | undefined) === 0n) return;
    await writeContractAsync(
      {
        functionName: "claimLegacyContributorAllocation",
        args: writeArgs as any,
      },
      {
        action: "Claim legacy LREP",
        onBlockConfirmation: () => {
          void refetchOnChainState();
        },
      },
    );
  };

  return {
    allocation,
    claim,
    claimed: (claimedRaw as bigint | undefined) ?? 0n,
    claimable: (claimableRaw as bigint | undefined) ?? 0n,
    claimData: claimQuery.data,
    error: claimQuery.error,
    isClaiming: isMining,
    isConnected,
    isLoading: claimQuery.isLoading,
    refetch: async () => {
      await claimQuery.refetch();
      await refetchOnChainState();
    },
    vested: (vestedRaw as bigint | undefined) ?? 0n,
    vestingDuration: (vestingDurationRaw as bigint | undefined) ?? 0n,
    vestingStart: vestingStartRaw as bigint | undefined,
  };
}
