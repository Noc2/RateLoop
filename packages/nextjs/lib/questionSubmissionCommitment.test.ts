import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQuestionConfidentialityHash,
  buildQuestionSubmissionKey,
  buildQuestionSubmissionRevealCommitment,
  canonicalQuestionImageUrls,
} from "~~/lib/questionSubmissionCommitment";

const IMAGE_A =
  "https://www.rateloop.ai/api/attachments/images/att_aaaaaaaaaaaaaaaa.webp#sha256=0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const IMAGE_B =
  "https://www.rateloop.ai/api/attachments/images/att_bbbbbbbbbbbbbbbb.webp#sha256=0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as const;
const QUESTION_METADATA_HASH = `0x${"2".repeat(64)}` as const;
const RESULT_SPEC_HASH = `0x${"3".repeat(64)}` as const;
const SALT = `0x${"4".repeat(64)}` as const;
const SUBMITTER = "0x0000000000000000000000000000000000000001" as const;

test("canonicalQuestionImageUrls sorts and deduplicates image media", () => {
  assert.deepEqual(canonicalQuestionImageUrls([IMAGE_B, IMAGE_A, IMAGE_A]), [IMAGE_A, IMAGE_B]);
});

test("question confidentiality hashes reject oversized uint64 bond amounts", () => {
  assert.throws(
    () =>
      buildQuestionConfidentialityHash({
        bondAmount: 18446744073709551616n,
        gated: true,
      }),
    /bondAmount must be at most 18446744073709551615/,
  );
});

test("question submission commitments use canonical image media", () => {
  const sortedImageUrls = [IMAGE_A, IMAGE_B];
  const reorderedImageUrls = [IMAGE_B, IMAGE_A, IMAGE_A];
  const commonKeyParams = {
    categoryId: 5n,
    contextUrl: "https://example.com/context",
    detailsHash: EMPTY_DETAILS_HASH,
    detailsUrl: "",
    tags: "Media,Video",
    title: "Is this clip worth watching?",
    videoUrl: "",
  };
  const sortedSubmissionKey = buildQuestionSubmissionKey({ ...commonKeyParams, imageUrls: sortedImageUrls });
  const reorderedSubmissionKey = buildQuestionSubmissionKey({ ...commonKeyParams, imageUrls: reorderedImageUrls });
  const commonRevealParams = {
    ...commonKeyParams,
    bountyEligibility: 0,
    bountyStartBy: 0n,
    bountyWindowSeconds: 1_200n,
    confidentialityHash: undefined,
    feedbackWindowSeconds: 1_200n,
    questionMetadataHash: QUESTION_METADATA_HASH,
    requiredSettledRounds: 1n,
    requiredVoters: 3n,
    resultSpecHash: RESULT_SPEC_HASH,
    rewardAmount: 1_000_000n,
    rewardAsset: 1,
    roundConfig: {
      epochDuration: 1_200n,
      maxDuration: 1_200n,
      maxVoters: 100n,
      minVoters: 3n,
    },
    salt: SALT,
    submissionKey: sortedSubmissionKey,
    submitter: SUBMITTER,
  } as const;

  assert.equal(reorderedSubmissionKey, sortedSubmissionKey);
  assert.equal(
    buildQuestionSubmissionRevealCommitment({
      ...commonRevealParams,
      imageUrls: reorderedImageUrls,
    }),
    buildQuestionSubmissionRevealCommitment({
      ...commonRevealParams,
      imageUrls: sortedImageUrls,
    }),
  );
});
