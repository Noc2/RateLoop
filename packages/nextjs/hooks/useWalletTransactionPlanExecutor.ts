"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GetCallsStatusReturnType, Hex, TransactionReceipt } from "viem";
import { useAccount, useConfig, useSendCallsSync } from "wagmi";
import { getPublicClient, sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletExecutionCapabilities } from "~~/hooks/useWalletExecutionCapabilities";
import {
  type NormalizedWalletTransactionPlanCall,
  WALLET_TRANSACTION_PLAN_RECEIPT_TIMEOUT_MS,
  type WalletTransactionPlanCall,
  assertWalletTransactionPlanReceiptSucceeded,
  createWalletTransactionPlanExecutionSegments,
  isWalletSendCallsUnsupportedError,
  isWalletTransactionPlanReservationRevealCall,
  isWalletTransactionPlanReserveSubmissionCall,
  normalizeWalletTransactionPlanCalls,
  segmentRequiresAtomicWalletBatch,
  walletTransactionPlanAtomicBatchRequiredError,
  withWalletTransactionPlanStepTimeout,
} from "~~/lib/agent/walletTransactionPlan";
import { waitForReservationRevealReady } from "~~/lib/submission/reservationRevealWait";
import { createTransactionTimingRun } from "~~/lib/transactions/timing";
import scaffoldConfig from "~~/scaffold.config";

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isSuccessfulCallsStatus(callsStatus: GetCallsStatusReturnType) {
  return callsStatus.status === "success";
}

function collectReceiptHashes(callsStatus: { receipts?: readonly { transactionHash?: unknown }[] }) {
  return (callsStatus.receipts ?? [])
    .map(receipt => receipt.transactionHash)
    .filter((hash): hash is Hex => typeof hash === "string");
}

function pushUniqueHash(hashes: Hex[], hash: Hex | undefined) {
  if (hash && !hashes.includes(hash)) {
    hashes.push(hash);
  }
}

function getWalletTransactionPlanCallType(call: WalletTransactionPlanCall) {
  return call.functionName || call.phase || call.id || call.description || "walletCall";
}

function getTransactionStatusPollingInterval(chainId: number | undefined) {
  return getTransactionReceiptPollingInterval(chainId, {
    preconfirmation: scaffoldConfig.useBasePreconfRpc,
  });
}

export function useWalletTransactionPlanExecutor() {
  const wagmiConfig = useConfig();
  const queryClient = useQueryClient();
  const { address, connector } = useAccount();
  const { sendCallsSyncAsync } = useSendCallsSync();
  const { hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls } = useWalletExecutionCapabilities();
  const { canUseSelfFundedBatchCalls, canUseSponsoredBatchCalls, executeContractCallBatch } =
    useThirdwebSponsoredSubmitCalls();

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
    ): Promise<TransactionReceipt> => {
      const hash = await withWalletTransactionPlanStepTimeout(
        sendTransaction(wagmiConfig, {
          chainId: options.chainId,
          data: call.data,
          to: call.to,
          value: call.value,
        }),
      );
      pushUniqueHash(options.hashes, hash);
      options.onCallSent?.({ call: call.call, hash, index: call.index });
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        chainId: options.chainId,
        hash,
        pollingInterval: getTransactionStatusPollingInterval(options.chainId),
        timeout: WALLET_TRANSACTION_PLAN_RECEIPT_TIMEOUT_MS,
      });
      assertWalletTransactionPlanReceiptSucceeded(receipt);
      options.onCallConfirmed?.({ call: call.call, hash, index: call.index });
      if (call.postCallDelayMs > 0) {
        await delay(call.postCallDelayMs);
      }
      return receipt;
    },
    [wagmiConfig],
  );

  const executeWalletTransactionPlan = useCallback(
    async <TCall extends WalletTransactionPlanCall>(options: {
      action?: string;
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
      let latestReservationReceipt: TransactionReceipt | null = null;
      const canUseThirdwebPlanBatchCalls =
        canUseSponsoredBatchCalls || (!canUseAtomicWalletSendCalls && canUseSelfFundedBatchCalls);
      const thirdwebPlanSponsorshipMode = canUseSponsoredBatchCalls ? "sponsored" : "self-funded";
      const action = options.action ?? "wallet transaction plan";
      const timingLog = createTransactionTimingRun({
        action,
        callCount: normalizedCalls.length,
        callTypes: normalizedCalls.map(call => getWalletTransactionPlanCallType(call.call)),
        chainId: options.chainId,
        consoleLabel: "wallet-transaction-plan-timing",
        route: canUseThirdwebPlanBatchCalls
          ? "thirdweb-plan"
          : canUseAtomicWalletSendCalls
            ? "wallet-sendCalls"
            : "sequential-wallet",
        source: "wallet-transaction-plan",
        sponsorshipMode: canUseThirdwebPlanBatchCalls ? thirdwebPlanSponsorshipMode : undefined,
      });

      const waitForReservationRevealIfNeeded = async (call: NormalizedWalletTransactionPlanCall<TCall>) => {
        if (!latestReservationReceipt || !isWalletTransactionPlanReservationRevealCall(call.call)) return;
        const publicClient =
          typeof options.chainId === "number" ? getPublicClient(wagmiConfig, { chainId: options.chainId }) : null;
        if (!publicClient) {
          await delay(1_000);
          latestReservationReceipt = null;
          return;
        }
        await waitForReservationRevealReady({
          client: publicClient,
          pollingIntervalMs: getTransactionStatusPollingInterval(options.chainId),
          receipt: latestReservationReceipt,
        });
        latestReservationReceipt = null;
      };

      try {
        for (const segment of segments) {
          const callTypes = segment.calls.map(call => getWalletTransactionPlanCallType(call.call));
          const canBatchSegment =
            canUseAtomicWalletSendCalls && segment.batchable && typeof options.chainId === "number" && connector;
          const canBatchSegmentWithThirdweb =
            canUseThirdwebPlanBatchCalls && segment.batchable && typeof options.chainId === "number";

          timingLog.emit("segment-start", {
            callCount: segment.calls.length,
            callTypes,
            route: segment.batchable ? undefined : "sequential-wallet",
          });

          if (canBatchSegmentWithThirdweb) {
            const revealCall = segment.calls.find(call => isWalletTransactionPlanReservationRevealCall(call.call));
            if (revealCall) {
              await waitForReservationRevealIfNeeded(revealCall);
            }
            try {
              timingLog.emit("thirdweb-plan-segment-start", {
                callCount: segment.calls.length,
                callTypes,
                sponsorshipMode: thirdwebPlanSponsorshipMode,
              });
              const callsStatus = await executeContractCallBatch(
                segment.calls.map(call => ({
                  abi: [],
                  address: call.to as `0x${string}`,
                  data: call.data,
                  functionName: getWalletTransactionPlanCallType(call.call),
                  ...(call.value > 0n ? { value: call.value } : {}),
                })),
                {
                  action,
                  atomicRequired: options.requiresAtomicExecution ?? true,
                  sponsorshipMode: thirdwebPlanSponsorshipMode,
                  suppressStatusToast: true,
                },
              );
              const receiptHashes = collectReceiptHashes(callsStatus);
              const representativeHash = receiptHashes[0];
              for (const hash of receiptHashes) {
                pushUniqueHash(hashes, hash);
              }
              for (const call of segment.calls) {
                options.onCallSent?.({ call: call.call, hash: representativeHash, index: call.index });
                options.onCallConfirmed?.({ call: call.call, hash: representativeHash, index: call.index });
              }
              timingLog.emit("thirdweb-plan-segment-complete", {
                callCount: segment.calls.length,
                receiptCount: receiptHashes.length,
              });
              continue;
            } catch (error) {
              timingLog.emit("thirdweb-plan-segment-failed", {
                message: error instanceof Error ? error.message : "Unknown error",
              });
              if (segmentRequiresAtomicWalletBatch(segment, options)) {
                throw error;
              }
            }
          }

          if (canBatchSegment) {
            const revealCall = segment.calls.find(call => isWalletTransactionPlanReservationRevealCall(call.call));
            if (revealCall) {
              await waitForReservationRevealIfNeeded(revealCall);
            }
            try {
              const callsStatus = await withWalletTransactionPlanStepTimeout(
                sendCallsSyncAsync({
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
                  timeout: WALLET_TRANSACTION_PLAN_RECEIPT_TIMEOUT_MS,
                } as never),
              );
              const receiptHashes = collectReceiptHashes(callsStatus);
              const representativeHash = receiptHashes[0];
              for (const hash of receiptHashes) {
                pushUniqueHash(hashes, hash);
              }
              for (const call of segment.calls) {
                options.onCallSent?.({ call: call.call, hash: representativeHash, index: call.index });
                options.onCallConfirmed?.({ call: call.call, hash: representativeHash, index: call.index });
              }
              timingLog.emit("wallet-sendCalls-segment-complete", {
                callCount: segment.calls.length,
                receiptCount: receiptHashes.length,
              });
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
            await waitForReservationRevealIfNeeded(call);
            timingLog.emit("sequential-call-start", {
              callType: getWalletTransactionPlanCallType(call.call),
              index: call.index,
            });
            const receipt = await executeSequentialCall(call, {
              chainId: options.chainId,
              hashes,
              onCallConfirmed: options.onCallConfirmed,
              onCallSent: options.onCallSent,
            });
            timingLog.emit("sequential-call-complete", {
              callType: getWalletTransactionPlanCallType(call.call),
              index: call.index,
            });
            if (isWalletTransactionPlanReserveSubmissionCall(call.call)) {
              latestReservationReceipt = receipt;
            }
          }
        }

        void refreshActiveWalletReadQueries(queryClient);
        timingLog.emit("success", { transactionHashCount: hashes.length });
        return hashes;
      } catch (error) {
        timingLog.emit("failure", {
          message: error instanceof Error ? error.message : "Unknown error",
          transactionHashCount: hashes.length,
        });
        throw error;
      }
    },
    [
      address,
      canUseAtomicWalletSendCalls,
      canUseSelfFundedBatchCalls,
      canUseSponsoredBatchCalls,
      connector,
      executeContractCallBatch,
      executeSequentialCall,
      queryClient,
      sendCallsSyncAsync,
      wagmiConfig,
    ],
  );

  return {
    canUseAtomicWalletSendCalls,
    executeWalletTransactionPlan,
  };
}
