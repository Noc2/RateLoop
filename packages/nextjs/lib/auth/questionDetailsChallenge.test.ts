import assert from "node:assert/strict";
import test from "node:test";
import {
  hashQuestionDetailsUploadChallengePayload,
  normalizeQuestionDetailsUploadChallengeInput,
} from "~~/lib/auth/questionDetailsChallenge";

const validInput = {
  address: "0x00000000000000000000000000000000000000AA",
  detailsId: "det_abcdefghijklmnop",
  sha256: "a".repeat(64),
  sizeBytes: 1024,
};

test("normalizes signed question details upload challenge input", () => {
  const normalized = normalizeQuestionDetailsUploadChallengeInput(validInput);
  assert.equal(normalized.ok, true);
  if (!normalized.ok) return;
  assert.equal(normalized.payload.normalizedAddress, "0x00000000000000000000000000000000000000aa");
  assert.equal(normalized.payload.requiresGatedAccess, false);
  assert.equal(hashQuestionDetailsUploadChallengePayload(normalized.payload).length, 64);
});

test("includes gated access intent in question details upload challenge hashes", () => {
  const publicInput = normalizeQuestionDetailsUploadChallengeInput(validInput);
  const gatedInput = normalizeQuestionDetailsUploadChallengeInput({ ...validInput, requiresGatedAccess: true });
  assert.equal(publicInput.ok, true);
  assert.equal(gatedInput.ok, true);
  if (!publicInput.ok || !gatedInput.ok) return;

  assert.equal(gatedInput.payload.requiresGatedAccess, true);
  assert.notEqual(
    hashQuestionDetailsUploadChallengePayload(publicInput.payload),
    hashQuestionDetailsUploadChallengePayload(gatedInput.payload),
  );
});
