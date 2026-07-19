const PREFIX = "rateloop:review-draft:v2:";
const LEGACY_PREFIX = "rateloop:review-draft:v1:";
const activePrincipalKey = (lane: DraftLane) => `${PREFIX}${lane}-principal`;
const MAX_DRAFT_BYTES = 64 * 1024;
const MAX_DRAFTS = 20;

type DraftLane = "private" | "public";
type DraftEnvelope = {
  version: 2;
  savedAt: string;
  expiresAt: string | null;
  principalId: string | null;
  value: unknown;
};

export type ReviewDraftStorage = {
  principalId?: string | null;
  expiresAt?: string | null;
  now?: Date;
  storage?: Storage | null;
  legacyStorage?: Storage | null;
};

function key(lane: DraftLane, id: string, principalId: string | null) {
  const owner = encodeURIComponent(principalId ?? "missing");
  return `${PREFIX}${lane}:${owner}:${encodeURIComponent(id)}`;
}

function browserStorage(lane: DraftLane) {
  try {
    return lane === "private" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

function browserLegacyStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function removeMatching(storage: Storage, predicate: (candidate: string) => boolean) {
  const removals = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (candidate): candidate is string => Boolean(candidate && predicate(candidate)),
  );
  for (const candidate of removals) storage.removeItem(candidate);
}

function prepareStorage(lane: DraftLane, storage: Storage, legacyStorage: Storage | null, principalId: string) {
  if (legacyStorage) removeMatching(legacyStorage, candidate => candidate.startsWith(`${LEGACY_PREFIX}${lane}:`));
  const principalKey = activePrincipalKey(lane);
  const activePrincipal = storage.getItem(principalKey);
  if (activePrincipal !== principalId) {
    removeMatching(storage, candidate => candidate.startsWith(`${PREFIX}${lane}:`));
    storage.setItem(principalKey, principalId);
  }
}

function resolveStorage(lane: DraftLane, options: ReviewDraftStorage) {
  return options.storage === undefined ? browserStorage(lane) : options.storage;
}

function validExpiry(expiresAt: string | null, now: Date) {
  if (expiresAt === null) return true;
  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp > now.getTime();
}

export function loadReviewDraft<Value>(
  lane: DraftLane,
  id: string,
  validate: (value: unknown) => value is Value,
  options: ReviewDraftStorage = {},
) {
  const principalId = options.principalId?.trim() || null;
  if (!principalId) return null;
  const storage = resolveStorage(lane, options);
  if (!storage) return null;
  const legacyStorage = options.legacyStorage === undefined ? browserLegacyStorage() : options.legacyStorage;
  const now = options.now ?? new Date();
  const storageKey = key(lane, id, principalId);
  try {
    prepareStorage(lane, storage, legacyStorage, principalId);
    const encoded = storage.getItem(storageKey);
    if (!encoded || encoded.length > MAX_DRAFT_BYTES) {
      if (encoded) storage.removeItem(storageKey);
      return null;
    }
    const parsed = JSON.parse(encoded) as DraftEnvelope;
    if (
      parsed.version !== 2 ||
      parsed.principalId !== principalId ||
      (lane === "private" && parsed.expiresAt === null) ||
      !validExpiry(parsed.expiresAt, now) ||
      !validate(parsed.value)
    ) {
      storage.removeItem(storageKey);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function saveReviewDraft(lane: DraftLane, id: string, value: unknown, options: ReviewDraftStorage = {}) {
  const principalId = options.principalId?.trim() || null;
  if (!principalId) return false;
  const storage = resolveStorage(lane, options);
  if (!storage) return false;
  const legacyStorage = options.legacyStorage === undefined ? browserLegacyStorage() : options.legacyStorage;
  const now = options.now ?? new Date();
  const expiresAt = options.expiresAt ?? null;
  const storageKey = key(lane, id, principalId);
  try {
    prepareStorage(lane, storage, legacyStorage, principalId);
    if ((lane === "private" && expiresAt === null) || !validExpiry(expiresAt, now)) {
      storage.removeItem(storageKey);
      return false;
    }
    const encoded = JSON.stringify({
      version: 2,
      savedAt: now.toISOString(),
      expiresAt,
      principalId,
      value,
    } satisfies DraftEnvelope);
    if (encoded.length > MAX_DRAFT_BYTES) return false;
    storage.setItem(storageKey, encoded);

    const drafts = Array.from({ length: storage.length }, (_, index) => ({
      candidate: storage.key(index),
      index,
    }))
      .filter((entry): entry is { candidate: string; index: number } =>
        Boolean(entry.candidate?.startsWith(`${PREFIX}${lane}:`)),
      )
      .map(({ candidate, index }) => {
        try {
          const envelope = JSON.parse(storage.getItem(candidate) ?? "null") as DraftEnvelope | null;
          return { candidate, index, savedAt: envelope?.savedAt ?? "" };
        } catch {
          return { candidate, index, savedAt: "" };
        }
      })
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt) || right.index - left.index);
    for (const stale of drafts.slice(MAX_DRAFTS)) storage.removeItem(stale.candidate);
    return true;
  } catch {
    return false;
  }
}

export function clearReviewDraft(lane: DraftLane, id: string, options: ReviewDraftStorage = {}) {
  const principalId = options.principalId?.trim() || null;
  if (!principalId) return;
  try {
    resolveStorage(lane, options)?.removeItem(key(lane, id, principalId));
  } catch {
    // Draft cleanup must never interrupt a recorded response.
  }
}
