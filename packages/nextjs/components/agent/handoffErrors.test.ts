import {
  DUPLICATE_ASK_PAYLOAD_RECOVERY_MESSAGE,
  isDuplicateAskPayloadError,
  readHandoffDetailsUploadError,
  readHandoffDuplicateAskPayloadError,
} from "./handoffErrors";
import assert from "node:assert/strict";
import test from "node:test";

test("uses a short handoff details moderation error", () => {
  assert.equal(
    readHandoffDetailsUploadError(
      "Details require moderation review before publication.",
      "Could not upload description.",
    ),
    "Description needs review. Use shorter text or an external details URL.",
  );
});

test("keeps unknown handoff details errors when present", () => {
  assert.equal(readHandoffDetailsUploadError("Upload expired.", "Could not upload description."), "Upload expired.");
  assert.equal(
    readHandoffDetailsUploadError(undefined, "Could not upload description."),
    "Could not upload description.",
  );
});

test("detects duplicate ask payload errors for handoff recovery", () => {
  assert.equal(
    isDuplicateAskPayloadError("clientRequestId has already been used for a different question payload."),
    true,
  );
  assert.equal(isDuplicateAskPayloadError("duplicate_ask"), true);
  assert.equal(isDuplicateAskPayloadError("Upload expired."), false);
});

test("uses a handoff recovery message for duplicate ask payload errors", () => {
  assert.equal(
    readHandoffDuplicateAskPayloadError("clientRequestId has already been used for a different question payload."),
    DUPLICATE_ASK_PAYLOAD_RECOVERY_MESSAGE,
  );
  assert.equal(readHandoffDuplicateAskPayloadError("Upload expired."), null);
});
