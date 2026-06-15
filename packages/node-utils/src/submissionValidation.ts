import { contentModerationPolicy } from "./contentModeration.js";

export const MAX_QUESTION_LENGTH = 120;

function containsBlockedText(value: string): boolean {
  const normalized = value.toLowerCase();
  return contentModerationPolicy.blockedTextTerms.some((term) =>
    normalized.includes(term.toLowerCase()),
  );
}

export function getContentTitleValidationError(value: string): string | null {
  if (value.length > MAX_QUESTION_LENGTH) {
    return `Question must be ${MAX_QUESTION_LENGTH} characters or fewer`;
  }

  return containsBlockedText(value)
    ? "Your question contains prohibited content"
    : null;
}

export function getContentTagValidationError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return containsBlockedText(trimmed)
    ? "This category contains prohibited content"
    : null;
}

export function findBlockedContentTags(tags: string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => getContentTagValidationError(tag) !== null);
}
