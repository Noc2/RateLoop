const reservationSessionTokens = new Map<string, string>();
const SESSION_STORAGE_PREFIX = "rateloop:free-tx-session:";

export function buildFreeTransactionReservationSessionMessage(params: {
  address: string;
  chainId: number;
  operationKey: string;
}) {
  return [
    "RateLoop free transaction reservation session",
    "",
    `Address: ${params.address.toLowerCase()}`,
    `Chain ID: ${params.chainId}`,
    `Operation Key: ${params.operationKey.toLowerCase()}`,
    "",
    "Only sign this message to confirm a free transaction you just submitted.",
  ].join("\n");
}

export function cacheFreeTransactionReservationSession(operationKey: string, reservationSessionToken: string) {
  reservationSessionTokens.set(operationKey.toLowerCase(), reservationSessionToken);

  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.setItem(`${SESSION_STORAGE_PREFIX}${operationKey.toLowerCase()}`, reservationSessionToken);
    } catch {
      // Ignore storage failures in private browsing / restricted environments.
    }
  }
}

export function readCachedFreeTransactionReservationSession(operationKey: string): string | null {
  const normalizedOperationKey = operationKey.toLowerCase();
  const inMemoryToken = reservationSessionTokens.get(normalizedOperationKey);
  if (inMemoryToken) {
    return inMemoryToken;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(`${SESSION_STORAGE_PREFIX}${normalizedOperationKey}`);
  } catch {
    return null;
  }
}
