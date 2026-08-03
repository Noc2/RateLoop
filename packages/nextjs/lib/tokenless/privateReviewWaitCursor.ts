export const PRIVATE_REVIEW_WAIT_CURSOR_PATTERN_SOURCE = "^[0-9]{1,16}(?::[0-9]{1,16})?$";

const PRIVATE_REVIEW_WAIT_CURSOR_PATTERN = new RegExp(PRIVATE_REVIEW_WAIT_CURSOR_PATTERN_SOURCE, "u");

export type PrivateReviewWaitCursor = {
  responseCount: number;
  revision: number;
};

export function parsePrivateReviewWaitCursor(value: string | undefined): PrivateReviewWaitCursor | null | undefined {
  if (value === undefined) return null;
  if (!PRIVATE_REVIEW_WAIT_CURSOR_PATTERN.test(value)) return undefined;
  const [revisionValue, responseCountValue] = value.split(":");
  const revision = Number(revisionValue);
  const responseCount = responseCountValue === undefined ? 0 : Number(responseCountValue);
  if (!Number.isSafeInteger(revision) || !Number.isSafeInteger(responseCount)) return undefined;
  return { responseCount, revision };
}

export function formatPrivateReviewWaitCursor(value: PrivateReviewWaitCursor) {
  return `${value.revision}:${value.responseCount}`;
}
