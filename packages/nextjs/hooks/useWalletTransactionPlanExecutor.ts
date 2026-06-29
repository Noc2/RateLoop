"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GetCallsStatusReturnType, Hex, TransactionReceipt } from "viem";
import { useAccount, useConfig, useSendCallsSync } from "wagmi";
import { getPublicClient, sendTransaction } from "wagmi/actions";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionFlowToast } from "~~/hooks/useTransactionFlowToast";
import { useWalletExecutionCapabilities } from "~~/hooks/useWalletExecutionCapabilities";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";
import {
  type NormalizedWalletTransactionPlanCall,
  WALLET_TRANSACTION_PLAN_RECEIPT_TIMEOUT_MS,
  type WalletTransactionPlanCall,
  type WalletTransactionPlanExecutionSegment,
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
import { waitForTransactionReceiptWithRetry } from "~~/lib/transactions/receiptWait";
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

function canTransportWalletPlanSegmentWithThirdweb<TCall extends WalletTransactionPlanCall>(
  segment: WalletTransactionPlanExecutionSegment<TCall>,
) {
  return (
    segment.calls.length > 0 &&
    segment.calls.every(call => call.postCallDelayMs === 0 && !isWalletTransactionPlanReserveSubmissionCall(call.call))
  );
}

export function useWalletTransactionPlanExecutor() {
  const wagmiConfig = useConfig();
  const queryClient = useQueryClient();
  const { address, connector } = useAccount();
  const { sendCallsSyncAsync } = useSendCallsSync();
  const { hasSendCalls, isThirdwebInApp, supportsAtomicBatchCalls } = useWalletExecutionCapabilities();
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredBatchCalls,
    executeContractCallBatch,
    isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredBatchCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const flowToast = useTransactionFlowToast();
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedBatchCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredBatchCalls,
  });

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
        onTiming?: (event: string, extra?: Record<string, unknown>) => void;
      },
    ): Promise<TransactionReceipt> => {
      options.onTiming?.("sequential-wallet-request-start");
      const hash = await withWalletTransactionPlanStepTimeout(
        sendTransaction(wagmiConfig, {
          chainId: options.chainId,
          data: call.data,
          to: call.to,
          value: call.value,
        }),
      );
      options.onTiming?.("sequential-wallet-request-complete", { transactionHashCount: 1 });
      pushUniqueHash(options.hashes, hash);
      options.onCallSent?.({ call: call.call, hash, index: call.index });
      options.onTiming?.("sequential-receipt-wait-start", { transactionHashCount: 1 });
      const receipt = await waitForTransactionReceiptWithRetry(wagmiConfig, {
        chainId: options.chainId,
        hash,
        pollingInterval: getTransactionStatusPollingInterval(options.chainId),
        timeout: WALLET_TRANSACTION_PLAN_RECEIPT_TIMEOUT_MS,
      });
      assertWalletTransactionPlanReceiptSucceeded(receipt);
      options.onTiming?.("sequential-receipt-wait-complete", { status: receipt.status, transactionHashCount: 1 });
      options.onCallConfirmed?.({ call: call.call, hash, index: call.index });
      if (call.postCallDelayMs > 0) {
        options.onTiming?.("sequential-post-call-delay-start", { delayMs: call.postCallDelayMs });
        await delay(call.postCallDelayMs);
        options.onTiming?.("sequential-post-call-delay-complete", { delayMs: call.postCallDelayMs });
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
        route: canUseThirdwebPlanBatchCalls
          ? "thirdweb-plan"
          : canUseAtomicWalletSendCalls
            ? "wallet-sendCalls"
            : "sequential-wallet",
        source: "wallet-transaction-plan",
        sponsorshipMode: canUseThirdwebPlanBatchCalls ? thirdwebPlanSponsorshipMode : undefined,
      });

      if (walletTransactionReadiness.isBlocked) {
        timingLog.emit("blocked", {
          message: walletTransactionReadiness.message ?? "Wallet is unavailable.",
          status: walletTransactionReadiness.status,
        });
        throw new Error(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      }

      const flowBatchOptions = canUseThirdwebPlanBatchCalls
        ? flowToast.getSponsoredBatchOptions({
            action,
            sponsorshipMode: thirdwebPlanSponsorshipMode,
          })
        : null;
      if (canUseThirdwebPlanBatchCalls) {
        flowToast.beginFlow({
          action,
          sponsored: thirdwebPlanSponsorshipMode === "sponsored",
        });
      }

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
        for (const [segmentIndex, segment] of segments.entries()) {
          const callTypes = segment.calls.map(call => getWalletTransactionPlanCallType(call.call));
          const canBatchSegment =
            canUseAtomicWalletSendCalls && segment.batchable && typeof options.chainId === "number" && connector;
          const canBatchSegmentWithThirdweb =
            canUseThirdwebPlanBatchCalls &&
            typeof options.chainId === "number" &&
            canTransportWalletPlanSegmentWithThirdweb(segment);

          timingLog.emit("segment-start", {
            callCount: segment.calls.length,
            callTypes,
            route: canBatchSegmentWithThirdweb ? "thirdweb-plan" : segment.batchable ? undefined : "sequential-wallet",
            segmentIndex,
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
                segmentIndex,
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
                  atomicRequired: segment.batchable ? (options.requiresAtomicExecution ?? true) : false,
                  parentRunId: timingLog.runId,
                  segmentIndex,
                  sponsorshipMode: thirdwebPlanSponsorshipMode,
                  ...flowBatchOptions,
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
                segmentIndex,
              });
              continue;
            } catch (error) {
              timingLog.emit("thirdweb-plan-segment-failed", {
                message: error instanceof Error ? error.message : "Unknown error",
                segmentIndex,
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
              timingLog.emit("wallet-sendCalls-segment-start", {
                callCount: segment.calls.length,
                callTypes,
                segmentIndex,
              });
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
                segmentIndex,
              });
              continue;
            } catch (error) {
              timingLog.emit("wallet-sendCalls-segment-failed", {
                message: error instanceof Error ? error.message : "Unknown error",
                segmentIndex,
              });
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
            const callType = getWalletTransactionPlanCallType(call.call);
            timingLog.emit("sequential-call-start", {
              callType,
              index: call.index,
              segmentIndex,
            });
            const receipt = await executeSequentialCall(call, {
              chainId: options.chainId,
              hashes,
              onCallConfirmed: options.onCallConfirmed,
              onCallSent: options.onCallSent,
              onTiming: (event, extra = {}) => {
                timingLog.emit(event, {
                  callType,
                  index: call.index,
                  segmentIndex,
                  ...extra,
                });
              },
            });
            timingLog.emit("sequential-call-complete", {
              callType,
              index: call.index,
              segmentIndex,
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
      } finally {
        if (canUseThirdwebPlanBatchCalls) {
          flowToast.endFlow();
        }
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
      flowToast,
      queryClient,
      sendCallsSyncAsync,
      wagmiConfig,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
      walletTransactionReadiness.status,
    ],
  );

  return {
    canUseAtomicWalletSendCalls,
    executeWalletTransactionPlan,
  };
}
