import {
  isContractSubmissionImageUrl,
  isDirectImageUrl,
  isUploadedImageUrl,
  normalizeSubmissionContextUrl,
  normalizeSubmissionMediaUrl,
} from "./contentMedia";
import assert from "node:assert/strict";
import test from "node:test";

test("isUploadedImageUrl requires a trusted RateLoop image origin", () => {
  const approvedPath =
    "/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  assert.equal(isUploadedImageUrl(`https://www.rateloop.ai${approvedPath}`), true);
  assert.equal(isUploadedImageUrl(`https://rateloop.ai${approvedPath}`), true);
  assert.equal(normalizeSubmissionMediaUrl(`https://rateloop.ai${approvedPath}`), `https://rateloop.ai${approvedPath}`);
  assert.equal(isUploadedImageUrl(`https://evil.example${approvedPath}`), false);
});

test("isContractSubmissionImageUrl rejects local development attachment URLs", () => {
  const approvedPath =
    "/api/attachments/images/att_abcdefghijklmnop.webp#sha256=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  assert.equal(isUploadedImageUrl(`http://localhost:3000${approvedPath}`), true);
  assert.equal(isContractSubmissionImageUrl(`http://localhost:3000${approvedPath}`), false);
  assert.equal(isContractSubmissionImageUrl(`https://www.rateloop.ai${approvedPath}`), true);
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
