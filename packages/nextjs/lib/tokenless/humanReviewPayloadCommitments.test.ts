import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHumanReviewPayloadCommitments,
  hashHumanReviewPayload,
} from "~~/lib/tokenless/humanReviewPayloadCommitments";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

test("hashes and verifies exact UTF-8 human-review payload bytes", () => {
  const sourcePayload = "Request:\r\n  café ☕\n";
  const suggestionPayload = "Answer:\n08:00–17:00\n\0End";
  const commitments = {
    source: hashHumanReviewPayload(Buffer.from(sourcePayload, "utf8")),
    suggestion: hashHumanReviewPayload(Buffer.from(suggestionPayload, "utf8")),
  };

  assert.doesNotThrow(() => assertHumanReviewPayloadCommitments({ sourcePayload, suggestionPayload, commitments }));
});

test("rejects even whitespace-only source or suggestion drift with a field-specific error", () => {
  const commitments = {
    source: hashHumanReviewPayload("source"),
    suggestion: hashHumanReviewPayload("suggestion"),
  };
  for (const entry of [
    {
      sourcePayload: "source ",
      suggestionPayload: "suggestion",
      code: "source_payload_commitment_mismatch",
    },
    {
      sourcePayload: "source",
      suggestionPayload: "suggestion\n",
      code: "suggestion_payload_commitment_mismatch",
    },
  ]) {
    assert.throws(
      () => assertHumanReviewPayloadCommitments({ ...entry, commitments }),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === entry.code,
    );
  }
});
