const PREFIX = "rateloop:review-receipt:v1:";
const MAX_RECEIPT_BYTES = 8 * 1024;
const MAX_RECEIPTS = 50;
const RECEIPT_TTL_MS = 7 * 86_400_000;

type ReceiptLane = "private" | "public";
type ReceiptEnvelope = {
  version: 1;
  principalId: string;
  savedAt: string;
  expiresAt: string;
  value: unknown;
};

type ReceiptStorage = {
  principalId: string;
  now?: Date;
  storage?: Storage | null;
};

function key(lane: ReceiptLane, id: string, principalId: string) {
  return `${PREFIX}${lane}:${encodeURIComponent(principalId)}:${encodeURIComponent(id)}`;
}

function browserStorage(lane: ReceiptLane) {
  try {
    return lane === "private" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(lane: ReceiptLane, options: ReceiptStorage) {
  return options.storage === undefined ? browserStorage(lane) : options.storage;
}

export function loadReviewReceipt<Value>(
  lane: ReceiptLane,
  id: string,
  validate: (value: unknown) => value is Value,
  options: ReceiptStorage,
) {
  const principalId = options.principalId.trim();
  const storage = resolveStorage(lane, options);
  if (!principalId || !storage) return null;
  const storageKey = key(lane, id, principalId);
  try {
    const encoded = storage.getItem(storageKey);
    if (!encoded || encoded.length > MAX_RECEIPT_BYTES) {
      if (encoded) storage.removeItem(storageKey);
      return null;
    }
    const parsed = JSON.parse(encoded) as ReceiptEnvelope;
    const now = options.now ?? new Date();
    if (
      parsed.version !== 1 ||
      parsed.principalId !== principalId ||
      new Date(parsed.expiresAt).getTime() <= now.getTime() ||
      !validate(parsed.value)
    ) {
      storage.removeItem(storageKey);
      return null;
    }
    return parsed.value;
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function saveReviewReceipt(lane: ReceiptLane, id: string, value: unknown, options: ReceiptStorage) {
  const principalId = options.principalId.trim();
  const storage = resolveStorage(lane, options);
  if (!principalId || !storage) return false;
  const now = options.now ?? new Date();
  const envelope: ReceiptEnvelope = {
    version: 1,
    principalId,
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + RECEIPT_TTL_MS).toISOString(),
    value,
  };
  try {
    const encoded = JSON.stringify(envelope);
    if (encoded.length > MAX_RECEIPT_BYTES) return false;
    storage.setItem(key(lane, id, principalId), encoded);
    const receipts = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((candidate): candidate is string => Boolean(candidate?.startsWith(`${PREFIX}${lane}:`)))
      .map(candidate => {
        try {
          const saved = JSON.parse(storage.getItem(candidate) ?? "null") as ReceiptEnvelope | null;
          return { candidate, savedAt: saved?.savedAt ?? "" };
        } catch {
          return { candidate, savedAt: "" };
        }
      })
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    for (const stale of receipts.slice(MAX_RECEIPTS)) storage.removeItem(stale.candidate);
    return true;
  } catch {
    return false;
  }
}
