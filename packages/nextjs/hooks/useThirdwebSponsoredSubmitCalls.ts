"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defineChain, prepareTransaction } from "thirdweb";
import { useActiveWallet, useActiveWalletChain, useSetActiveWallet } from "thirdweb/react";
import { sendAndConfirmCalls } from "thirdweb/wallets/eip5792";
import { type Abi, type Hex, encodeFunctionData } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  FREE_TRANSACTION_ALLOWANCE_QUERY_KEY,
  useFreeTransactionAllowance,
} from "~~/hooks/useFreeTransactionAllowance";
import { useThirdwebWagmiSync } from "~~/hooks/useThirdwebWagmiSync";
import { useTransactionStatusToast } from "~~/hooks/useTransactionStatusToast";
import {
  type WalletExecutionMode,
  resolveWalletExecutionChainId,
  useWalletExecutionCapabilities,
} from "~~/hooks/useWalletExecutionCapabilities";
import {
  getEip7702DelegationTarget,
  hasMissingEip7702DelegationImplementation,
} from "~~/lib/thirdweb/eip7702Delegation";
import { buildFreeTransactionOperationKey } from "~~/lib/thirdweb/freeTransactionOperation";
import { isFreeTransactionExhaustedError } from "~~/lib/transactionErrors";
import {
  createThirdwebInAppWallet,
  isThirdwebInAppWalletId,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
  thirdwebClient,
  usesThirdwebInAppEip7702Execution,
} from "~~/services/thirdweb/client";

type ThirdwebContractCall = {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args?: readonly unknown[];
  data?: Hex;
  value?: bigint;
};

type ThirdwebBatchSponsorshipMode = "sponsored" | "self-funded";

type ExecuteContractCallBatchOptions = {
  atomicRequired?: boolean;
  action?: string;
  sponsorshipMode?: ThirdwebBatchSponsorshipMode;
  suppressStatusToast?: boolean;
};

type ThirdwebSponsoredSubmitCallsOptions = {
  allowInAppSponsorshipSync?: boolean;
};

export function shouldPreferSponsoredBatchCalls(params: {
  canUseFreeTransactions: boolean;
  chainId: number | undefined;
  connectorId: string | undefined;
  isThirdwebInApp?: boolean;
}) {
  return params.canUseFreeTransactions && shouldExpectSponsoredThirdwebBatchCalls(params);
}

export function shouldExpectThirdwebBatchCalls(params: {
  activeWalletId?: string;
  chainId: number | undefined;
  connectorId: string | undefined;
  isThirdwebInApp?: boolean;
}) {
  const hasSettledInAppConnector =
    params.connectorId === "in-app-wallet" || (!params.connectorId && params.isThirdwebInApp === true);
  const hasSettledExternalConnector =
    typeof params.activeWalletId === "string" &&
    typeof params.connectorId === "string" &&
    params.activeWalletId === params.connectorId;

  if (typeof params.chainId !== "number") {
    return false;
  }

  if (hasSettledInAppConnector) {
    return supportsThirdwebInAppExecutionCapabilities(params.chainId);
  }

  return hasSettledExternalConnector && supportsThirdwebExecutionCapabilities(params.chainId);
}

function shouldExpectSponsoredThirdwebBatchCalls(params: {
  chainId: number | undefined;
  connectorId: string | undefined;
  isThirdwebInApp?: boolean;
}) {
  return (
    (params.connectorId === "in-app-wallet" || (!params.connectorId && params.isThirdwebInApp === true)) &&
    typeof params.chainId === "number" &&
    supportsThirdwebInAppExecutionCapabilities(params.chainId)
  );
}

export function shouldUseSelfFundedBatchCalls(params: {
  activeWalletId?: string;
  chainId: number | undefined;
  connectorId: string | undefined;
  executionMode: WalletExecutionMode;
  hasSendCalls?: boolean;
  isThirdwebInApp?: boolean;
  supportsAtomicBatchCalls?: boolean;
}) {
  const isInAppSelfFunded =
    shouldExpectSponsoredThirdwebBatchCalls(params) && params.executionMode === "self_funded_7702";
  const isExternalSelfFunded =
    params.executionMode === "fee_currency" &&
    params.hasSendCalls === true &&
    typeof params.activeWalletId === "string" &&
    typeof params.connectorId === "string" &&
    params.activeWalletId === params.connectorId &&
    params.supportsAtomicBatchCalls === true &&
    typeof params.chainId === "number" &&
    supportsThirdwebExecutionCapabilities(params.chainId);

  return isInAppSelfFunded || isExternalSelfFunded;
}

export function shouldPreferSponsoredSubmitCalls(params: {
  canUseFreeTransactions: boolean;
  chainId: number | undefined;
  connectorId: string | undefined;
  isThirdwebInApp?: boolean;
}) {
  return shouldPreferSponsoredBatchCalls(params);
}

export function shouldExpectSponsoredSubmitCalls(params: {
  chainId: number | undefined;
  connectorId: string | undefined;
  isThirdwebInApp?: boolean;
}) {
  return shouldExpectSponsoredThirdwebBatchCalls(params);
}

export function isThirdwebSponsorshipDeniedError(error: unknown) {
  const message =
    (error as { message?: string; shortMessage?: string } | undefined)?.message ??
    (error as { message?: string; shortMessage?: string } | undefined)?.shortMessage ??
    "";

  return message.toLowerCase().includes("transaction not sponsored") || isFreeTransactionExhaustedError(error);
}

export function isThirdwebSelfFundedFallbackEligibleError(error: unknown) {
  return isThirdwebSponsorshipDeniedError(error) || isFreeTransactionExhaustedError(error);
}

export function shouldAttemptSelfFundedThirdwebFallback(params: {
  activeWalletId: string | undefined;
  chainId: number | undefined;
  error: unknown;
  executionMode: WalletExecutionMode;
  hasReservedFreeTransaction: boolean;
}) {
  return (
    isThirdwebInAppWalletId(params.activeWalletId) &&
    params.executionMode === "sponsored_7702" &&
    typeof params.chainId === "number" &&
    !params.hasReservedFreeTransaction &&
    isThirdwebSelfFundedFallbackEligibleError(params.error)
  );
}

export function shouldAwaitSelfFundedSubmitCalls(params: {
  canUseFreeTransactions: boolean;
  chainId: number | undefined;
  connectorId: string | undefined;
  executionMode: WalletExecutionMode;
  freeTransactionAllowanceResolved: boolean;
  isThirdwebInApp?: boolean;
}) {
  return (
    shouldExpectThirdwebBatchCalls(params) &&
    params.freeTransactionAllowanceResolved &&
    !params.canUseFreeTransactions &&
    params.executionMode === "sponsored_7702"
  );
}

export function shouldIgnorePostTransactionFallbackWalletSyncError(callStatus: string | undefined) {
  return callStatus === "success";
}

export function useThirdwebSponsoredSubmitCalls(options: ThirdwebSponsoredSubmitCallsOptions = {}) {
  const allowInAppSponsorshipSync = options.allowInAppSponsorshipSync ?? true;
  const queryClient = useQueryClient();
  const activeWallet = useActiveWallet();
  const activeWalletId = activeWallet?.id;
  const activeWalletChain = useActiveWalletChain();
  const setActiveWallet = useSetActiveWallet();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const statusToast = useTransactionStatusToast();
  const { address, chainId: wagmiChainId, connector } = useAccount();
  const freeTransactionAllowance = useFreeTransactionAllowance({ allowInAppSponsorshipSync });
  const { executionMode, hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls } = useWalletExecutionCapabilities();
  const chainId = resolveWalletExecutionChainId(wagmiChainId, activeWalletChain?.id);
  const publicClient = usePublicClient({ chainId });
  const usesInAppEip7702Execution = usesThirdwebInAppEip7702Execution(chainId);

  const expectsSponsoredBatchCalls = useMemo(
    () =>
      shouldExpectSponsoredSubmitCalls({
        chainId,
        connectorId: connector?.id,
        isThirdwebInApp,
      }),
    [chainId, connector?.id, isThirdwebInApp],
  );

  const prefersSponsoredBatchCalls = useMemo(
    () =>
      shouldPreferSponsoredBatchCalls({
        canUseFreeTransactions: freeTransactionAllowance.canUseFreeTransactions,
        chainId,
        connectorId: connector?.id,
        isThirdwebInApp,
      }),
    [chainId, connector?.id, freeTransactionAllowance.canUseFreeTransactions, isThirdwebInApp],
  );

  const prefersSelfFundedBatchCalls = useMemo(
    () =>
      shouldUseSelfFundedBatchCalls({
        activeWalletId,
        chainId,
        connectorId: connector?.id,
        executionMode,
        hasSendCalls,
        isThirdwebInApp,
        supportsAtomicBatchCalls,
      }),
    [activeWalletId, chainId, connector?.id, executionMode, hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls],
  );

  const shouldInspectSponsoredDelegation = Boolean(
    expectsSponsoredBatchCalls &&
      usesInAppEip7702Execution &&
      executionMode === "sponsored_7702" &&
      publicClient &&
      typeof address === "string" &&
      typeof chainId === "number",
  );
  const sponsoredDelegationQuery = useQuery({
    queryKey: ["thirdweb-sponsored-delegation", chainId ?? null, address?.toLowerCase() ?? null],
    enabled: shouldInspectSponsoredDelegation,
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
  const hasBrokenSponsoredDelegation = sponsoredDelegationQuery.data?.hasMissingImplementation === true;
  const isInspectingSponsoredDelegation = shouldInspectSponsoredDelegation && sponsoredDelegationQuery.isLoading;

  const canUseGaslessSubmitTransactions = prefersSponsoredBatchCalls && !hasBrokenSponsoredDelegation;

  const isEligibleForGaslessSubmitTransactions = expectsSponsoredBatchCalls && !hasBrokenSponsoredDelegation;

  const canUseSponsoredSubmitCalls = Boolean(
    thirdwebClient &&
      activeWallet &&
      typeof chainId === "number" &&
      hasSendCalls &&
      prefersSponsoredBatchCalls &&
      !isInspectingSponsoredDelegation &&
      !hasBrokenSponsoredDelegation,
  );
  const canUseSelfFundedBatchCalls = Boolean(
    thirdwebClient && activeWallet && typeof chainId === "number" && hasSendCalls && prefersSelfFundedBatchCalls,
  );
  const isAwaitingSponsoredSubmitCalls =
    expectsSponsoredBatchCalls &&
    !hasBrokenSponsoredDelegation &&
    (!freeTransactionAllowance.isResolved ||
      isInspectingSponsoredDelegation ||
      (prefersSponsoredBatchCalls && !canUseSponsoredSubmitCalls));
  const isAwaitingSelfFundedSubmitCalls = useMemo(
    () =>
      shouldAwaitSelfFundedSubmitCalls({
        canUseFreeTransactions: freeTransactionAllowance.canUseFreeTransactions,
        chainId,
        connectorId: connector?.id,
        executionMode,
        freeTransactionAllowanceResolved: freeTransactionAllowance.isResolved,
        isThirdwebInApp,
      }),
    [
      chainId,
      connector?.id,
      executionMode,
      freeTransactionAllowance.canUseFreeTransactions,
      freeTransactionAllowance.isResolved,
      isThirdwebInApp,
    ],
  );

  const postFreeTransactionMutation = useCallback(async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      return;
    }

    const responseBody = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(responseBody?.error || "Free transaction update failed");
  }, []);

  const executeSponsoredCalls = useCallback(
    async (calls: ThirdwebContractCall[], options: ExecuteContractCallBatchOptions = {}) => {
      const client = thirdwebClient;
      const sponsorshipMode = options.sponsorshipMode ?? "sponsored";
      const canUseRequestedMode =
        sponsorshipMode === "sponsored" ? canUseSponsoredSubmitCalls : canUseSelfFundedBatchCalls;

      if (!client || !activeWallet || typeof chainId !== "number" || !canUseRequestedMode) {
        throw new Error("Thirdweb batch calls are unavailable.");
      }

      const chain = defineChain(chainId);
      const encodedCalls = calls.map(call => ({
        data:
          call.data ??
          encodeFunctionData({
            abi: call.abi,
            functionName: call.functionName as never,
            args: (call.args ?? []) as never,
          }),
        to: call.address,
        ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
      }));
      const shouldConfirmSponsoredUsage =
        sponsorshipMode === "sponsored" && freeTransactionAllowance.canUseFreeTransactions;
      const operationKey =
        shouldConfirmSponsoredUsage && typeof address === "string"
          ? buildFreeTransactionOperationKey({
              chainId,
              calls: encodedCalls.map(call => ({
                data: call.data,
                to: call.to,
                value: call.value,
              })),
              sender: address,
            })
          : null;
      const preparedCalls = encodedCalls.map(call =>
        prepareTransaction({
          chain,
          client,
          data: call.data,
          to: call.to,
          ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
        }),
      );
      const sendCallsWithWallet = async (wallet: NonNullable<typeof activeWallet>) =>
        sendAndConfirmCalls({
          atomicRequired: options.atomicRequired ?? false,
          calls: preparedCalls,
          wallet,
        });

      try {
        if (!options.suppressStatusToast) {
          statusToast.showSubmitting({ action: options.action ?? "transaction" });
        }

        const result = await sendCallsWithWallet(activeWallet);

        if (result.status !== "success") {
          const error = new Error("Sponsored calls failed.");
          (error as Error & { callsStatus?: typeof result }).callsStatus = result;
          throw error;
        }

        if (shouldConfirmSponsoredUsage && operationKey && address) {
          const transactionHashes = (result.receipts ?? [])
            .map(receipt => receipt.transactionHash)
            .filter((hash): hash is Hex => typeof hash === "string");

          if (transactionHashes.length > 0) {
            try {
              await postFreeTransactionMutation("/api/transactions/free/confirm", {
                address,
                chainId,
                operationKey,
                transactionHashes,
              });
            } catch (error) {
              console.error("Failed to confirm sponsored free transaction usage:", error);
            }
          }
        }

        return result;
      } catch (error) {
        if (
          sponsorshipMode === "sponsored" &&
          shouldAttemptSelfFundedThirdwebFallback({
            activeWalletId: activeWallet.id,
            chainId,
            error,
            executionMode,
            // A locally derived operation key only identifies the payload shape.
            // The actual free-tx reservation happens server-side in the verifier,
            // and the client has no reliable signal that one was created here.
            hasReservedFreeTransaction: false,
          })
        ) {
          try {
            const fallbackWallet = createThirdwebInAppWallet(chainId, {
              sponsorshipMode: "self-funded",
            });

            await fallbackWallet.autoConnect({
              chain,
              client,
            });

            const fallbackResult = await sendCallsWithWallet(fallbackWallet);

            if (fallbackResult.status !== "success") {
              const fallbackStatusError = new Error("Self-funded calls failed.");
              (fallbackStatusError as Error & { callsStatus?: typeof fallbackResult }).callsStatus = fallbackResult;
              throw fallbackStatusError;
            }

            try {
              await syncWalletToWagmi(fallbackWallet, chainId, { reconnect: true });
              await setActiveWallet(fallbackWallet);
            } catch (syncError) {
              if (!shouldIgnorePostTransactionFallbackWalletSyncError(fallbackResult.status)) {
                throw syncError;
              }

              console.error("Self-funded fallback transaction succeeded, but wallet sync failed:", syncError);
            }

            return fallbackResult;
          } catch (fallbackError) {
            error = fallbackError;
          }
        }

        throw error;
      } finally {
        statusToast.dismiss();
        void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      }
    },
    [
      activeWallet,
      address,
      canUseSelfFundedBatchCalls,
      canUseSponsoredSubmitCalls,
      chainId,
      executionMode,
      freeTransactionAllowance.canUseFreeTransactions,
      postFreeTransactionMutation,
      queryClient,
      setActiveWallet,
      statusToast,
      syncWalletToWagmi,
    ],
  );

  const executeContractCallBatch = executeSponsoredCalls;

  return {
    canUseGaslessSubmitTransactions,
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls: canUseSponsoredSubmitCalls,
    canUseSponsoredSubmitCalls,
    executionMode,
    executeContractCallBatch,
    executeSponsoredCalls,
    freeTransactionLimit: freeTransactionAllowance.limit,
    freeTransactionRemaining: freeTransactionAllowance.remaining,
    freeTransactionVerified: freeTransactionAllowance.verified,
    isAwaitingSelfFundedBatchCalls: isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredBatchCalls: isAwaitingSponsoredSubmitCalls,
    isAwaitingFreeTransactionAllowance: isEligibleForGaslessSubmitTransactions && !freeTransactionAllowance.isResolved,
  };
}
