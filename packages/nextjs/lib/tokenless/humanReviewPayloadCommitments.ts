import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export type HumanReviewPayloadCommitments = {
  source: `sha256:${string}`;
  suggestion: `sha256:${string}`;
};

export function hashHumanReviewPayload(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertHumanReviewPayloadCommitments(input: {
  sourcePayload: string | Uint8Array;
  suggestionPayload: string | Uint8Array;
  commitments: HumanReviewPayloadCommitments;
}) {
  if (hashHumanReviewPayload(input.sourcePayload) !== input.commitments.source) {
    throw new TokenlessServiceError(
      "sourcePayload does not match the committed source evidence.",
      409,
      "source_payload_commitment_mismatch",
    );
  }
  if (hashHumanReviewPayload(input.suggestionPayload) !== input.commitments.suggestion) {
    throw new TokenlessServiceError(
      "suggestionPayload does not match the committed suggestion.",
      409,
      "suggestion_payload_commitment_mismatch",
    );
  }
}
