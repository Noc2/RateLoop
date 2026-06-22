"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { defineChain, prepareTransaction } from "thirdweb";
import { useActiveAccount, useActiveWallet, useActiveWalletChain, useSetActiveWallet } from "thirdweb/react";
import { sendAndConfirmCalls } from "thirdweb/wallets/eip5792";
import { type Abi, type Address, type GetCallsStatusReturnType, type Hex, encodeFunctionData } from "viem";
import { useAccount, useBalance, usePublicClient, useSendCallsSync } from "wagmi";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import {
  FREE_TRANSACTION_ALLOWANCE_QUERY_KEY,
  useFreeTransactionAllowance,
} from "~~/hooks/useFreeTransactionAllowance";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
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
import {
  isFreeTransactionExhaustedError,
  isThirdwebBundlerInfrastructureError,
  isThirdwebSponsoredExecutionRejectedError,
} from "~~/lib/transactionErrors";
import { createTransactionTimingRun } from "~~/lib/transactions/timing";
import scaffoldConfig from "~~/scaffold.config";
import {
  createThirdwebInAppWallet,
  currentThirdwebWalletMatchesWagmiAddress,
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
  allowSelfFundedFallback?: boolean;
  allowUnmeteredSponsoredCalls?: boolean;
  atomicRequired?: boolean;
  action?: string;
  sponsorshipMode?: ThirdwebBatchSponsorshipMode;
  suppressStatusToast?: boolean;
};

type ThirdwebSponsoredSubmitCallsOptions = {
  allowInAppSponsorshipSync?: boolean;
};

const THIRDWEB_BUNDLER_RETRY_DELAYS_MS = [1_000, 2_000] as const;
const THIRDWEB_BUNDLER_UNAVAILABLE_MESSAGE =
  "thirdweb transaction service is temporarily unavailable. Retry in a moment.";

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createThirdwebBatchTimingLog(params: {
  action: string;
  callCount: number;
  callTypes?: readonly string[];
  chainId: number;
  operationKey: string | null;
  route: "external-wallet" | "thirdweb";
  sponsorshipMode: ThirdwebBatchSponsorshipMode;
}) {
  return createTransactionTimingRun({
    action: params.action,
    callCount: params.callCount,
    callTypes: params.callTypes,
    chainId: params.chainId,
    consoleLabel: "thirdweb-batch-timing",
    metadata: params.operationKey ? { operationKey: params.operationKey } : undefined,
    route: params.route,
    source: "thirdweb-batch",
    sponsorshipMode: params.sponsorshipMode,
  });
}

function getTransactionStatusPollingInterval(chainId: number) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

export function shouldRetryThirdwebBundlerError(error: unknown, attemptIndex: number) {
  return isThirdwebBundlerInfrastructureError(error) && attemptIndex < THIRDWEB_BUNDLER_RETRY_DELAYS_MS.length;
}

async function retryThirdwebBundlerOperation<T>(operation: () => Promise<T>) {
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!shouldRetryThirdwebBundlerError(error, attemptIndex)) {
        throw error;
      }

      await wait(THIRDWEB_BUNDLER_RETRY_DELAYS_MS[attemptIndex]);
    }
  }
}

function createThirdwebBundlerUnavailableError(cause: unknown) {
  const error = new Error(THIRDWEB_BUNDLER_UNAVAILABLE_MESSAGE);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

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
  const isThirdwebExternalSelfFunded =
    params.executionMode === "fee_currency" &&
    params.hasSendCalls === true &&
    typeof params.activeWalletId === "string" &&
    typeof params.connectorId === "string" &&
    params.activeWalletId === params.connectorId &&
    params.supportsAtomicBatchCalls === true &&
    typeof params.chainId === "number" &&
    supportsThirdwebExecutionCapabilities(params.chainId);

  return isInAppSelfFunded || isThirdwebExternalSelfFunded || shouldUseExternalWalletSendCalls(params);
}

export function shouldUseExternalWalletSendCalls(params: {
  chainId: number | undefined;
  connectorId: string | undefined;
  executionMode: WalletExecutionMode;
  hasSendCalls?: boolean;
  isThirdwebInApp?: boolean;
  supportsAtomicBatchCalls?: boolean;
}) {
  return (
    params.executionMode === "fee_currency" &&
    params.hasSendCalls === true &&
    params.isThirdwebInApp !== true &&
    params.supportsAtomicBatchCalls === true &&
    typeof params.connectorId === "string" &&
    typeof params.chainId === "number" &&
    supportsThirdwebExecutionCapabilities(params.chainId)
  );
}

export function shouldRouteBatchThroughExternalWallet(params: {
  canUseExternalWalletSelfFundedBatchCalls: boolean;
  sponsorshipMode: ThirdwebBatchSponsorshipMode;
}) {
  return params.sponsorshipMode === "self-funded" && params.canUseExternalWalletSelfFundedBatchCalls;
}

export function shouldUseUnmeteredSponsoredBatchCalls(params: {
  chainId: number | undefined;
  connectorId: string | undefined;
  hasSendCalls?: boolean;
  isThirdwebInApp?: boolean;
}) {
  return shouldExpectSponsoredThirdwebBatchCalls(params) && params.hasSendCalls === true;
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
  return (
    isThirdwebSponsorshipDeniedError(error) ||
    isFreeTransactionExhaustedError(error) ||
    isThirdwebSponsoredExecutionRejectedError(error)
  );
}

export function shouldAttemptSelfFundedThirdwebFallback(params: {
  activeWalletId: string | undefined;
  chainId: number | undefined;
  error: unknown;
  executionMode: WalletExecutionMode;
  hasNativeGasBalance: boolean;
  hasReservedFreeTransaction: boolean;
}) {
  return (
    isThirdwebInAppWalletId(params.activeWalletId) &&
    params.executionMode === "sponsored_7702" &&
    typeof params.chainId === "number" &&
    params.hasNativeGasBalance &&
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

export function isSuccessfulCallsStatus(callsStatus: GetCallsStatusReturnType) {
  return callsStatus.status === "success";
}

export function useThirdwebSponsoredSubmitCalls(options: ThirdwebSponsoredSubmitCallsOptions = {}) {
  const allowInAppSponsorshipSync = options.allowInAppSponsorshipSync ?? true;
  const queryClient = useQueryClient();
  const activeWallet = useActiveWallet();
  const activeThirdwebAccount = useActiveAccount();
  const activeWalletId = activeWallet?.id;
  const activeWalletChain = useActiveWalletChain();
  const setActiveWallet = useSetActiveWallet();
  const { syncWalletToWagmi } = useThirdwebWagmiSync();
  const statusToast = useTransactionStatusToast();
  const { address, chainId: wagmiChainId, connector } = useAccount();
  const { sendCallsSyncAsync } = useSendCallsSync();
  const freeTransactionAllowance = useFreeTransactionAllowance({ allowInAppSponsorshipSync });
  const { executionMode, hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls } = useWalletExecutionCapabilities();
  const chainId = resolveWalletExecutionChainId(wagmiChainId, activeWalletChain?.id);
  const { data: nativeBalance } = useBalance({
    address,
    chainId,
    query: {
      enabled: typeof address === "string" && typeof chainId === "number",
    },
  });
  const publicClient = usePublicClient({ chainId });
  const usesInAppEip7702Execution = usesThirdwebInAppEip7702Execution(chainId);
  const activeWalletAccountAddress = activeWallet?.getAccount()?.address;
  const activeWalletAdminAddress = activeWallet?.getAdminAccount?.()?.address;
  const activeWalletMatchesWagmiAddress = currentThirdwebWalletMatchesWagmiAddress({
    activeThirdwebAccountAddress: activeThirdwebAccount?.address,
    activeWalletAccountAddress,
    thirdwebAdminAddress: activeWalletAdminAddress,
    wagmiAddress: address,
  });

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

  const prefersExternalWalletBatchCalls = useMemo(
    () =>
      shouldUseExternalWalletSendCalls({
        chainId,
        connectorId: connector?.id,
        executionMode,
        hasSendCalls,
        isThirdwebInApp,
        supportsAtomicBatchCalls,
      }),
    [chainId, connector?.id, executionMode, hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls],
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
      activeWalletMatchesWagmiAddress &&
      typeof chainId === "number" &&
      hasSendCalls &&
      prefersSponsoredBatchCalls &&
      !isInspectingSponsoredDelegation &&
      !hasBrokenSponsoredDelegation,
  );
  const canUseUnmeteredSponsoredSubmitCalls = Boolean(
    thirdwebClient &&
      activeWallet &&
      activeWalletMatchesWagmiAddress &&
      typeof chainId === "number" &&
      !isInspectingSponsoredDelegation &&
      !hasBrokenSponsoredDelegation &&
      shouldUseUnmeteredSponsoredBatchCalls({
        chainId,
        connectorId: connector?.id,
        hasSendCalls,
        isThirdwebInApp,
      }),
  );
  const canUseThirdwebSelfFundedBatchCalls = Boolean(
    thirdwebClient &&
      activeWallet &&
      activeWalletMatchesWagmiAddress &&
      typeof chainId === "number" &&
      hasSendCalls &&
      prefersSelfFundedBatchCalls &&
      (!activeWalletId || isThirdwebInApp || activeWalletId === connector?.id),
  );
  const canUseExternalWalletSelfFundedBatchCalls = Boolean(
    typeof address === "string" && connector && typeof chainId === "number" && prefersExternalWalletBatchCalls,
  );
  const canUseSelfFundedBatchCalls = canUseThirdwebSelfFundedBatchCalls || canUseExternalWalletSelfFundedBatchCalls;
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
      keepalive: true,
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
      const allowUnmeteredSponsoredCalls = options.allowUnmeteredSponsoredCalls ?? false;
      const allowSelfFundedFallback = options.allowSelfFundedFallback ?? true;
      const canUseExternalWalletPath = shouldRouteBatchThroughExternalWallet({
        canUseExternalWalletSelfFundedBatchCalls,
        sponsorshipMode,
      });
      const canUseThirdwebPath =
        sponsorshipMode === "sponsored"
          ? allowUnmeteredSponsoredCalls
            ? canUseUnmeteredSponsoredSubmitCalls
            : canUseSponsoredSubmitCalls
          : canUseThirdwebSelfFundedBatchCalls;
      const canUseRequestedMode =
        sponsorshipMode === "sponsored"
          ? allowUnmeteredSponsoredCalls
            ? canUseUnmeteredSponsoredSubmitCalls
            : canUseSponsoredSubmitCalls
          : canUseSelfFundedBatchCalls;

      if (
        !canUseExternalWalletPath &&
        client &&
        activeWallet &&
        typeof chainId === "number" &&
        !activeWalletMatchesWagmiAddress
      ) {
        throw new Error("Wallet reconnecting. Retry in a moment.");
      }

      if (typeof chainId !== "number" || !canUseRequestedMode) {
        throw new Error("Batch calls are unavailable.");
      }

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
      if (!canUseExternalWalletPath && (!client || !activeWallet || !canUseThirdwebPath)) {
        throw new Error("Thirdweb batch calls are unavailable.");
      }

      const chain = defineChain(chainId);
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
      const hasNativeGasBalance = (nativeBalance?.value ?? 0n) > 0n;
      const timingLog = createThirdwebBatchTimingLog({
        action: options.action ?? "transaction",
        callCount: calls.length,
        callTypes: calls.map(call => call.functionName),
        chainId,
        operationKey,
        route: canUseExternalWalletPath ? "external-wallet" : "thirdweb",
        sponsorshipMode,
      });
      const sendCallsWithExternalWallet = async () => {
        if (!address || !connector) {
          throw new Error("Wallet reconnecting. Retry in a moment.");
        }

        timingLog.emit("external-wallet-sendCalls-start");
        return sendCallsSyncAsync({
          account: address as Address,
          calls: encodedCalls,
          chainId,
          connector,
          forceAtomic: options.atomicRequired ?? true,
          pollingInterval: getTransactionStatusPollingInterval(chainId),
          status: isSuccessfulCallsStatus,
          throwOnFailure: true,
          timeout: 120_000,
        } as never);
      };
      const preparedCalls = canUseExternalWalletPath
        ? []
        : encodedCalls.map(call =>
            prepareTransaction({
              chain,
              client: client!,
              data: call.data,
              to: call.to,
              ...(typeof call.value !== "undefined" ? { value: call.value } : {}),
            }),
          );
      const sendCallsWithWallet = async (wallet: NonNullable<typeof activeWallet>) =>
        retryThirdwebBundlerOperation(() => {
          timingLog.emit("thirdweb-sendAndConfirmCalls-start", {
            walletId: wallet.id,
          });
          return sendAndConfirmCalls({
            atomicRequired: options.atomicRequired ?? false,
            calls: preparedCalls,
            wallet,
          });
        });
      const getSponsoredWalletForUnmeteredCall = async () => {
        if (
          sponsorshipMode !== "sponsored" ||
          !allowUnmeteredSponsoredCalls ||
          !isThirdwebInAppWalletId(activeWallet!.id) ||
          executionMode === "sponsored_7702"
        ) {
          return activeWallet!;
        }

        const sponsoredWallet = createThirdwebInAppWallet(chainId, {
          sponsorshipMode: "sponsored",
        });

        timingLog.emit("sponsored-wallet-autoconnect-start");
        await sponsoredWallet.autoConnect({
          chain,
          client: client!,
        });
        timingLog.emit("sponsored-wallet-autoconnect-complete");

        return sponsoredWallet;
      };

      try {
        if (!options.suppressStatusToast) {
          statusToast.showSubmitting({ action: options.action ?? "transaction" });
          timingLog.emit("status-toast-shown");
        }

        const result = canUseExternalWalletPath
          ? await sendCallsWithExternalWallet()
          : await sendCallsWithWallet(await getSponsoredWalletForUnmeteredCall());
        timingLog.emit("send-and-confirm-complete", {
          receiptCount: result.receipts?.length ?? 0,
          status: result.status,
        });

        if (result.status !== "success") {
          const error = new Error("Batch calls failed.");
          (error as Error & { callsStatus?: typeof result }).callsStatus = result;
          throw error;
        }

        if (shouldConfirmSponsoredUsage && operationKey && address) {
          const transactionHashes = (result.receipts ?? [])
            .map(receipt => receipt.transactionHash)
            .filter((hash): hash is Hex => typeof hash === "string");

          if (transactionHashes.length > 0) {
            timingLog.emit("free-transaction-confirm-scheduled", {
              transactionHashCount: transactionHashes.length,
            });
            void postFreeTransactionMutation("/api/transactions/free/confirm", {
              address,
              chainId,
              operationKey,
              transactionHashes,
            })
              .then(() => {
                timingLog.emit("free-transaction-confirm-complete", {
                  transactionHashCount: transactionHashes.length,
                });
              })
              .catch(error => {
                timingLog.emit("free-transaction-confirm-failed", {
                  message: error instanceof Error ? error.message : "Unknown error",
                });
                console.error("Failed to confirm sponsored free transaction usage:", error);
              })
              .finally(() => {
                void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
              });
          }
        }

        void refreshActiveWalletReadQueries(queryClient);
        timingLog.emit("success");
        return result;
      } catch (error) {
        if (
          allowSelfFundedFallback &&
          sponsorshipMode === "sponsored" &&
          activeWallet &&
          shouldAttemptSelfFundedThirdwebFallback({
            activeWalletId: activeWallet.id,
            chainId,
            error,
            executionMode,
            hasNativeGasBalance,
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

            timingLog.emit("self-funded-fallback-autoconnect-start");
            await fallbackWallet.autoConnect({
              chain,
              client: client!,
            });
            timingLog.emit("self-funded-fallback-autoconnect-complete");

            const fallbackResult = await sendCallsWithWallet(fallbackWallet);
            timingLog.emit("self-funded-fallback-complete", {
              receiptCount: fallbackResult.receipts?.length ?? 0,
              status: fallbackResult.status,
            });

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

            void refreshActiveWalletReadQueries(queryClient);
            timingLog.emit("success", { fallback: "self-funded" });
            return fallbackResult;
          } catch (fallbackError) {
            error = fallbackError;
          }
        }

        if (isThirdwebBundlerInfrastructureError(error)) {
          timingLog.emit("failure", {
            bundlerInfrastructureError: true,
            message: error instanceof Error ? error.message : "Unknown error",
          });
          throw createThirdwebBundlerUnavailableError(error);
        }

        timingLog.emit("failure", {
          message: error instanceof Error ? error.message : "Unknown error",
        });
        throw error;
      } finally {
        statusToast.dismiss();
        void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      }
    },
    [
      activeWallet,
      activeWalletMatchesWagmiAddress,
      address,
      canUseExternalWalletSelfFundedBatchCalls,
      canUseSelfFundedBatchCalls,
      canUseSponsoredSubmitCalls,
      canUseThirdwebSelfFundedBatchCalls,
      canUseUnmeteredSponsoredSubmitCalls,
      chainId,
      connector,
      executionMode,
      freeTransactionAllowance.canUseFreeTransactions,
      nativeBalance?.value,
      postFreeTransactionMutation,
      queryClient,
      sendCallsSyncAsync,
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
    canUseUnmeteredSponsoredSubmitCalls,
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
