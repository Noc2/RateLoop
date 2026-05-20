import type { ContentItem } from "~~/hooks/useContentFeed";
import { isContentItemBlocked } from "~~/utils/contentFilter";

export function mergeRequestedContentIntoFeed(
  items: readonly ContentItem[],
  requestedItem: ContentItem | null | undefined,
  options: {
    promoteExisting?: boolean;
    requestedId?: bigint | null;
  } = {},
) {
  const requestedId = requestedItem?.id ?? options.requestedId ?? null;

  if (requestedItem && isContentItemBlocked(requestedItem)) {
    return [...items];
  }

  const existingIndex = requestedId === null ? -1 : items.findIndex(item => item.id === requestedId);
  if (existingIndex !== -1) {
    if (!options.promoteExisting || existingIndex === 0) {
      return [...items];
    }

    const existingItem = items[existingIndex];
    return [existingItem, ...items.slice(0, existingIndex), ...items.slice(existingIndex + 1)];
  }

  if (!requestedItem) {
    return [...items];
  }

  return [requestedItem, ...items];
}
