import type { ContentItem } from "~~/hooks/contentFeed/shared";

/**
 * Resolves the content item targeted by the stake modal. Prefers the live feed
 * entry so confirmation uses fresh data, but falls back to the snapshot
 * captured when the modal opened: a background feed refetch can drop an active
 * item from the feed while the modal is open, and that alone must not surface
 * as "content unavailable". Genuinely inactive content is still rejected by
 * the on-chain isContentActive check in useRoundVote.
 */
export function resolveStakeModalVoteItem({
  feed,
  contentId,
  snapshot,
}: {
  feed: readonly ContentItem[];
  contentId: bigint;
  snapshot?: ContentItem | null;
}): ContentItem | null {
  const liveItem = feed.find(item => item.id === contentId);
  if (liveItem) {
    return liveItem;
  }
  if (snapshot && snapshot.id === contentId) {
    return snapshot;
  }
  return null;
}
