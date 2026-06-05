import { type Address, type Hex, encodeAbiParameters, keccak256 } from "viem";

type QuestionSubmissionRoundConfig = {
  epochDuration: bigint | number;
  maxDuration: bigint | number;
  minVoters: bigint | number;
  maxVoters: bigint | number;
};

type QuestionSubmissionRevealCommitmentParams = {
  categoryId: bigint;
  description: string;
  detailsHash: Hex;
  detailsUrl: string;
  imageUrls: readonly string[];
  questionMetadataHash: Hex;
  rewardAmount: bigint;
  rewardAsset: number;
  requiredSettledRounds: bigint;
  requiredVoters: bigint;
  resultSpecHash: Hex;
  bountyStartBy: bigint;
  bountyWindowSeconds: bigint;
  feedbackWindowSeconds: bigint;
  bountyEligibility: number;
  roundConfig: QuestionSubmissionRoundConfig;
  salt: Hex;
  submissionKey: Hex;
  submitter: Address;
  tags: string;
  title: string;
  videoUrl: string;
};

type QuestionBundleSubmissionItem = {
  categoryId: bigint;
  contextUrl: string;
  description: string;
  detailsHash: Hex;
  detailsUrl: string;
  imageUrls: readonly string[];
  salt: Hex;
  spec: {
    questionMetadataHash: Hex;
    resultSpecHash: Hex;
  };
  tags: string;
  title: string;
  videoUrl: string;
};

type QuestionBundleRevealCommitmentParams = {
  bundleHash: Hex;
  rewardAmount: bigint;
  rewardAsset: number;
  requiredSettledRounds: bigint;
  requiredVoters: bigint;
  bountyStartBy: bigint;
  bountyWindowSeconds: bigint;
  feedbackWindowSeconds: bigint;
  bountyEligibility: number;
  roundConfig: QuestionSubmissionRoundConfig;
  submitter: Address;
};

type QuestionBundleSubmissionRevealCommitmentParams = Omit<QuestionBundleRevealCommitmentParams, "bundleHash"> & {
  questions: readonly QuestionBundleSubmissionItem[];
};

function buildSubmissionMediaHash(imageUrls: readonly string[], videoUrl: string): Hex {
  return keccak256(encodeAbiParameters([{ type: "string[]" }, { type: "string" }], [[...imageUrls], videoUrl]));
}

function buildSubmissionDetailsHash(detailsUrl: string, detailsHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [detailsUrl, detailsHash]));
}

export function buildQuestionSubmissionRevealCommitment(params: QuestionSubmissionRevealCommitmentParams): Hex {
  const mediaHash = buildSubmissionMediaHash(params.imageUrls, params.videoUrl);
  const textHash = keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }],
      [params.title, params.description, params.tags],
    ),
  );
  const rewardTermsHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        params.rewardAsset,
        params.rewardAmount,
        params.requiredVoters,
        params.requiredSettledRounds,
        params.bountyStartBy,
        params.bountyWindowSeconds,
        params.feedbackWindowSeconds,
        params.bountyEligibility,
      ],
    ),
  );
  const roundConfigHash = keccak256(
    encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint32" }, { type: "uint16" }, { type: "uint16" }],
      [
        Number(params.roundConfig.epochDuration),
        Number(params.roundConfig.maxDuration),
        Number(params.roundConfig.minVoters),
        Number(params.roundConfig.maxVoters),
      ],
    ),
  );
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        "rateloop-question-reveal-v5",
        params.submissionKey,
        mediaHash,
        textHash,
        buildSubmissionDetailsHash(params.detailsUrl, params.detailsHash),
        params.categoryId,
        params.salt,
        params.submitter,
        rewardTermsHash,
        roundConfigHash,
        params.questionMetadataHash,
        params.resultSpecHash,
      ],
    ),
  );
}

function buildQuestionBundleHash(questions: readonly QuestionBundleSubmissionItem[]): Hex {
  const questionHashes = questions.map((question, index) =>
    keccak256(
      encodeAbiParameters(
        [
          { type: "string" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "bytes32" },
        ],
        [
          "rateloop-question-bundle-item-v3",
          keccak256(
            encodeAbiParameters(
              [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }],
              [question.contextUrl, question.title, question.description, question.tags],
            ),
          ),
          buildSubmissionMediaHash(question.imageUrls, question.videoUrl),
          buildSubmissionDetailsHash(question.detailsUrl, question.detailsHash),
          question.categoryId,
          question.salt,
          BigInt(index),
          question.spec.questionMetadataHash,
          question.spec.resultSpecHash,
        ],
      ),
    ),
  );

  return keccak256(
    encodeAbiParameters([{ type: "string" }, { type: "bytes32[]" }], ["rateloop-question-bundle-v3", questionHashes]),
  );
}

function buildQuestionBundleRevealCommitment(params: QuestionBundleRevealCommitmentParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint32" },
        { type: "uint32" },
        { type: "uint16" },
        { type: "uint16" },
      ],
      [
        "rateloop-question-bundle-reveal-v4",
        params.bundleHash,
        params.submitter,
        params.rewardAsset,
        params.rewardAmount,
        params.requiredVoters,
        params.requiredSettledRounds,
        params.bountyStartBy,
        params.bountyWindowSeconds,
        params.feedbackWindowSeconds,
        params.bountyEligibility,
        Number(params.roundConfig.epochDuration),
        Number(params.roundConfig.maxDuration),
        Number(params.roundConfig.minVoters),
        Number(params.roundConfig.maxVoters),
      ],
    ),
  );
}

export function buildQuestionBundleSubmissionRevealCommitment(
  params: QuestionBundleSubmissionRevealCommitmentParams,
): Hex {
  return buildQuestionBundleRevealCommitment({
    ...params,
    bundleHash: buildQuestionBundleHash(params.questions),
  });
}
