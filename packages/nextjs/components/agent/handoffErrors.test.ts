import { readHandoffDetailsUploadError } from "./handoffErrors";
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
