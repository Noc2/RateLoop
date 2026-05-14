export type DisplayRating = number | null | undefined;

export function hasVisibleRating(rating: DisplayRating): rating is number {
  return typeof rating === "number" && Number.isFinite(rating);
}

export function clampContentRating(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  return Math.min(100, Math.max(0, rating));
}

export function formatRatingScoreOutOfTen(rating: DisplayRating): string {
  if (!hasVisibleRating(rating)) return "N/A";
  return (clampContentRating(rating) / 10).toFixed(1);
}

export function formatRatingOutOfTen(rating: DisplayRating): string {
  if (!hasVisibleRating(rating)) return "N/A";
  return `${formatRatingScoreOutOfTen(rating)}/10`;
}

export function formatCommunityRatingAriaLabel(rating: DisplayRating): string {
  if (!hasVisibleRating(rating)) return "No community rating yet";
  return `Community rating ${formatRatingScoreOutOfTen(rating)} out of 10`;
}
