"use client";

import { useCallback, useEffect, useRef } from "react";
import { TransactionStatusCallout } from "~~/components/shared/TransactionStatusCallout";
import { getSubmittingTransactionStatus } from "~~/lib/ui/transactionStatusCopy";
import { notification } from "~~/utils/scaffold-eth";

interface ShowTransactionStatusToastOptions {
  action?: string;
  title?: string;
  description?: string;
}

export function useTransactionStatusToast() {
  const toastIdRef = useRef<string | null>(null);

  const dismiss = useCallback((toastId?: string | null) => {
    const targetToastId = toastId ?? toastIdRef.current;
    if (!targetToastId) {
      return;
    }

    notification.remove(targetToastId);
    if (!toastId || toastIdRef.current === targetToastId) {
      toastIdRef.current = null;
    }
  }, []);

  const showSubmitting = useCallback(
    (options: ShowTransactionStatusToastOptions = {}) => {
      const status = options.title
        ? { title: options.title, description: options.description }
        : getSubmittingTransactionStatus(options.action ?? "transaction");

      dismiss();
      toastIdRef.current = notification.loading(
        <TransactionStatusCallout
          variant="toast"
          title={status.title}
          description={options.description ?? status.description}
        />,
      );

      return toastIdRef.current;
    },
    [dismiss],
  );

  const updateSubmitting = useCallback((options: ShowTransactionStatusToastOptions) => {
    const status = options.title
      ? { title: options.title, description: options.description }
      : getSubmittingTransactionStatus(options.action ?? "transaction");

    if (toastIdRef.current) {
      notification.remove(toastIdRef.current);
    }

    toastIdRef.current = notification.loading(
      <TransactionStatusCallout
        variant="toast"
        title={status.title}
        description={options.description ?? status.description ?? ""}
      />,
    );

    return toastIdRef.current;
  }, []);

  useEffect(() => dismiss, [dismiss]);

  return {
    dismiss,
    showSubmitting,
    updateSubmitting,
  };
}
