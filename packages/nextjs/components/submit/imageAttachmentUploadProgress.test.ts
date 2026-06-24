import {
  IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY,
  getBlobUploadProgress,
  getImageAttachmentUploadProgress,
} from "./imageAttachmentUploadProgress";
import assert from "node:assert/strict";
import test from "node:test";

test("wallet signature phase is visible before the file upload starts", () => {
  assert.equal(getImageAttachmentUploadProgress("waiting-for-signature"), 18);
  assert.match(IMAGE_ATTACHMENT_UPLOAD_PHASE_COPY["waiting-for-signature"].label, /wallet signature/i);
});

test("blob upload progress is bounded inside the upload phase", () => {
  assert.equal(getBlobUploadProgress(Number.NaN), 24);
  assert.equal(getBlobUploadProgress(-10), 24);
  assert.equal(getBlobUploadProgress(50), 53);
  assert.equal(getBlobUploadProgress(120), 82);
});
