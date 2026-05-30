"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Abi } from "viem";
import { useAccount } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { getClaimPreflightErrorMessage } from "~~/lib/claimTransactionFeedback";
import type { LegacyClaimLookupResult } from "~~/lib/legacy-claim/lookup";
import { notification } from "~~/utils/scaffold-eth";

async function fetchLegacyClaim(address: `0x${string}`): Promise<LegacyClaimLookupResult> {
  const response = await fetch(`/api/legacy-claim/${address}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load legacy claim allocation.");
  }
  return response.json() as Promise<LegacyClaimLookupResult>;
}

export function useLegacyClaim() {
  const { address, chain, isConnected } = useAccount();
  const refreshWalletBalances = useRefreshWalletBalances();
  const [isSponsoredClaiming, setIsSponsoredClaiming] = useState(false);
  const connectedAddress = address as `0x${string}` | undefined;
  // CLAIM-3 (2026-05-21 testnet-readiness audit): if the wallet is on the wrong chain, the
  // scaffold-eth read calls below return undefined silently and the UI stalls on "Loading…"
  // with no actionable error. Detect the mismatch up-front and surface it as a typed flag so
  // `LegacyClaimPage` can render a "switch network" prompt instead of an indefinite spinner.
  const { targetNetwork } = useTargetNetwork();
  const connectedChainId = chain?.id;
  const isWrongChain = isConnected && connectedChainId !== undefined && connectedChainId !== targetNetwork.id;

  const claimQuery = useQuery({
    queryKey: ["legacy-claim", connectedAddress],
    queryFn: () => fetchLegacyClaim(connectedAddress as `0x${string}`),
    // Don't fetch the manifest entry until the wallet is on the right network — the proof is
    // chain-agnostic but the subsequent on-chain reads (`vested…`, `claimable…`) would silently
    // return undefined and we'd commit to a spinner loop. Easier to surface the chain mismatch
    // and re-enable the query once the user switches.
    enabled: !!connectedAddress && !isWrongChain,
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

  const { data: claimDurationRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "LEGACY_CLAIM_DURATION",
    query: { enabled: claimQuery.data?.status === "eligible" },
  } as any);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  } as any);
  const { data: launchDistributionPoolInfo } = useDeployedContractInfo({
    contractName: "LaunchDistributionPool",
  });
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls } = useThirdwebSponsoredSubmitCalls();
  const {
    canShowFreeTransactionAllowance,
    canSponsorTransactions,
    freeTransactionRemaining,
    freeTransactionVerified,
    isAwaitingFreeTransactionAllowance,
    isAwaitingSelfFundedWalletReconnect,
    isAwaitingSponsoredWalletReconnect,
    isMissingGasBalance,
    nativeBalanceValue,
    nativeTokenSymbol,
  } = useGasBalanceStatus({
    includeExternalSendCalls: true,
  });

  const refetchOnChainState = async () => {
    await Promise.all([refetchVested(), refetchClaimable(), refetchClaimed()]);
    await refreshWalletBalances(connectedAddress);
  };

  const claim = async () => {
    // Guard against firing the claim before the on-chain claimable read resolves.
    // `claimableRaw` and `writeArgs` are gated by the same eligibility condition but
    // resolve through independent React Query reads, so there is a window where
    // `writeArgs` is defined while `claimableRaw` is still `undefined`. The previous
    // guard only checked `=== 0n` (and `undefined === 0n` is false), so a programmatic
    // call could submit a transaction mid-load. Treat undefined (loading) and any
    // non-positive amount as "nothing to claim".
    const claimableAmount = claimableRaw as bigint | undefined;
    if (!writeArgs || claimableAmount === undefined || claimableAmount <= 0n) return;

    const preflightError = getClaimPreflightErrorMessage({
      canShowFreeTransactionAllowance,
      canSponsorTransactions,
      freeTransactionRemaining,
      freeTransactionVerified,
      hasNativeGasBalance: nativeBalanceValue > 0n,
      isAwaitingFreeTransactionAllowance,
      isAwaitingSelfFundedWalletReconnect,
      isAwaitingSponsoredWalletReconnect,
      isMissingGasBalance,
      nativeTokenSymbol,
    });
    if (preflightError) {
      if (
        isAwaitingFreeTransactionAllowance ||
        isAwaitingSelfFundedWalletReconnect ||
        isAwaitingSponsoredWalletReconnect
      ) {
        notification.warning(preflightError);
      } else {
        notification.error(preflightError);
      }
      return;
    }

    if (canUseSponsoredSubmitCalls) {
      if (!launchDistributionPoolInfo) {
        notification.error("Legacy claim contract is unavailable right now.");
        return;
      }

      setIsSponsoredClaiming(true);
      try {
        await executeSponsoredCalls(
          [
            {
              abi: launchDistributionPoolInfo.abi as Abi,
              address: launchDistributionPoolInfo.address as `0x${string}`,
              args: writeArgs as any,
              functionName: "claimLegacyContributorAllocation",
            },
          ],
          { action: "Claim legacy LREP" },
        );
        await refetchOnChainState();
      } finally {
        setIsSponsoredClaiming(false);
      }
      return;
    }

    await writeContractAsync(
      {
        functionName: "claimLegacyContributorAllocation",
        args: writeArgs as any,
      },
      {
        action: "Claim legacy LREP",
      },
    );
    await refetchOnChainState();
  };

  return {
    allocation,
    claim,
    claimDuration: (claimDurationRaw as bigint | undefined) ?? 0n,
    claimed: (claimedRaw as bigint | undefined) ?? 0n,
    claimable: (claimableRaw as bigint | undefined) ?? 0n,
    claimData: claimQuery.data,
    error: claimQuery.error,
    isClaiming: isMining || isSponsoredClaiming,
    isConnected,
    isLoading: claimQuery.isLoading,
    // CLAIM-3: callers can render a "switch network" prompt when this is true.
    isWrongChain,
    expectedChainId: targetNetwork.id,
    expectedChainName: targetNetwork.name,
    refetch: async () => {
      await claimQuery.refetch();
      await refetchOnChainState();
    },
    vested: (vestedRaw as bigint | undefined) ?? 0n,
    vestingDuration: (vestingDurationRaw as bigint | undefined) ?? 0n,
    vestingStart: vestingStartRaw as bigint | undefined,
  };
}
