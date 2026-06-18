"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { defineChain } from "thirdweb";
import { useActiveWallet, useActiveWalletChain, useSetActiveWallet } from "thirdweb/react";
import { useAccount, usePublicClient } from "wagmi";
import { useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { resolveWalletExecutionChainId } from "~~/hooks/useWalletExecutionCapabilities";
import {
  getEip7702DelegationTarget,
  hasMissingEip7702DelegationImplementation,
} from "~~/lib/thirdweb/eip7702Delegation";
import {
  createThirdwebInAppWallet,
  getThirdwebWalletSponsorshipMode,
  isThirdwebInAppWalletCurrentForAddress,
  setStoredThirdwebSponsorshipMode,
  supportsThirdwebInAppExecutionCapabilities,
  thirdwebClient,
  usesThirdwebInAppEip7702Execution,
} from "~~/services/thirdweb/client";
import { RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY } from "~~/services/thirdweb/testWalletStorage";
import { notification } from "~~/utils/scaffold-eth";

export const FREE_TRANSACTION_ALLOWANCE_QUERY_KEY = ["free-transactions"] as const;

type FreeTransactionAllowanceResponse = {
  chainId: number;
  environment: string;
  limit: number;
  used: number;
  remaining: number;
  verified: boolean;
  exhausted: boolean;
  walletAddress: `0x${string}` | null;
  raterIdentityKey: string | null;
};

type SponsorshipMode = "sponsored" | "self-funded";
type SponsorshipSyncMode = SponsorshipMode | "eoa";
type FreeTransactionAllowanceOptions = {
  allowInAppSponsorshipSync?: boolean;
};

function getClientFreeTransactionEnvironmentScope() {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.location.origin;
  } catch {
    return undefined;
  }
}

function hasLocalE2ETestWalletSession() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return Boolean(window.localStorage.getItem(RATELOOP_E2E_TEST_WALLET_PRIVATE_KEY_STORAGE_KEY)?.trim());
  } catch {
    return false;
  }
}

export function buildFreeTransactionAllowanceSnapshotKey(
  address?: string,
  chainId?: number,
  environmentScope: string | undefined = getClientFreeTransactionEnvironmentScope(),
) {
  if (!address || typeof chainId !== "number") {
    return null;
  }

  return `rateloop-free-transactions-summary:${environmentScope ?? "unknown"}:${address.toLowerCase()}:${chainId}`;
}

function readStoredFreeTransactionAllowanceSummary(address?: string, chainId?: number) {
  if (typeof window === "undefined") {
    return null;
  }

  const storageKey = buildFreeTransactionAllowanceSnapshotKey(address, chainId);
  if (!storageKey) {
    return null;
  }

  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) {
      return null;
    }

    return JSON.parse(rawValue) as FreeTransactionAllowanceResponse;
  } catch {
    return null;
  }
}

function storeFreeTransactionAllowanceSummary(
  summary: FreeTransactionAllowanceResponse,
  address?: string,
  chainId?: number,
) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = buildFreeTransactionAllowanceSnapshotKey(
    address,
    chainId,
    summary.environment || getClientFreeTransactionEnvironmentScope(),
  );
  if (!storageKey) {
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(summary));
  } catch {
    // Ignore storage failures.
  }
}

export function buildExhaustionToastKey(params: {
  chainId: number;
  environmentScope?: string;
  raterIdentityKey: string;
}) {
  return `rateloop-free-transactions-exhausted:${params.environmentScope ?? "unknown"}:${params.chainId}:${params.raterIdentityKey}`;
}

function hasShownExhaustionToast(params: { chainId: number; raterIdentityKey: string }) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.sessionStorage.getItem(
        buildExhaustionToastKey({
          ...params,
          environmentScope: getClientFreeTransactionEnvironmentScope(),
        }),
      ) === "1"
    );
  } catch {
    return false;
  }
}

function markExhaustionToastShown(params: { chainId: number; raterIdentityKey: string }) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      buildExhaustionToastKey({
        ...params,
        environmentScope: getClientFreeTransactionEnvironmentScope(),
      }),
      "1",
    );
  } catch {
    // Ignore storage errors.
  }
}

export function buildSponsorshipSyncAttemptKey(params: {
  address: string;
  chainId: number;
  sponsorshipMode: SponsorshipSyncMode;
}) {
  return `${params.address.toLowerCase()}:${params.chainId}:${params.sponsorshipMode}`;
}

export function clearSponsorshipSyncAttemptAfterFailure(currentAttemptKey: string | null, failedAttemptKey: string) {
  return currentAttemptKey === failedAttemptKey ? null : currentAttemptKey;
}

function getFreeTransactionAllowanceQueryKey(address?: string, chainId?: number) {
  return [...FREE_TRANSACTION_ALLOWANCE_QUERY_KEY, address?.toLowerCase() ?? null, chainId ?? null] as const;
}

export function getFreeTransactionAllowanceIdentityAddress(params: {
  activeWalletId?: string | null;
  adminAddress?: string | null;
  connectedAddress?: string | null;
  thirdwebAccountAddress?: string | null;
}) {
  const isCurrentInAppWallet = isThirdwebInAppWalletCurrentForAddress({
    activeWalletId: params.activeWalletId,
    connectedAddress: params.connectedAddress,
    thirdwebAccountAddress: params.thirdwebAccountAddress,
    thirdwebAdminAddress: params.adminAddress,
  });

  if (params.adminAddress && isCurrentInAppWallet && /^0x[a-fA-F0-9]{40}$/.test(params.adminAddress)) {
    return params.adminAddress;
  }

  return (
    params.connectedAddress ??
    (isCurrentInAppWallet ? (params.thirdwebAccountAddress ?? params.adminAddress ?? undefined) : undefined)
  );
}

export function useFreeTransactionAllowance(options: FreeTransactionAllowanceOptions = {}) {
  const allowInAppSponsorshipSync = options.allowInAppSponsorshipSync ?? true;
  const canSyncInAppSponsorship = allowInAppSponsorshipSync && !hasLocalE2ETestWalletSession();
  const { address, chain } = useAccount();
  const activeWallet = useActiveWallet();
  const activeWalletChain = useActiveWalletChain();
  const setActiveWallet = useSetActiveWallet();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const previousRemainingRef = useRef<number | null>(null);
  const sponsorshipSyncAttemptRef = useRef<string | null>(null);
  const resolvedChainId = resolveWalletExecutionChainId(chain?.id, activeWalletChain?.id);
  const supportsInAppExecution = supportsThirdwebInAppExecutionCapabilities(resolvedChainId);
  const usesInAppEip7702Execution = usesThirdwebInAppEip7702Execution(resolvedChainId);
  const publicClient = usePublicClient({ chainId: resolvedChainId });
  const currentSponsorshipMode = getThirdwebWalletSponsorshipMode(activeWallet);
  const activeWalletAccountAddress = activeWallet?.getAccount()?.address;
  const activeWalletAdminAddress = activeWallet?.getAdminAccount?.()?.address;
  const isCurrentInAppWallet = isThirdwebInAppWalletCurrentForAddress({
    activeWalletId: activeWallet?.id,
    connectedAddress: address,
    thirdwebAccountAddress: activeWalletAccountAddress,
    thirdwebAdminAddress: activeWalletAdminAddress,
  });
  const allowanceAddress = getFreeTransactionAllowanceIdentityAddress({
    activeWalletId: activeWallet?.id,
    adminAddress: activeWalletAdminAddress,
    connectedAddress: address,
    thirdwebAccountAddress: activeWalletAccountAddress,
  });

  const query = useQuery({
    queryKey: getFreeTransactionAllowanceQueryKey(allowanceAddress, resolvedChainId),
    queryFn: async () => {
      const response = await fetch(
        `/api/transactions/free/session?address=${allowanceAddress}&chainId=${resolvedChainId}`,
      );
      const body = (await response.json().catch(() => null)) as
        | FreeTransactionAllowanceResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error((body as { error?: string } | null)?.error || "Failed to load free transaction summary");
      }

      return body as FreeTransactionAllowanceResponse;
    },
    enabled: Boolean(allowanceAddress) && typeof resolvedChainId === "number",
    staleTime: 30_000,
    // M-2 (2026-05-22 audit): a single transient 5xx previously locked the hook into
    // {isResolved: false} for the rest of the session, blocking sponsored transactions
    // for users who would have recovered immediately on the next request. Retry with a
    // short exponential backoff and cap at 30s so a sustained outage still surfaces.
    retry: 2,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30_000),
  });

  const fallbackSummary = useMemo(
    () => (query.data ? null : readStoredFreeTransactionAllowanceSummary(allowanceAddress, resolvedChainId)),
    [allowanceAddress, query.data, resolvedChainId],
  );

  const shouldInspectInAppDelegation = Boolean(
    usesInAppEip7702Execution &&
      publicClient &&
      address &&
      activeWallet &&
      isCurrentInAppWallet &&
      currentSponsorshipMode !== null,
  );
  const inAppDelegationQuery = useQuery({
    queryKey: ["thirdweb-in-app-delegation", resolvedChainId ?? null, address?.toLowerCase() ?? null],
    enabled: shouldInspectInAppDelegation,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const walletCode = await publicClient!.getCode({ address: address as `0x${string}` });
      const implementation = getEip7702DelegationTarget(walletCode);
      if (!implementation) {
        return { hasMissingImplementation: false, implementation: null };
      }

      const implementationCode = await publicClient!.getCode({ address: implementation });
      return {
        hasMissingImplementation: hasMissingEip7702DelegationImplementation({ implementationCode, walletCode }),
        implementation,
      };
    },
  });
  const hasBrokenInAppDelegation = inAppDelegationQuery.data?.hasMissingImplementation === true;
  const isInspectingInAppDelegation = shouldInspectInAppDelegation && inAppDelegationQuery.isLoading;
  const shouldUseEoaWallet = !supportsInAppExecution || hasBrokenInAppDelegation;

  useEffect(() => {
    if (!query.data) {
      return;
    }

    storeFreeTransactionAllowanceSummary(query.data, allowanceAddress, resolvedChainId);
  }, [allowanceAddress, query.data, resolvedChainId]);

  const allowance = useMemo(() => {
    const summary = query.data ?? fallbackSummary;
    const canUseFreeTransactions = Boolean(
      supportsInAppExecution &&
        !hasBrokenInAppDelegation &&
        !isInspectingInAppDelegation &&
        summary?.verified &&
        summary.remaining > 0,
    );

    return {
      ...query,
      isResolved: query.isFetched || query.isError || Boolean(summary),
      canUseFreeTransactions,
      exhausted: Boolean(summary?.verified && summary.remaining === 0),
      limit: summary?.limit ?? 0,
      remaining: summary?.remaining ?? 0,
      used: summary?.used ?? 0,
      verified: Boolean(summary?.verified),
      raterIdentityKey: summary?.raterIdentityKey ?? null,
    };
  }, [fallbackSummary, hasBrokenInAppDelegation, isInspectingInAppDelegation, query, supportsInAppExecution]);

  const desiredSponsorshipMode = useMemo(() => {
    if (
      !isCurrentInAppWallet ||
      !resolvedChainId ||
      shouldUseEoaWallet ||
      isInspectingInAppDelegation ||
      !allowance.isResolved
    ) {
      return null;
    }

    return allowance.canUseFreeTransactions ? "sponsored" : "self-funded";
  }, [
    allowance.canUseFreeTransactions,
    allowance.isResolved,
    isCurrentInAppWallet,
    isInspectingInAppDelegation,
    resolvedChainId,
    shouldUseEoaWallet,
  ]);

  useEffect(() => {
    if (!canSyncInAppSponsorship || !isCurrentInAppWallet || !resolvedChainId) {
      return;
    }

    if (shouldUseEoaWallet) {
      setStoredThirdwebSponsorshipMode(null);
      return;
    }

    if (!desiredSponsorshipMode) {
      return;
    }

    setStoredThirdwebSponsorshipMode(desiredSponsorshipMode);
  }, [canSyncInAppSponsorship, desiredSponsorshipMode, isCurrentInAppWallet, resolvedChainId, shouldUseEoaWallet]);

  useEffect(() => {
    if (
      !canSyncInAppSponsorship ||
      !thirdwebClient ||
      !address ||
      !resolvedChainId ||
      !desiredSponsorshipMode ||
      !activeWallet ||
      !isCurrentInAppWallet
    ) {
      return;
    }

    const currentMode = getThirdwebWalletSponsorshipMode(activeWallet);
    if (currentMode === desiredSponsorshipMode) {
      sponsorshipSyncAttemptRef.current = null;
      return;
    }

    const attemptKey = buildSponsorshipSyncAttemptKey({
      address,
      chainId: resolvedChainId,
      sponsorshipMode: desiredSponsorshipMode,
    });
    if (sponsorshipSyncAttemptRef.current === attemptKey) {
      return;
    }

    sponsorshipSyncAttemptRef.current = attemptKey;

    void (async () => {
      try {
        const replacementWallet = createThirdwebInAppWallet(resolvedChainId, {
          sponsorshipMode: desiredSponsorshipMode,
        });

        await replacementWallet.autoConnect({
          chain: defineChain(resolvedChainId),
          client: thirdwebClient,
        });
        await syncWalletToWagmi(replacementWallet, resolvedChainId, { reconnect: true });
        await setActiveWallet(replacementWallet);
      } catch (error) {
        sponsorshipSyncAttemptRef.current = clearSponsorshipSyncAttemptAfterFailure(
          sponsorshipSyncAttemptRef.current,
          attemptKey,
        );
        console.error("Failed to sync thirdweb sponsorship mode:", error);
      }
    })();
  }, [
    activeWallet,
    address,
    canSyncInAppSponsorship,
    desiredSponsorshipMode,
    isCurrentInAppWallet,
    resolvedChainId,
    setActiveWallet,
    syncWalletToWagmi,
  ]);

  useEffect(() => {
    if (
      !canSyncInAppSponsorship ||
      !thirdwebClient ||
      !address ||
      !resolvedChainId ||
      !shouldUseEoaWallet ||
      !activeWallet ||
      !isCurrentInAppWallet ||
      getThirdwebWalletSponsorshipMode(activeWallet) === null
    ) {
      return;
    }

    const attemptKey = buildSponsorshipSyncAttemptKey({
      address,
      chainId: resolvedChainId,
      sponsorshipMode: "eoa",
    });
    if (sponsorshipSyncAttemptRef.current === attemptKey) {
      return;
    }

    sponsorshipSyncAttemptRef.current = attemptKey;

    void (async () => {
      try {
        const replacementWallet = createThirdwebInAppWallet(resolvedChainId, {
          forceEoa: true,
        });

        await replacementWallet.autoConnect({
          chain: defineChain(resolvedChainId),
          client: thirdwebClient,
        });
        await syncWalletToWagmi(replacementWallet, resolvedChainId, { reconnect: true });
        await setActiveWallet(replacementWallet);
      } catch (error) {
        sponsorshipSyncAttemptRef.current = clearSponsorshipSyncAttemptAfterFailure(
          sponsorshipSyncAttemptRef.current,
          attemptKey,
        );
        console.error("Failed to sync thirdweb EOA mode:", error);
      }
    })();
  }, [
    activeWallet,
    address,
    canSyncInAppSponsorship,
    isCurrentInAppWallet,
    resolvedChainId,
    setActiveWallet,
    shouldUseEoaWallet,
    syncWalletToWagmi,
  ]);

  useEffect(() => {
    if (!allowance.verified || !resolvedChainId || !allowance.raterIdentityKey) {
      previousRemainingRef.current = allowance.remaining;
      return;
    }

    const previousRemaining = previousRemainingRef.current;
    previousRemainingRef.current = allowance.remaining;

    if (previousRemaining === null || previousRemaining <= 0 || allowance.remaining > 0) {
      return;
    }

    const toastKey = {
      chainId: resolvedChainId,
      raterIdentityKey: allowance.raterIdentityKey,
    };

    if (hasShownExhaustionToast(toastKey)) {
      return;
    }

    markExhaustionToastShown(toastKey);
    notification.warning("Free transactions used up. Add ETH to continue.");
  }, [allowance.remaining, allowance.verified, allowance.raterIdentityKey, resolvedChainId]);

  return allowance;
}
