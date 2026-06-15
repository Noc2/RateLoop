import assert from "node:assert/strict";
import test from "node:test";

import {
  findBlockedContentTags,
  getContentTitleValidationError,
} from "./submissionValidation";

test("getContentTitleValidationError rejects prohibited terms", () => {
  assert.equal(
    getContentTitleValidationError("NSFW highlights"),
    "Your question contains prohibited content",
  );
});

test("findBlockedContentTags returns trimmed blocked tags", () => {
  assert.deepEqual(findBlockedContentTags(["music", " nsfw ", "science"]), [
    "nsfw",
  ]);
});
