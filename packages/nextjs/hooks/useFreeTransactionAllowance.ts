"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { defineChain } from "thirdweb";
import { useActiveWallet, useActiveWalletChain, useSetActiveWallet } from "thirdweb/react";
import { useAccount } from "wagmi";
import { useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { resolveWalletExecutionChainId } from "~~/hooks/useWalletExecutionCapabilities";
import {
  createThirdwebInAppWallet,
  getThirdwebWalletSponsorshipMode,
  isThirdwebInAppWalletId,
  setStoredThirdwebSponsorshipMode,
  supportsThirdwebInAppExecutionCapabilities,
  thirdwebClient,
} from "~~/services/thirdweb/client";
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

export function useFreeTransactionAllowance() {
  const { address, chain } = useAccount();
  const activeWallet = useActiveWallet();
  const activeWalletChain = useActiveWalletChain();
  const setActiveWallet = useSetActiveWallet();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const previousRemainingRef = useRef<number | null>(null);
  const sponsorshipSyncAttemptRef = useRef<string | null>(null);
  const resolvedChainId = resolveWalletExecutionChainId(chain?.id, activeWalletChain?.id);
  const supportsInAppExecution = supportsThirdwebInAppExecutionCapabilities(resolvedChainId);

  const query = useQuery({
    queryKey: getFreeTransactionAllowanceQueryKey(address, resolvedChainId),
    queryFn: async () => {
      const response = await fetch(`/api/transactions/free/session?address=${address}&chainId=${resolvedChainId}`);
      const body = (await response.json().catch(() => null)) as
        | FreeTransactionAllowanceResponse
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error((body as { error?: string } | null)?.error || "Failed to load free transaction summary");
      }

      return body as FreeTransactionAllowanceResponse;
    },
    enabled: Boolean(address) && typeof resolvedChainId === "number",
    staleTime: 30_000,
    // M-2 (2026-05-22 audit): a single transient 5xx previously locked the hook into
    // {isResolved: false} for the rest of the session, blocking sponsored transactions
    // for users who would have recovered immediately on the next request. Retry with a
    // short exponential backoff and cap at 30s so a sustained outage still surfaces.
    retry: 2,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30_000),
  });

  const fallbackSummary = useMemo(
    () => (query.data ? null : readStoredFreeTransactionAllowanceSummary(address, resolvedChainId)),
    [address, query.data, resolvedChainId],
  );

  useEffect(() => {
    if (!query.data) {
      return;
    }

    storeFreeTransactionAllowanceSummary(query.data, address, resolvedChainId);
  }, [address, query.data, resolvedChainId]);

  const allowance = useMemo(() => {
    const summary = query.data ?? fallbackSummary;
    const canUseFreeTransactions = Boolean(supportsInAppExecution && summary?.verified && summary.remaining > 0);

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
  }, [fallbackSummary, query, supportsInAppExecution]);

  const desiredSponsorshipMode = useMemo(() => {
    if (!resolvedChainId || !supportsInAppExecution || !allowance.isResolved) {
      return null;
    }

    return allowance.canUseFreeTransactions ? "sponsored" : "self-funded";
  }, [allowance.canUseFreeTransactions, allowance.isResolved, resolvedChainId, supportsInAppExecution]);

  useEffect(() => {
    if (!resolvedChainId || !supportsInAppExecution) {
      setStoredThirdwebSponsorshipMode(null);
      return;
    }

    if (!desiredSponsorshipMode) {
      return;
    }

    setStoredThirdwebSponsorshipMode(desiredSponsorshipMode);
  }, [desiredSponsorshipMode, resolvedChainId, supportsInAppExecution]);

  useEffect(() => {
    if (
      !thirdwebClient ||
      !address ||
      !resolvedChainId ||
      !desiredSponsorshipMode ||
      !activeWallet ||
      !isThirdwebInAppWalletId(activeWallet.id)
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
  }, [activeWallet, address, desiredSponsorshipMode, resolvedChainId, setActiveWallet, syncWalletToWagmi]);

  useEffect(() => {
    if (
      !thirdwebClient ||
      !address ||
      !resolvedChainId ||
      supportsInAppExecution ||
      !activeWallet ||
      !isThirdwebInAppWalletId(activeWallet.id) ||
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
        const replacementWallet = createThirdwebInAppWallet(resolvedChainId);

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
  }, [activeWallet, address, resolvedChainId, setActiveWallet, supportsInAppExecution, syncWalletToWagmi]);

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
