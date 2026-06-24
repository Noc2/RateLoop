import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hash, PublicClient, SendTransactionParameters, TransactionReceipt, WalletClient } from "viem";
import { Config, useConfig, useWalletClient } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { SendTransactionMutate } from "wagmi/query";
import { TransactionStatusCallout } from "~~/components/shared/TransactionStatusCallout";
import { getTransactionReceiptPollingInterval } from "~~/config/shared";
import { useWalletRestore } from "~~/contexts/WalletRestoreContext";
import { FREE_TRANSACTION_ALLOWANCE_QUERY_KEY } from "~~/hooks/useFreeTransactionAllowance";
import { refreshActiveWalletReadQueries } from "~~/hooks/useRefreshWalletBalances";
import { waitForPublicClientTransactionReceiptWithRetry } from "~~/lib/transactions/receiptWait";
import { createTransactionTimingRun } from "~~/lib/transactions/timing";
import { TRANSACTION_CONFIRMING_STATUS, getSubmittingTransactionStatus } from "~~/lib/ui/transactionStatusCopy";
import { WALLET_TRANSACTION_RESTORING_MESSAGE } from "~~/lib/walletTransactionReadiness";
import scaffoldConfig from "~~/scaffold.config";
import { AllowedChainIds, getBlockExplorerTxLink, notification } from "~~/utils/scaffold-eth";
import { TransactorFuncOptions, getParsedErrorWithAllAbis } from "~~/utils/scaffold-eth/contract";

type TransactionFunc = (
  tx: (() => Promise<Hash>) | Parameters<SendTransactionMutate<Config, undefined>>[0],
  options?: TransactorFuncOptions,
) => Promise<Hash | undefined>;

const WALLET_CLIENT_RESTORE_TIMEOUT_MS = 8_000;
const WALLET_CLIENT_RESTORE_POLL_MS = 250;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function assertTransactionReceiptSucceeded(receipt: Pick<TransactionReceipt, "status">) {
  if (receipt.status === "reverted") throw new Error("Transaction reverted");
}

function attachTransactionRevertContext(
  error: Error,
  params: {
    cause?: unknown;
    receipt: TransactionReceipt;
    transactionHash: Hash;
  },
) {
  return Object.assign(error, {
    cause: params.cause,
    receipt: params.receipt,
    transactionHash: params.transactionHash,
  });
}

export async function buildTransactionRevertedError({
  chainId,
  publicClient,
  receipt,
  transactionHash,
}: {
  chainId: AllowedChainIds;
  publicClient: PublicClient;
  receipt: TransactionReceipt;
  transactionHash: Hash;
}) {
  let replayError: unknown;

  try {
    const transaction = await publicClient.getTransaction({ hash: transactionHash });
    await publicClient.call({
      account: transaction.from,
      blockNumber: receipt.blockNumber,
      data: transaction.input,
      gas: transaction.gas,
      to: transaction.to ?? undefined,
      value: transaction.value,
    });
  } catch (error) {
    replayError = error;
  }

  const parsedReplayError = replayError ? getParsedErrorWithAllAbis(replayError, chainId) : "";
  const message =
    parsedReplayError && parsedReplayError !== "An unknown error occurred" ? parsedReplayError : "Transaction reverted";

  return attachTransactionRevertContext(new Error(message), {
    cause: replayError,
    receipt,
    transactionHash,
  });
}

/**
 * Custom notification content for TXs.
 */
const TxnNotification = ({ message, blockExplorerLink }: { message: string; blockExplorerLink?: string }) => {
  return (
    <div className={`flex flex-col ml-1 cursor-default`}>
      <p className="my-0">{message}</p>
      {blockExplorerLink && blockExplorerLink.length > 0 ? (
        <a href={blockExplorerLink} target="_blank" rel="noreferrer" className="block link">
          check out transaction
        </a>
      ) : null}
    </div>
  );
};

/**
 * Runs Transaction passed in to returned function showing UI feedback.
 * @param _walletClient - Optional wallet client to use. If not provided, will use the one from useWalletClient.
 * @returns function that takes in transaction function as callback, shows UI feedback for transaction and returns a promise of the transaction hash
 */
export const useTransactor = (_walletClient?: WalletClient): TransactionFunc => {
  let walletClient = _walletClient;
  const { data } = useWalletClient();
  const runtimeConfig = useConfig();
  const queryClient = useQueryClient();
  const { isRestoringWallet } = useWalletRestore();
  if (walletClient === undefined && data) {
    walletClient = data;
  }
  const walletClientRef = useRef<WalletClient | undefined>(walletClient);
  const isRestoringWalletRef = useRef(isRestoringWallet);

  useEffect(() => {
    walletClientRef.current = walletClient;
    isRestoringWalletRef.current = isRestoringWallet;
  }, [isRestoringWallet, walletClient]);

  const waitForWalletClient = async () => {
    let currentWalletClient = walletClientRef.current;
    if (currentWalletClient || !isRestoringWalletRef.current) {
      return currentWalletClient;
    }

    const deadline = Date.now() + WALLET_CLIENT_RESTORE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await wait(WALLET_CLIENT_RESTORE_POLL_MS);
      currentWalletClient = walletClientRef.current;
      if (currentWalletClient || !isRestoringWalletRef.current) {
        return currentWalletClient;
      }
    }

    return walletClientRef.current;
  };

  const result: TransactionFunc = async (tx, options) => {
    const executableWalletClient = await waitForWalletClient();
    if (!executableWalletClient) {
      notification.error(isRestoringWalletRef.current ? WALLET_TRANSACTION_RESTORING_MESSAGE : "Cannot access account");
      return;
    }

    let notificationId = null;
    let transactionHash: Hash | undefined = undefined;
    let transactionReceipt: TransactionReceipt | undefined;
    let blockExplorerTxURL = "";
    let chainId: number = scaffoldConfig.targetNetworks[0].id;
    let timingLog: ReturnType<typeof createTransactionTimingRun> | null = null;
    try {
      const cachedChainId =
        executableWalletClient.chain?.id ??
        (typeof executableWalletClient.account === "object" && "chainId" in executableWalletClient.account
          ? Number((executableWalletClient.account as { chainId?: number }).chainId)
          : undefined);
      chainId =
        typeof cachedChainId === "number" && Number.isFinite(cachedChainId)
          ? cachedChainId
          : scaffoldConfig.targetNetworks[0].id;
      if (!Number.isFinite(chainId)) {
        chainId = await executableWalletClient.getChainId();
      }
      // Get full transaction from public client for the correct chain
      const publicClient = getPublicClient(runtimeConfig, { chainId: chainId as any });
      if (!publicClient) {
        throw new Error("Public client not available for this chain");
      }

      const action = options?.action ?? "transaction";
      timingLog = createTransactionTimingRun({
        action,
        chainId,
        consoleLabel: "wallet-transaction-timing",
        parentRunId: options?.parentRunId,
        route: typeof tx === "function" ? "prepared-wallet-call" : "send-transaction",
        source: "wallet-transaction",
      });
      const submittingStatus = getSubmittingTransactionStatus(action);
      if (!options?.suppressStatusToast) {
        notificationId = notification.loading(
          <TransactionStatusCallout
            variant="toast"
            title={submittingStatus.title}
            description={submittingStatus.description}
          />,
        );
        timingLog.emit("status-toast-shown");
      }
      if (typeof tx === "function") {
        // Tx is already prepared by the caller
        timingLog.emit("wallet-request-start");
        const result = await tx();
        transactionHash = result;
      } else if (tx != null) {
        timingLog.emit("wallet-request-start");
        transactionHash = await executableWalletClient.sendTransaction(tx as SendTransactionParameters);
      } else {
        throw new Error("Incorrect transaction passed to transactor");
      }
      timingLog.emit("wallet-request-complete", {
        transactionHash,
      });
      if (notificationId) {
        notification.remove(notificationId);
      }

      blockExplorerTxURL = chainId ? getBlockExplorerTxLink(chainId, transactionHash) : "";

      if (!options?.suppressStatusToast) {
        notificationId = notification.loading(
          <TransactionStatusCallout
            variant="toast"
            title={TRANSACTION_CONFIRMING_STATUS.title}
            description={TRANSACTION_CONFIRMING_STATUS.description}
            blockExplorerLink={blockExplorerTxURL}
          />,
        );
      }

      timingLog.emit("receipt-wait-start", {
        transactionHash,
      });
      transactionReceipt = await waitForPublicClientTransactionReceiptWithRetry(publicClient, {
        hash: transactionHash,
        confirmations: options?.blockConfirmations,
        pollingInterval: getTransactionReceiptPollingInterval(chainId, {
          preconfirmation: scaffoldConfig.useBasePreconfRpc,
        }),
      });
      if (notificationId) {
        notification.remove(notificationId);
      }
      timingLog.emit("receipt-wait-complete", {
        receiptStatus: transactionReceipt.status,
        transactionHash,
      });

      if (transactionReceipt.status === "reverted") {
        throw await buildTransactionRevertedError({
          chainId: chainId as AllowedChainIds,
          publicClient,
          receipt: transactionReceipt,
          transactionHash,
        });
      }

      void refreshActiveWalletReadQueries(queryClient);
      if (!options?.suppressSuccessToast) {
        notification.success(
          <TxnNotification message="Transaction completed successfully!" blockExplorerLink={blockExplorerTxURL} />,
          {
            icon: "🎉",
          },
        );
      }

      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });

      if (options?.onBlockConfirmation) options.onBlockConfirmation(transactionReceipt);
      timingLog.emit("success", {
        transactionHash,
      });
    } catch (error: any) {
      if (notificationId) {
        notification.remove(notificationId);
      }
      const defaultMessage = getParsedErrorWithAllAbis(error, chainId as AllowedChainIds);
      const message = options?.getErrorMessage?.(error, defaultMessage) ?? defaultMessage;

      // if receipt was reverted, show notification with block explorer link and return error
      if (transactionReceipt?.status === "reverted") {
        if (!options?.suppressErrorToast) {
          notification.error(<TxnNotification message={message} blockExplorerLink={blockExplorerTxURL} />);
        }
        throw error;
      }

      if (!options?.suppressErrorToast) {
        notification.error(message);
      }
      void queryClient.invalidateQueries({ queryKey: FREE_TRANSACTION_ALLOWANCE_QUERY_KEY });
      timingLog?.emit("failure", {
        message,
        transactionHash,
      });
      throw error;
    }

    return transactionHash;
  };

  return result;
};
