const DETAILS_MODERATION_REVIEW_ERROR = "Details require moderation review before publication.";

export function readHandoffDetailsUploadError(error: string | undefined, fallback: string) {
  const message = error?.trim();
  if (message === DETAILS_MODERATION_REVIEW_ERROR) {
    return "Description needs review. Use shorter text or an external details URL.";
  }
  return message || fallback;
}
