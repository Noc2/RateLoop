import { isUploadedImageUrl, normalizeSubmissionMediaUrl } from "./contentMedia";
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
