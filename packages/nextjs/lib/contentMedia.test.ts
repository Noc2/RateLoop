import {
  isDirectImageUrl,
  isUploadedImageUrl,
  normalizeSubmissionContextUrl,
  normalizeSubmissionMediaUrl,
} from "./contentMedia";
import assert from "node:assert/strict";
import test from "node:test";

test("isUploadedImageUrl requires a trusted RateLoop image origin", () => {
  const approvedPath = "/api/attachments/images/att_abcdefghijklmnop.webp";

  assert.equal(isUploadedImageUrl(`https://www.curyo.xyz${approvedPath}`), true);
  assert.equal(
    normalizeSubmissionMediaUrl(`https://www.curyo.xyz${approvedPath}`),
    `https://www.curyo.xyz${approvedPath}`,
  );
  assert.equal(isUploadedImageUrl(`https://evil.example${approvedPath}`), false);
});

test("normalizeSubmissionContextUrl rejects direct image file URLs", () => {
  assert.equal(isDirectImageUrl("https://example.com/photo.JPG?width=1200"), true);
  assert.equal(isDirectImageUrl("https://example.com/articles/photo-review"), false);
  assert.equal(normalizeSubmissionContextUrl("https://example.com/photo.jpg"), null);
  assert.equal(
    normalizeSubmissionContextUrl("https://example.com/articles/photo-review"),
    "https://example.com/articles/photo-review",
  );
});
