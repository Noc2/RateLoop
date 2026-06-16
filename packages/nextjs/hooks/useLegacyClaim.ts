"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { defineChain, getContract, prepareContractCall, sendAndConfirmTransaction } from "thirdweb";
import { useActiveWallet } from "thirdweb/react";
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
import {
  isThirdwebSponsorshipDeniedError,
  useThirdwebSponsoredSubmitCalls,
} from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { getClaimPreflightErrorMessage } from "~~/lib/claimTransactionFeedback";
import type { LegacyClaimLookupResult } from "~~/lib/legacy-claim/lookup";
import { createThirdwebInAppWallet, isThirdwebInAppWalletId, thirdwebClient } from "~~/services/thirdweb/client";
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

function addressesMatch(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeComparableAddress(left);
  const normalizedRight = normalizeComparableAddress(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
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
    return "Legacy claim proof does not match the eligible legacy wallet or the active claim root.";
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

export function shouldUseLegacyAdminClaim(params: {
  activeWalletId?: string | null;
  adminAddress?: string | null;
  adminClaimStatus?: LegacyClaimLookupResult["status"] | null;
  connectedAddress?: string | null;
}) {
  const connectedAddress = normalizeComparableAddress(params.connectedAddress);
  const adminAddress = normalizeComparableAddress(params.adminAddress);

  return Boolean(
    isThirdwebInAppWalletId(params.activeWalletId) &&
      connectedAddress &&
      adminAddress &&
      connectedAddress !== adminAddress &&
      params.adminClaimStatus === "eligible",
  );
}

type TemporaryLegacyClaimWalletMode = "sponsored" | "eoa";
export const LEGACY_CLAIM_ALLOW_IN_APP_SPONSORSHIP_SYNC = true;

async function connectTemporaryLegacyClaimAccount(params: {
  chainId: number;
  claimAddress: `0x${string}`;
  mode: TemporaryLegacyClaimWalletMode;
}) {
  if (!thirdwebClient) {
    throw new Error("Legacy claim wallet is unavailable right now.");
  }

  const wallet = createThirdwebInAppWallet(
    params.chainId,
    params.mode === "eoa"
      ? {
          forceEoa: true,
        }
      : {
          sponsorshipMode: "sponsored",
        },
  );
  const chain = defineChain(params.chainId);

  await wallet.autoConnect({
    chain,
    client: thirdwebClient,
  });

  const account = wallet.getAccount();
  if (!account) {
    throw new Error("Temporary legacy claim wallet is unavailable.");
  }

  if (!addressesMatch(account?.address, params.claimAddress)) {
    throw new Error(
      params.mode === "sponsored"
        ? "Temporary sponsored legacy claim wallet does not match the eligible legacy account."
        : "Temporary legacy claim wallet does not match the eligible legacy account.",
    );
  }

  return account;
}

function shouldRetryTemporaryLegacyClaimAsEoa(error: unknown) {
  const text = getErrorText(error).toLowerCase();
  return (
    isThirdwebSponsorshipDeniedError(error) ||
    text.includes("temporary sponsored legacy claim wallet does not match") ||
    text.includes("bundler") ||
    text.includes("paymaster") ||
    text.includes("useroperation") ||
    text.includes("userop")
  );
}

export function useLegacyClaim() {
  const { address, chain, isConnected } = useAccount();
  const activeWallet = useActiveWallet();
  const refreshWalletBalances = useRefreshWalletBalances();
  const [isSponsoredClaiming, setIsSponsoredClaiming] = useState(false);
  const [isTemporaryLegacyClaiming, setIsTemporaryLegacyClaiming] = useState(false);
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
  const useLegacyAdminClaim = shouldUseLegacyAdminClaim({
    activeWalletId: activeWallet?.id,
    adminAddress: legacyAdminAddress,
    adminClaimStatus: adminClaimQuery.data?.status,
    connectedAddress,
  });
  const effectiveClaimData = useLegacyAdminClaim ? adminClaimQuery.data : claimQuery.data;
  const claimOwnerAddress = (useLegacyAdminClaim ? legacyAdminAddress : connectedAddress) as `0x${string}` | undefined;
  const claimRecipientAddress = connectedAddress;
  const canClaimWithConnectedWallet = addressesMatch(claimOwnerAddress, claimRecipientAddress);

  const claimEntry = effectiveClaimData?.status === "eligible" ? effectiveClaimData : undefined;
  const allocation = useMemo(() => {
    return claimEntry ? BigInt(claimEntry.allocation) : undefined;
  }, [claimEntry]);
  const proof = claimEntry?.proof;
  const hasClaimEntry = !!claimOwnerAddress && allocation !== undefined && !!proof;

  const claimArgs = hasClaimEntry ? ([claimOwnerAddress, allocation, proof] as const) : undefined;
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
    args: claimOwnerAddress ? ([claimOwnerAddress] as const) : undefined,
    query: { enabled: !!claimOwnerAddress && effectiveClaimData?.status === "eligible" },
  } as any);

  const { data: vestingStartRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "legacyContributorVestingStart",
    query: { enabled: effectiveClaimData?.status === "eligible" },
  } as any);

  const { data: vestingDurationRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "LEGACY_VESTING_DURATION",
    query: { enabled: effectiveClaimData?.status === "eligible" },
  } as any);

  const { data: claimDurationRaw } = useScaffoldReadContract({
    contractName: "LaunchDistributionPool",
    functionName: "LEGACY_CLAIM_DURATION",
    query: { enabled: effectiveClaimData?.status === "eligible" },
  } as any);

  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "LaunchDistributionPool",
  } as any);
  const { data: launchDistributionPoolInfo } = useDeployedContractInfo({
    contractName: "LaunchDistributionPool",
  });
  const { canUseSponsoredSubmitCalls, executeSponsoredCalls } = useThirdwebSponsoredSubmitCalls({
    allowInAppSponsorshipSync: LEGACY_CLAIM_ALLOW_IN_APP_SPONSORSHIP_SYNC,
  });
  const canUseSponsoredLegacyClaim = shouldUseSponsoredLegacyClaim({
    canUseSponsoredSubmitCalls: canUseSponsoredSubmitCalls && canClaimWithConnectedWallet,
    claimAddress: claimOwnerAddress,
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
    allowInAppSponsorshipSync: LEGACY_CLAIM_ALLOW_IN_APP_SPONSORSHIP_SYNC,
    includeExternalSendCalls: true,
  });

  const refetchOnChainState = async (claimedAmount?: bigint) => {
    const recipientRefreshOptions =
      claimedAmount !== undefined && claimedAmount > 0n ? { lrepCreditMicro: claimedAmount } : undefined;
    const walletRefreshes = [refreshWalletBalances(claimRecipientAddress, recipientRefreshOptions)];
    if (claimOwnerAddress && !addressesMatch(claimOwnerAddress, claimRecipientAddress)) {
      walletRefreshes.push(refreshWalletBalances(claimOwnerAddress));
    }

    await Promise.all([refetchVested(), refetchClaimable(), refetchClaimed(), ...walletRefreshes]);
  };

  const claim = async () => {
    // Guard against firing the claim before the on-chain claimable read resolves.
    // `claimableRaw` and the claim proof are gated by the same eligibility condition but
    // resolve through independent React Query reads, so there is a window where
    // the proof is defined while `claimableRaw` is still `undefined`. The previous
    // guard only checked `=== 0n` (and `undefined === 0n` is false), so a programmatic
    // call could submit a transaction mid-load. Treat undefined (loading) and any
    // non-positive amount as "nothing to claim".
    const claimableAmount = claimableRaw as bigint | undefined;
    if (allocation === undefined || !proof || claimableAmount === undefined || claimableAmount <= 0n) return;
    if (!claimOwnerAddress || !claimRecipientAddress) return;
    const writeArgs = [allocation, proof] as const;

    if (!canClaimWithConnectedWallet) {
      const client = thirdwebClient;
      if (!launchDistributionPoolInfo || !publicClient || !client) {
        notification.error("Legacy claim contract is unavailable right now.");
        return;
      }

      const recipientClaimArgs = [claimRecipientAddress, allocation, proof] as const;
      const submitTemporaryLegacyClaim = async (mode: TemporaryLegacyClaimWalletMode) => {
        const account = await connectTemporaryLegacyClaimAccount({
          chainId: targetNetwork.id,
          claimAddress: claimOwnerAddress,
          mode,
        });
        const contract = getContract({
          abi: launchDistributionPoolInfo.abi as Abi,
          address: launchDistributionPoolInfo.address as `0x${string}`,
          chain: defineChain(targetNetwork.id),
          client,
        });
        const transaction = prepareContractCall({
          contract,
          method:
            "function claimLegacyContributorAllocationTo(address recipient, uint256 allocation, bytes32[] proof) returns (uint256)",
          params: recipientClaimArgs,
        });

        return sendAndConfirmTransaction({
          account,
          transaction,
        });
      };

      setIsTemporaryLegacyClaiming(true);
      const toastId = notification.loading("Claiming legacy LREP to your RateLoop wallet...");
      try {
        await publicClient.simulateContract({
          abi: launchDistributionPoolInfo.abi as Abi,
          account: claimOwnerAddress,
          address: launchDistributionPoolInfo.address as `0x${string}`,
          args: recipientClaimArgs as any,
          functionName: "claimLegacyContributorAllocationTo",
        });

        try {
          await submitTemporaryLegacyClaim("sponsored");
        } catch (error) {
          if (!shouldRetryTemporaryLegacyClaimAsEoa(error)) {
            throw error;
          }
          await submitTemporaryLegacyClaim("eoa");
        }

        notification.success("Legacy LREP claimed to your RateLoop wallet.");
        await refetchOnChainState(claimableAmount);
      } catch (error) {
        notification.error(getLegacyClaimTransactionErrorMessage(error));
      } finally {
        notification.remove(toastId);
        setIsTemporaryLegacyClaiming(false);
      }
      return;
    }

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
        await refetchOnChainState(claimableAmount);
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
      await refetchOnChainState(claimableAmount);
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
    claimData: effectiveClaimData,
    claimOwnerAddress,
    claimRecipientAddress,
    error: claimQuery.error ?? adminClaimQuery.error,
    isClaiming: isMining || isSponsoredClaiming || isTemporaryLegacyClaiming,
    isConnected,
    isLoading: claimQuery.isLoading || (shouldInspectAdminClaim && adminClaimQuery.isLoading),
    isRecipientClaim: Boolean(claimOwnerAddress && claimRecipientAddress && !canClaimWithConnectedWallet),
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
