import {
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
  isThirdwebSponsoredExecutionRejectedError,
} from "~~/lib/transactionErrors";

export function getLrepTransferErrorMessage(error: unknown, nativeTokenSymbol = "ETH") {
  if (
    isInsufficientFundsError(error) ||
    isFreeTransactionExhaustedError(error) ||
    isThirdwebSponsoredExecutionRejectedError(error)
  ) {
    return `LREP transfers are not sponsored. Add some ${nativeTokenSymbol} for gas, then retry.`;
  }

  return (
    (error as { shortMessage?: string; message?: string } | undefined)?.shortMessage ||
    (error as { shortMessage?: string; message?: string } | undefined)?.message ||
    "Failed to transfer LREP"
  );
}
