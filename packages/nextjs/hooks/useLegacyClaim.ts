"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { defineChain } from "thirdweb";
import { useActiveWallet, useSetActiveWallet } from "thirdweb/react";
import { type Abi } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-eth";
import { useGasBalanceStatus } from "~~/hooks/useGasBalanceStatus";
import { useRefreshWalletBalances } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { getClaimPreflightErrorMessage } from "~~/lib/claimTransactionFeedback";
import type { LegacyClaimLookupResult } from "~~/lib/legacy-claim/lookup";
import {
  createThirdwebInAppWallet,
  isThirdwebInAppWalletId,
  setStoredThirdwebSponsorshipMode,
  thirdwebClient,
} from "~~/services/thirdweb/client";
import { notification } from "~~/utils/scaffold-eth";

async function fetchLegacyClaim(address: `0x${string}`): Promise<LegacyClaimLookupResult> {
  const response = await fetch(`/api/legacy-claim/${address}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Unable to load legacy claim allocation.");
  }
  return response.json() as Promise<LegacyClaimLookupResult>;
}

function normalizeComparableAddress(address: string | null | undefined) {
  return address?.toLowerCase() ?? null;
}

export function shouldUseSponsoredLegacyClaim(params: {
  canUseSponsoredSubmitCalls: boolean;
  claimAddress?: string | null;
  executionAddress?: string | null;
}) {
  if (!params.canUseSponsoredSubmitCalls) {
    return false;
  }

  const claimAddress = normalizeComparableAddress(params.claimAddress);
  const executionAddress = normalizeComparableAddress(params.executionAddress);

  return Boolean(claimAddress && executionAddress && claimAddress === executionAddress);
}

function getErrorText(error: unknown) {
  const values = [error];
  const maybeWalk = (error as { walk?: () => unknown } | undefined)?.walk;
  if (typeof maybeWalk === "function") {
    try {
      values.push(maybeWalk.call(error));
    } catch {
      // Ignore malformed third-party error helpers.
    }
  }

  return values
    .flatMap(value => {
      const record = value as { details?: unknown; message?: unknown; name?: unknown; shortMessage?: unknown } | null;
      return [record?.details, record?.shortMessage, record?.message, record?.name];
    })
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

export function getLegacyClaimTransactionErrorMessage(error: unknown, fallbackMessage = "Legacy claim failed.") {
  const message = getErrorText(error);

  if (/0x09bde339|InvalidProof/i.test(message)) {
    return "Legacy claim proof does not match the wallet sending this transaction or the active claim root. Reconnect the eligible legacy wallet and try again.";
  }

  if (/LegacyClaimWindowClosed/i.test(message)) {
    return "The legacy claim window has closed.";
  }

  if (/AlreadyClaimed/i.test(message)) {
    return "There is no legacy LREP left to claim for this wallet right now.";
  }

  if (/PoolDepleted/i.test(message)) {
    return "The legacy contributor pool cannot pay this claim right now.";
  }

  if (/InvalidAmount/i.test(message)) {
    return "The legacy claim amount is invalid for the active claim root.";
  }

  return fallbackMessage;
}

export function shouldInspectLegacyAdminClaim(params: {
  adminAddress?: string | null;
  connectedAddress?: string | null;
  connectedClaimStatus?: LegacyClaimLookupResult["status"] | null;
  isWrongChain: boolean;
}) {
  const connectedAddress = normalizeComparableAddress(params.connectedAddress);
  const adminAddress = normalizeComparableAddress(params.adminAddress);

  return Boolean(
    !params.isWrongChain &&
      connectedAddress &&
      adminAddress &&
      connectedAddress !== adminAddress &&
      params.connectedClaimStatus === "not_eligible",
  );
}

export function shouldSwitchToLegacyAdminWallet(params: {
  activeWalletId?: string | null;
  adminAddress?: string | null;
  adminClaimStatus?: LegacyClaimLookupResult["status"] | null;
  connectedAddress?: string | null;
  isRestoring: boolean;
}) {
  const connectedAddress = normalizeComparableAddress(params.connectedAddress);
  const adminAddress = normalizeComparableAddress(params.adminAddress);

  return Boolean(
    !params.isRestoring &&
      isThirdwebInAppWalletId(params.activeWalletId) &&
      connectedAddress &&
      adminAddress &&
      connectedAddress !== adminAddress &&
      params.adminClaimStatus === "eligible",
  );
}

export function useLegacyClaim() {
  const { address, chain, isConnected } = useAccount();
  const activeWallet = useActiveWallet();
  const setActiveWallet = useSetActiveWallet();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const refreshWalletBalances = useRefreshWalletBalances();
  const [isSponsoredClaiming, setIsSponsoredClaiming] = useState(false);
  const [isRestoringLegacyWallet, setIsRestoringLegacyWallet] = useState(false);
  const legacyWalletRestoreAttemptRef = useRef<string | null>(null);
  const connectedAddress = address as `0x${string}` | undefined;
  const legacyAdminAddress = activeWallet?.getAdminAccount?.()?.address as `0x${string}` | undefined;
  // CLAIM-3 (2026-05-21 testnet-readiness audit): if the wallet is on the wrong chain, the
  // scaffold-eth read calls below return undefined silently and the UI stalls on "Loading…"
  // with no actionable error. Detect the mismatch up-front and surface it as a typed flag so
  // `LegacyClaimPage` can render a "switch network" prompt instead of an indefinite spinner.
  const { targetNetwork } = useTargetNetwork();
  const connectedChainId = chain?.id;
  const isWrongChain = isConnected && connectedChainId !== undefined && connectedChainId !== targetNetwork.id;
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const activeExecutionAddress = activeWallet?.getAccount?.()?.address as `0x${string}` | undefined;

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
  const shouldInspectAdminClaim = shouldInspectLegacyAdminClaim({
    adminAddress: legacyAdminAddress,
    connectedAddress,
    connectedClaimStatus: claimQuery.data?.status,
    isWrongChain,
  });
  const adminClaimQuery = useQuery({
    queryKey: ["legacy-claim", "admin", legacyAdminAddress],
    queryFn: () => fetchLegacyClaim(legacyAdminAddress as `0x${string}`),
    enabled: shouldInspectAdminClaim,
    staleTime: 30_000,
  });
  const shouldRestoreLegacyAdminWallet = shouldSwitchToLegacyAdminWallet({
    activeWalletId: activeWallet?.id,
    adminAddress: legacyAdminAddress,
    adminClaimStatus: adminClaimQuery.data?.status,
    connectedAddress,
    isRestoring: isRestoringLegacyWallet,
  });

  useEffect(() => {
    if (
      !shouldRestoreLegacyAdminWallet ||
      !thirdwebClient ||
      !legacyAdminAddress ||
      !activeWallet ||
      !isThirdwebInAppWalletId(activeWallet.id)
    ) {
      if (!shouldRestoreLegacyAdminWallet) {
        legacyWalletRestoreAttemptRef.current = null;
      }
      return;
    }

    const attemptKey = `${legacyAdminAddress.toLowerCase()}:${targetNetwork.id}`;
    if (legacyWalletRestoreAttemptRef.current === attemptKey) {
      return;
    }

    legacyWalletRestoreAttemptRef.current = attemptKey;
    setIsRestoringLegacyWallet(true);

    void (async () => {
      try {
        setStoredThirdwebSponsorshipMode(null);
        const replacementWallet = createThirdwebInAppWallet(targetNetwork.id, {
          forceEoa: true,
        });

        await replacementWallet.autoConnect({
          chain: defineChain(targetNetwork.id),
          client: thirdwebClient,
        });

        const replacementAddress = replacementWallet.getAccount()?.address;
        if (replacementAddress?.toLowerCase() !== legacyAdminAddress.toLowerCase()) {
          throw new Error("Restored legacy wallet does not match the eligible admin account.");
        }

        await syncWalletToWagmi(replacementWallet, targetNetwork.id, {
          reconnect: true,
          replaceActiveConnection: true,
        });
        await setActiveWallet(replacementWallet);
      } catch (error) {
        legacyWalletRestoreAttemptRef.current = null;
        console.error("Failed to restore thirdweb legacy claim wallet:", error);
      } finally {
        setIsRestoringLegacyWallet(false);
      }
    })();
  }, [
    activeWallet,
    legacyAdminAddress,
    setActiveWallet,
    shouldRestoreLegacyAdminWallet,
    syncWalletToWagmi,
    targetNetwork.id,
  ]);

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
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls } = useThirdwebSponsoredSubmitCalls({
    allowInAppSponsorshipSync: false,
  });
  const canUseSponsoredLegacyClaim = shouldUseSponsoredLegacyClaim({
    canUseSponsoredSubmitCalls,
    claimAddress: connectedAddress,
    executionAddress: activeExecutionAddress,
  });
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
    allowInAppSponsorshipSync: false,
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
      canSponsorTransactions: canSponsorTransactions && canUseSponsoredLegacyClaim,
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

    if (shouldRestoreLegacyAdminWallet) {
      notification.warning("Reconnecting the eligible legacy wallet before claiming. Try again once it finishes.");
      return;
    }

    if (canUseSponsoredLegacyClaim) {
      if (!launchDistributionPoolInfo) {
        notification.error("Legacy claim contract is unavailable right now.");
        return;
      }

      setIsSponsoredClaiming(true);
      try {
        await publicClient?.simulateContract({
          abi: launchDistributionPoolInfo.abi as Abi,
          account: activeExecutionAddress,
          address: launchDistributionPoolInfo.address as `0x${string}`,
          args: writeArgs as any,
          functionName: "claimLegacyContributorAllocation",
        });
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
      } catch (error) {
        notification.error(getLegacyClaimTransactionErrorMessage(error));
      } finally {
        setIsSponsoredClaiming(false);
      }
      return;
    }

    try {
      await writeContractAsync(
        {
          functionName: "claimLegacyContributorAllocation",
          args: writeArgs as any,
        },
        {
          action: "Claim legacy LREP",
          getErrorMessage: (error, defaultMessage) => getLegacyClaimTransactionErrorMessage(error, defaultMessage),
        },
      );
      await refetchOnChainState();
    } catch {
      // `useScaffoldWriteContract` already surfaced the transaction error toast.
    }
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
    isLoading: claimQuery.isLoading || (shouldInspectAdminClaim && adminClaimQuery.isLoading),
    isRestoringLegacyWallet,
    // CLAIM-3: callers can render a "switch network" prompt when this is true.
    isWrongChain,
    expectedChainId: targetNetwork.id,
    expectedChainName: targetNetwork.name,
    refetch: async () => {
      await claimQuery.refetch();
      if (shouldInspectAdminClaim) {
        await adminClaimQuery.refetch();
      }
      await refetchOnChainState();
    },
    vested: (vestedRaw as bigint | undefined) ?? 0n,
    vestingDuration: (vestingDurationRaw as bigint | undefined) ?? 0n,
    vestingStart: vestingStartRaw as bigint | undefined,
  };
}
