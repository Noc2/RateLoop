import {
  __setPublicQuestionMediaPreviewKeyForTests,
  issuePublicQuestionMediaPreviewCapability,
  validatePublicQuestionMediaPreviewCapability,
} from "./publicQuestionMediaPreview";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

afterEach(() => __setPublicQuestionMediaPreviewKeyForTests(null));

test("public-media preview capabilities reject non-canonical signature aliases", () => {
  __setPublicQuestionMediaPreviewKeyForTests(new Uint8Array(32).fill(7));
  const input = {
    assetId: `pqm_${"a".repeat(24)}`,
    digest: `sha256:${"b".repeat(64)}`,
    expiresAt: new Date("2026-07-29T00:00:00.000Z"),
  };
  const capability = issuePublicQuestionMediaPreviewCapability(input);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalCharacter = capability.at(-1)!;
  const finalIndex = alphabet.indexOf(finalCharacter);
  assert.equal(finalIndex % 4, 0);
  const alias = alphabet[finalIndex + 1]!;

  const validation = {
    assetId: input.assetId,
    digest: input.digest,
    now: new Date("2026-07-28T12:00:00.000Z"),
  };
  assert.ok(validatePublicQuestionMediaPreviewCapability({ ...validation, capability }));
  assert.equal(
    validatePublicQuestionMediaPreviewCapability({ ...validation, capability: `${capability.slice(0, -1)}${alias}` }),
    null,
  );
});
