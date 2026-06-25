"use client";

import { createElement, useCallback } from "react";
import { TransactionStatusCallout } from "~~/components/shared/TransactionStatusCallout";
import {
  SPONSORED_TRANSACTION_DELAY_NOTICE_ID,
  getSponsoredTransactionDelayNotice,
} from "~~/lib/ui/sponsoredTransactionNotice";
import { notification } from "~~/utils/scaffold-eth";

const SPONSORED_TRANSACTION_DELAY_NOTICE_DURATION_MS = 10_000;

export function useSponsoredTransactionDelayNotice() {
  return useCallback(() => {
    const notice = getSponsoredTransactionDelayNotice();

    notification.info(
      createElement(TransactionStatusCallout, {
        description: notice.description,
        title: notice.title,
        variant: "toast",
      }),
      {
        duration: SPONSORED_TRANSACTION_DELAY_NOTICE_DURATION_MS,
        id: SPONSORED_TRANSACTION_DELAY_NOTICE_ID,
        position: "top-center",
      },
    );
  }, []);
}
