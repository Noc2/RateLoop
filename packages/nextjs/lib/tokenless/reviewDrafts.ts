const PREFIX = "rateloop:review-draft:v1:";
const MAX_DRAFT_BYTES = 64 * 1024;
const MAX_DRAFTS = 20;

type DraftEnvelope = { version: 1; savedAt: string; value: unknown };

function key(lane: "private" | "public", id: string) {
  return `${PREFIX}${lane}:${encodeURIComponent(id)}`;
}

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadReviewDraft<Value>(
  lane: "private" | "public",
  id: string,
  validate: (value: unknown) => value is Value,
  storage: Storage | null = browserStorage(),
) {
  if (!storage) return null;
  try {
    const encoded = storage.getItem(key(lane, id));
    if (!encoded || encoded.length > MAX_DRAFT_BYTES) return null;
    const parsed = JSON.parse(encoded) as DraftEnvelope;
    return parsed.version === 1 && validate(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

export function saveReviewDraft(
  lane: "private" | "public",
  id: string,
  value: unknown,
  storage: Storage | null = browserStorage(),
) {
  if (!storage) return false;
  try {
    const encoded = JSON.stringify({ version: 1, savedAt: new Date().toISOString(), value } satisfies DraftEnvelope);
    if (encoded.length > MAX_DRAFT_BYTES) return false;
    storage.setItem(key(lane, id), encoded);

    const drafts = Array.from({ length: storage.length }, (_, index) => ({ candidate: storage.key(index), index }))
      .filter((entry): entry is { candidate: string; index: number } => Boolean(entry.candidate?.startsWith(PREFIX)))
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

export function clearReviewDraft(lane: "private" | "public", id: string, storage: Storage | null = browserStorage()) {
  try {
    storage?.removeItem(key(lane, id));
  } catch {
    // Draft cleanup must never interrupt a recorded response.
  }
}
