"use client";

import { useCallback } from "react";
import type { Abi, Hex } from "viem";
import { useThirdwebSponsoredSubmitCalls } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useWalletTransactionReadiness } from "~~/hooks/useWalletTransactionReadiness";

type ThirdwebBatchedContractCall = {
  abi: Abi;
  address: `0x${string}`;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

type BatchedContractWriteOptions = {
  action: string;
  allowSelfFundedFallback?: boolean;
  suppressStatusToast?: boolean;
};

export function useThirdwebBatchedContractWrite() {
  const {
    canUseSelfFundedBatchCalls,
    canUseSponsoredSubmitCalls,
    executeSponsoredCalls,
    isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredSubmitCalls,
  } = useThirdwebSponsoredSubmitCalls();
  const canUseBatchedContractWrites = canUseSponsoredSubmitCalls || canUseSelfFundedBatchCalls;
  const batchSponsorshipMode = canUseSponsoredSubmitCalls ? "sponsored" : "self-funded";
  const walletTransactionReadiness = useWalletTransactionReadiness({
    includeExternalSendCalls: true,
    isAwaitingSelfFundedWallet: isAwaitingSelfFundedSubmitCalls,
    isAwaitingSponsoredWallet: isAwaitingSponsoredSubmitCalls,
  });

  const writeContractOrBatch = useCallback(
    async (
      call: ThirdwebBatchedContractCall,
      directWrite: () => Promise<Hex | undefined>,
      options: BatchedContractWriteOptions,
    ) => {
      if (walletTransactionReadiness.isBlocked) {
        throw new Error(walletTransactionReadiness.message ?? "Wallet is unavailable.");
      }

      if (canUseBatchedContractWrites) {
        const result = await executeSponsoredCalls([call], {
          action: options.action,
          allowSelfFundedFallback: options.allowSelfFundedFallback,
          sponsorshipMode: batchSponsorshipMode,
          suppressStatusToast: options.suppressStatusToast,
        });
        return result.receipts?.[0]?.transactionHash as Hex | undefined;
      }

      return directWrite();
    },
    [
      batchSponsorshipMode,
      canUseBatchedContractWrites,
      executeSponsoredCalls,
      walletTransactionReadiness.isBlocked,
      walletTransactionReadiness.message,
    ],
  );

  return {
    canUseBatchedContractWrites,
    isAwaitingBatchedWallet: isAwaitingSelfFundedSubmitCalls || isAwaitingSponsoredSubmitCalls,
    walletTransactionReadiness,
    writeContractOrBatch,
  };
}
