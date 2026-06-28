const reservationSessionTokens = new Map<string, string>();
const SESSION_STORAGE_PREFIX = "rateloop:free-tx-session:";

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

export function clearCachedFreeTransactionReservationSession(operationKey: string) {
  const normalizedOperationKey = operationKey.toLowerCase();
  reservationSessionTokens.delete(normalizedOperationKey);

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(`${SESSION_STORAGE_PREFIX}${normalizedOperationKey}`);
  } catch {
    // Ignore storage failures in private browsing / restricted environments.
  }
}

export function __clearFreeTransactionReservationSessionCacheForTests() {
  reservationSessionTokens.clear();
}
