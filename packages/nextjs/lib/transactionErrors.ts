function collectErrorText(value: unknown, seen: Set<unknown>, depth = 0): string[] {
  if (depth > 10) return [];
  if (value === null || value === undefined) return [];

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return [String(value)];
  }

  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const parts: string[] = [];

  if (value instanceof Error) {
    parts.push(value.name, value.message);
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    parts.push(...collectErrorText(nested, seen, depth + 1));
  }

  return parts;
}

function getTransactionErrorText(error: unknown) {
  return collectErrorText(error, new Set()).join(" ");
}

export function isInsufficientFundsError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("insufficient funds") ||
    haystack.includes("aa21 didn't pay prefund") ||
    haystack.includes("aa21 didnt pay prefund") ||
    haystack.includes("exceeds the balance of the account") ||
    haystack.includes("gas * gas fee + value")
  );
}

export function isFreeTransactionExhaustedError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("free transactions used up") || haystack.includes("transactions are not sponsored right now")
  );
}

export function isUnsupportedRpcMethodError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return haystack.includes("this request method is not supported");
}

export function isUserRejectedTransactionError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("user rejected the request") ||
    haystack.includes("user denied transaction signature") ||
    haystack.includes("denied transaction signature") ||
    haystack.includes("rejected transaction") ||
    haystack.includes("transaction was rejected")
  );
}

export function isThirdwebBundlerInfrastructureError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();
  const isThirdwebBundlerError =
    haystack.includes("bundler.thirdweb.com") ||
    haystack.includes("thirdweb_getuseroperationgasprice") ||
    haystack.includes("useroperationgasprice");
  const isTransientInfrastructureError =
    haystack.includes("error code: 522") ||
    haystack.includes("status: 500") ||
    haystack.includes("status 500") ||
    haystack.includes("internal server error") ||
    haystack.includes("bad gateway") ||
    haystack.includes("gateway timeout") ||
    haystack.includes("service unavailable");

  return isThirdwebBundlerError && isTransientInfrastructureError;
}

export function isThirdwebSponsoredExecutionRejectedError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();
  const isThirdwebSponsoredExecution =
    haystack.includes("tw_execute error") ||
    haystack.includes("error executing 7702 transaction") ||
    haystack.includes("pm_sponsoruseroperation") ||
    haystack.includes("transaction not sponsored") ||
    haystack.includes("bundler.thirdweb.com");
  const isRejectedRequest =
    haystack.includes("status: 400") ||
    haystack.includes("status 400") ||
    haystack.includes("400 (bad request)") ||
    haystack.includes("bad request") ||
    haystack.includes("transaction not sponsored") ||
    haystack.includes("paymaster") ||
    haystack.includes("useroperation") ||
    haystack.includes("userop");

  return isThirdwebSponsoredExecution && isRejectedRequest && !isUserRejectedTransactionError(error);
}

export function isTransactionRelayAuthorizationError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("status of 401") ||
    haystack.includes("status: 401") ||
    haystack.includes("status 401") ||
    haystack.includes("401 (unauthorized)") ||
    haystack.includes("unauthorized") ||
    haystack.includes("transaction not sponsored") ||
    haystack.includes("transactions are not sponsored right now")
  );
}

export function isTransactionRelayTimeoutError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("failed_timeout") ||
    haystack.includes("transaction relay error") ||
    haystack.includes("relay timed out")
  );
}

export function isTransactionReceiptTimeoutError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("waitfortransactionreceipttimeouterror") ||
    (haystack.includes("timed out while waiting for transaction") && haystack.includes("to be confirmed"))
  );
}

export function isWalletRpcOverloadedError(error: unknown) {
  const haystack = getTransactionErrorText(error).toLowerCase();

  return (
    haystack.includes("rpc endpoint returned too many errors") ||
    haystack.includes("consider using a different rpc endpoint")
  );
}

export function getGasBalanceErrorMessage(nativeTokenSymbol: string, options?: { canSponsorTransactions?: boolean }) {
  if (options?.canSponsorTransactions) {
    return `Gas is sponsored for now. If it still fails, add some ${nativeTokenSymbol} and retry.`;
  }

  return `Add some ${nativeTokenSymbol} for gas, then retry.`;
}
