"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GetCallsStatusReturnType, Hex } from "viem";
import { useAccount, useConfig, useSendCallsSync } from "wagmi";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { getPollingIntervalForChainId } from "~~/config/shared";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
import { useWalletExecutionCapabilities } from "~~/hooks/useWalletExecutionCapabilities";
import {
  type NormalizedWalletTransactionPlanCall,
  type WalletTransactionPlanCall,
  createWalletTransactionPlanExecutionSegments,
  isWalletSendCallsUnsupportedError,
  normalizeWalletTransactionPlanCalls,
  segmentRequiresAtomicWalletBatch,
  walletTransactionPlanAtomicBatchRequiredError,
} from "~~/lib/agent/walletTransactionPlan";
import scaffoldConfig from "~~/scaffold.config";

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSuccessfulCallsStatus(callsStatus: GetCallsStatusReturnType) {
  return callsStatus.status === "success";
}

function collectReceiptHashes(callsStatus: GetCallsStatusReturnType) {
  return (callsStatus.receipts ?? [])
    .map(receipt => receipt.transactionHash)
    .filter((hash): hash is Hex => typeof hash === "string");
}

function pushUniqueHash(hashes: Hex[], hash: Hex | undefined) {
  if (hash && !hashes.includes(hash)) {
    hashes.push(hash);
  }
}

function getTransactionStatusPollingInterval(chainId: number | undefined) {
  return typeof chainId === "number"
    ? getPollingIntervalForChainId(chainId, 1_000, {
        preconfirmation: scaffoldConfig.useBasePreconfRpc,
      })
    : 1_000;
}

export function useWalletTransactionPlanExecutor() {
  const wagmiConfig = useConfig();
  const queryClient = useQueryClient();
  const { address, connector } = useAccount();
  const { sendCallsSyncAsync } = useSendCallsSync();
  const { hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls } = useWalletExecutionCapabilities();

  const canUseAtomicWalletSendCalls = Boolean(
    address && connector && hasSendCalls && supportsAtomicBatchCalls && isThirdwebInApp !== true,
  );

  const executeSequentialCall = useCallback(
    async <TCall extends WalletTransactionPlanCall>(
      call: NormalizedWalletTransactionPlanCall<TCall>,
      options: {
        chainId?: number;
        hashes: Hex[];
        onCallConfirmed?: (params: { call: TCall; hash: Hex; index: number }) => void;
        onCallSent?: (params: { call: TCall; hash: Hex; index: number }) => void;
      },
    ) => {
      const hash = await sendTransaction(wagmiConfig, {
        chainId: options.chainId,
        data: call.data,
        to: call.to,
        value: call.value,
      });
      pushUniqueHash(options.hashes, hash);
      options.onCallSent?.({ call: call.call, hash, index: call.index });
      await waitForTransactionReceipt(wagmiConfig, {
        chainId: options.chainId,
        hash,
        pollingInterval: getTransactionStatusPollingInterval(options.chainId),
      });
      options.onCallConfirmed?.({ call: call.call, hash, index: call.index });
      if (call.postCallDelayMs > 0) {
        await delay(call.postCallDelayMs);
      }
    },
    [wagmiConfig],
  );

  const executeWalletTransactionPlan = useCallback(
    async <TCall extends WalletTransactionPlanCall>(options: {
      calls: readonly TCall[];
      chainId?: number;
      getPostCallDelayMs?: (call: TCall) => number;
      onCallConfirmed?: (params: { call: TCall; hash: Hex | undefined; index: number }) => void;
      onCallSent?: (params: { call: TCall; hash: Hex | undefined; index: number }) => void;
      requiresAtomicExecution?: boolean;
      requiresOrderedExecution?: boolean;
    }) => {
      const hashes: Hex[] = [];
      const normalizedCalls = normalizeWalletTransactionPlanCalls(options.calls, {
        getPostCallDelayMs: options.getPostCallDelayMs,
      });
      const segments = createWalletTransactionPlanExecutionSegments(normalizedCalls);

      for (const segment of segments) {
        const canBatchSegment =
          canUseAtomicWalletSendCalls && segment.batchable && typeof options.chainId === "number" && connector;

        if (canBatchSegment) {
          try {
            const callsStatus = await sendCallsSyncAsync({
              account: address as `0x${string}`,
              calls: segment.calls.map(call => ({
                data: call.data,
                to: call.to,
                ...(call.value > 0n ? { value: call.value } : {}),
              })),
              chainId: options.chainId,
              connector,
              forceAtomic: true,
              pollingInterval: getTransactionStatusPollingInterval(options.chainId),
              status: isSuccessfulCallsStatus,
              throwOnFailure: true,
              timeout: 120_000,
            } as never);
            const receiptHashes = collectReceiptHashes(callsStatus);
            const representativeHash = receiptHashes[0];
            for (const hash of receiptHashes) {
              pushUniqueHash(hashes, hash);
            }
            for (const call of segment.calls) {
              options.onCallSent?.({ call: call.call, hash: representativeHash, index: call.index });
              options.onCallConfirmed?.({ call: call.call, hash: representativeHash, index: call.index });
            }
            continue;
          } catch (error) {
            if (!isWalletSendCallsUnsupportedError(error)) {
              throw error;
            }
            if (segmentRequiresAtomicWalletBatch(segment, options)) {
              throw walletTransactionPlanAtomicBatchRequiredError();
            }
          }
        } else if (segmentRequiresAtomicWalletBatch(segment, options)) {
          throw walletTransactionPlanAtomicBatchRequiredError();
        }

        for (const call of segment.calls) {
          await executeSequentialCall(call, {
            chainId: options.chainId,
            hashes,
            onCallConfirmed: options.onCallConfirmed,
            onCallSent: options.onCallSent,
          });
        }
      }

      void refreshActiveWalletReadQueries(queryClient);
      return hashes;
    },
    [address, canUseAtomicWalletSendCalls, connector, executeSequentialCall, queryClient, sendCallsSyncAsync],
  );

  return {
    canUseAtomicWalletSendCalls,
    executeWalletTransactionPlan,
  };
}
