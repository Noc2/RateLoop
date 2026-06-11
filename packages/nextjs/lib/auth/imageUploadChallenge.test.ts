import assert from "node:assert/strict";
import test from "node:test";
import { hashImageUploadChallengePayload, normalizeImageUploadChallengeInput } from "~~/lib/auth/imageUploadChallenge";

const validInput = {
  address: "0x00000000000000000000000000000000000000AA",
  attachmentId: "att_abcdefghijklmnop",
  filename: "mockup.png",
  mimeType: "image/png",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
};

test("normalizes signed image upload challenge input", () => {
  const normalized = normalizeImageUploadChallengeInput(validInput);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.payload.normalizedAddress, "0x00000000000000000000000000000000000000aa");
  assert.equal(normalized.payload.requiresGatedAccess, false);
  assert.equal(hashImageUploadChallengePayload(normalized.payload).length, 64);
});

test("includes gated access intent in image upload challenge hashes", () => {
  const publicInput = normalizeImageUploadChallengeInput(validInput);
  const gatedInput = normalizeImageUploadChallengeInput({ ...validInput, requiresGatedAccess: true });
  assert.equal(publicInput.ok, true);
  assert.equal(gatedInput.ok, true);
  if (!publicInput.ok || !gatedInput.ok) return;

  assert.equal(gatedInput.payload.requiresGatedAccess, true);
  assert.notEqual(
    hashImageUploadChallengePayload(publicInput.payload),
    hashImageUploadChallengePayload(gatedInput.payload),
  );
});

test("rejects unsupported upload content types and oversize files", () => {
  assert.equal(normalizeImageUploadChallengeInput({ ...validInput, mimeType: "image/gif" }).ok, false);
  assert.equal(normalizeImageUploadChallengeInput({ ...validInput, sizeBytes: 20 * 1024 * 1024 }).ok, false);
});
