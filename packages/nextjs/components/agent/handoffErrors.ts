const DETAILS_MODERATION_REVIEW_ERROR = "Details require moderation review before publication.";
const DUPLICATE_ASK_PAYLOAD_ERROR = "clientRequestId has already been used for a different question payload.";

export const DUPLICATE_ASK_PAYLOAD_RECOVERY_MESSAGE =
  "This draft changed after the agent created the handoff. Save the edited draft as a new ask, or restore the original agent ask.";

export function readHandoffDetailsUploadError(error: string | undefined, fallback: string) {
  const message = error?.trim();
  if (message === DETAILS_MODERATION_REVIEW_ERROR) {
    return "Description needs review. Use shorter text or an external details URL.";
  }
  return message || fallback;
}

export function isDuplicateAskPayloadError(error: string | undefined | null) {
  const message = error?.trim();
  return Boolean(
    message &&
      (message === DUPLICATE_ASK_PAYLOAD_ERROR ||
        message.includes(DUPLICATE_ASK_PAYLOAD_ERROR) ||
        message.includes("reuse_original_request_or_change_clientRequestId") ||
        message.includes("duplicate_ask")),
  );
}

export function readHandoffDuplicateAskPayloadError(error: string | undefined | null) {
  return isDuplicateAskPayloadError(error) ? DUPLICATE_ASK_PAYLOAD_RECOVERY_MESSAGE : null;
}
