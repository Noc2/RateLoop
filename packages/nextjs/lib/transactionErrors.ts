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
