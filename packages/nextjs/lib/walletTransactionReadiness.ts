import { getGasBalanceErrorMessage } from "./transactionErrors";

export const WALLET_TRANSACTION_RESTORING_MESSAGE =
  "Your wallet session is still reconnecting. Wait a moment, then try again.";
export const WALLET_TRANSACTION_PREPARING_MESSAGE = "Preparing wallet. Try again in a moment.";
export const WALLET_TRANSACTION_GAS_MODE_MESSAGE = "Checking wallet gas mode. Retry in a moment.";
export const WALLET_TRANSACTION_SELF_FUNDED_MESSAGE = "Wallet switching to paid gas. Retry in a moment.";

type WalletTransactionReadinessStatus =
  | "ready"
  | "disconnected"
  | "wrong_network"
  | "restoring_wallet"
  | "checking_gas_mode"
  | "preparing_sponsored_wallet"
  | "switching_gas_mode"
  | "missing_gas"
  | "unavailable";

type WalletTransactionReadinessSeverity = "none" | "info" | "warning" | "error";

type WalletTransactionReadiness = {
  isBlocked: boolean;
  isPending: boolean;
  isReady: boolean;
  message: string | null;
  severity: WalletTransactionReadinessSeverity;
  status: WalletTransactionReadinessStatus;
};

export type WalletTransactionReadinessParams = {
  accountChainId?: number | null;
  accountStatus?: "connected" | "connecting" | "disconnected" | "reconnecting";
  address?: string | null;
  canSponsorTransactions?: boolean;
  hasExecutableWalletClient?: boolean;
  isAwaitingFreeTransactionAllowance?: boolean;
  isAwaitingSelfFundedWallet?: boolean;
  isAwaitingSponsoredWallet?: boolean;
  isMissingGasBalance?: boolean;
  isRestoringWallet?: boolean;
  nativeTokenSymbol?: string;
  targetChainId?: number | null;
  targetChainName?: string | null;
  unavailableMessage?: string | null;
};

function readiness(
  status: WalletTransactionReadinessStatus,
  message: string | null,
  severity: WalletTransactionReadinessSeverity,
  isPending = false,
): WalletTransactionReadiness {
  return {
    isBlocked: status !== "ready",
    isPending,
    isReady: status === "ready",
    message,
    severity,
    status,
  };
}

export function isPendingWalletTransactionReadiness(status: WalletTransactionReadinessStatus) {
  return (
    status === "restoring_wallet" ||
    status === "checking_gas_mode" ||
    status === "preparing_sponsored_wallet" ||
    status === "switching_gas_mode"
  );
}

export function isWalletTransactionReadinessMessage(message: string | null | undefined) {
  return (
    message === WALLET_TRANSACTION_RESTORING_MESSAGE ||
    message === WALLET_TRANSACTION_PREPARING_MESSAGE ||
    message === WALLET_TRANSACTION_GAS_MODE_MESSAGE ||
    message === WALLET_TRANSACTION_SELF_FUNDED_MESSAGE
  );
}

export function getWalletTransactionReadiness(params: WalletTransactionReadinessParams): WalletTransactionReadiness {
  if (params.unavailableMessage) {
    return readiness("unavailable", params.unavailableMessage, "error");
  }

  if (
    params.isRestoringWallet ||
    params.accountStatus === "connecting" ||
    ((params.accountStatus === "connected" || params.accountStatus === "reconnecting") &&
      params.hasExecutableWalletClient === false)
  ) {
    return readiness("restoring_wallet", WALLET_TRANSACTION_RESTORING_MESSAGE, "info", true);
  }

  if (!params.address) {
    return readiness("disconnected", "Please connect your wallet", "warning");
  }

  if (params.isAwaitingFreeTransactionAllowance) {
    return readiness("checking_gas_mode", WALLET_TRANSACTION_GAS_MODE_MESSAGE, "info", true);
  }

  if (params.isAwaitingSelfFundedWallet) {
    return readiness("switching_gas_mode", WALLET_TRANSACTION_SELF_FUNDED_MESSAGE, "info", true);
  }

  if (params.isAwaitingSponsoredWallet) {
    return readiness("preparing_sponsored_wallet", WALLET_TRANSACTION_PREPARING_MESSAGE, "info", true);
  }

  if (
    typeof params.accountChainId === "number" &&
    typeof params.targetChainId === "number" &&
    params.accountChainId !== params.targetChainId
  ) {
    return readiness(
      "wrong_network",
      `Wallet is connected to the wrong network. Please switch to ${params.targetChainName ?? `chain ${params.targetChainId}`}.`,
      "error",
    );
  }

  if (params.isMissingGasBalance) {
    return readiness(
      "missing_gas",
      getGasBalanceErrorMessage(params.nativeTokenSymbol ?? "ETH", {
        canSponsorTransactions: params.canSponsorTransactions,
      }),
      "error",
    );
  }

  return readiness("ready", null, "none");
}
