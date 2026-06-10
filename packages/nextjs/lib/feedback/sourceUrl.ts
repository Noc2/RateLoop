import { CONTENT_FEEDBACK_SOURCE_URL_MAX_LENGTH } from "~~/lib/feedback/types";
import { containsBlockedUrl } from "~~/utils/contentFilter";

export function normalizeFeedbackSourceUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CONTENT_FEEDBACK_SOURCE_URL_MAX_LENGTH) return undefined;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function isBlockedFeedbackSourceUrl(url: string) {
  return containsBlockedUrl(url).blocked;
}

export function normalizeAllowedFeedbackSourceUrl(value: unknown): string | null {
  const sourceUrl = normalizeFeedbackSourceUrl(value);
  if (!sourceUrl) return null;
  return isBlockedFeedbackSourceUrl(sourceUrl) ? null : sourceUrl;
}
