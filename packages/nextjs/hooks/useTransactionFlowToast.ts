"use client";

import { useCallback, useRef } from "react";
import type { ThirdwebBatchSponsorshipMode } from "~~/hooks/useThirdwebSponsoredSubmitCalls";
import { useTransactionStatusToast } from "~~/hooks/useTransactionStatusToast";
import {
  type TransactionFlowToastParams,
  resolveFlowSlowStatus,
  resolveFlowSubmittingStatus,
} from "~~/lib/ui/transactionFlowToast";

type TransactionFlowBatchOptions = {
  onSlowSubmit?: () => void;
  suppressStatusToast: true;
};

type FlowSponsoredBatchOptions = TransactionFlowBatchOptions & {
  action: string;
  sponsorshipMode: ThirdwebBatchSponsorshipMode;
};

export function useTransactionFlowToast() {
  const statusToast = useTransactionStatusToast();
  const flowRef = useRef<TransactionFlowToastParams | null>(null);

  const beginFlow = useCallback(
    (params: TransactionFlowToastParams) => {
      flowRef.current = params;
      return statusToast.showSubmitting(resolveFlowSubmittingStatus(params));
    },
    [statusToast],
  );

  const updateSlowFlow = useCallback(() => {
    const params = flowRef.current;
    if (!params) return null;
    const status = resolveFlowSlowStatus(params);
    return statusToast.updateSubmitting(status);
  }, [statusToast]);

  const endFlow = useCallback(() => {
    flowRef.current = null;
    statusToast.dismiss();
  }, [statusToast]);

  const getFlowBatchOptions = useCallback((): TransactionFlowBatchOptions => {
    return {
      onSlowSubmit: () => {
        updateSlowFlow();
      },
      suppressStatusToast: true,
    };
  }, [updateSlowFlow]);

  const getSponsoredBatchOptions = useCallback(
    (params: { action: string; sponsorshipMode: ThirdwebBatchSponsorshipMode }): FlowSponsoredBatchOptions => ({
      ...getFlowBatchOptions(),
      ...params,
    }),
    [getFlowBatchOptions],
  );

  return {
    beginFlow,
    endFlow,
    getFlowBatchOptions,
    getSponsoredBatchOptions,
    updateSlowFlow,
  };
}
