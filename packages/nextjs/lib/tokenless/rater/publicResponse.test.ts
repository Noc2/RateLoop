import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUBLIC_RATER_RESPONSE_SCHEMA_VERSION,
  createPublicRaterResponse,
  normalizePublicRaterResponse,
} from "~~/lib/tokenless/rater/publicResponse";

const binding = {
  operationKey: "op_public_feedback",
  roundId: "42",
  contentId: `0x${"11".repeat(32)}` as const,
  rationale: { mode: "required" as const, minLength: 10, maxLength: 100 },
};

test("public response hash is nonce-salted and bound to the operation, round, content, and normalized feedback", () => {
  const response = createPublicRaterResponse(binding, {
    category: "evidence",
    body: "  The source supports this answer.  ",
    sourceUrl: "https://example.com/evidence",
    nonce: `0x${"22".repeat(32)}`,
  });
  assert.equal(response.schemaVersion, PUBLIC_RATER_RESPONSE_SCHEMA_VERSION);
  const normalized = normalizePublicRaterResponse(binding, response);
  assert.deepEqual(normalized.canonical.feedback, {
    category: "evidence",
    body: "The source supports this answer.",
    sourceUrl: "https://example.com/evidence",
  });
  assert.equal(normalized.responseHash, response.responseHash);
  assert.throws(
    () => normalizePublicRaterResponse({ ...binding, operationKey: "op_other" }, response),
    /hash does not match/,
  );
});

test("public response validation enforces rationale bounds and safe source URLs", () => {
  assert.throws(
    () =>
      createPublicRaterResponse(binding, {
        category: "opinion",
        body: "short",
        sourceUrl: null,
        nonce: `0x${"33".repeat(32)}`,
      }),
    /10-100 characters/,
  );
  assert.throws(
    () =>
      createPublicRaterResponse(binding, {
        category: "evidence",
        body: "A sufficiently detailed response.",
        sourceUrl: "https://user:secret@example.com/private",
        nonce: `0x${"44".repeat(32)}`,
      }),
    /must not contain credentials/,
  );
});

test("optional questions permit an empty response but reject unbound metadata", () => {
  const optionalBinding = { ...binding, rationale: { mode: "optional" as const } };
  const response = createPublicRaterResponse(optionalBinding, {
    category: null,
    body: "",
    sourceUrl: null,
    nonce: `0x${"55".repeat(32)}`,
  });
  assert.equal(normalizePublicRaterResponse(optionalBinding, response).canonical.feedback, null);
  assert.throws(
    () =>
      normalizePublicRaterResponse(optionalBinding, {
        ...response,
        category: "opinion",
      }),
    /Add feedback/,
  );
});
