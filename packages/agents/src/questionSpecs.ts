import { type Hex } from "viem";
import {
  normalizeTargetAudience,
  type TargetAudience,
} from "@rateloop/node-utils/profileSelfReport";
import { canonicalJsonHash } from "@rateloop/node-utils/json";

export const DEFAULT_AGENT_TEMPLATE_ID = "generic_rating";
export const DEFAULT_AGENT_TEMPLATE_VERSION = 1;
export const PREDICTED_RATING_SYSTEM = "rateloop.robust_bts_binary.v1";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentQuestionRoundConfig = {
  epochDuration: bigint | number | string;
  maxDuration: bigint | number | string;
  minVoters: bigint | number | string;
  maxVoters: bigint | number | string;
};

export type AgentQuestionSpecInput = {
  bounty?: {
    amount: bigint | string;
    asset: string;
    bountyEligibility?: bigint | number | string;
    requiredSettledRounds?: bigint | string;
    requiredVoters?: bigint | string;
  };
  categoryId: bigint | string;
  contextUrl: string;
  imageUrls: readonly string[];
  roundConfig?: AgentQuestionRoundConfig;
  study?: {
    bundleIndex?: number;
    studyId?: string;
  } | null;
  targetAudience?: TargetAudience | JsonValue | null;
  tags: readonly string[];
  templateInputs?: JsonValue;
  templateId?: string;
  templateVersion?: number;
  title: string;
  videoUrl: string;
  voteSemantics?: {
    down: string;
    up: string;
  };
};

function serializeRoundConfig(config: AgentQuestionRoundConfig) {
  return {
    epochDuration: config.epochDuration.toString(),
    maxDuration: config.maxDuration.toString(),
    minVoters: config.minVoters.toString(),
    maxVoters: config.maxVoters.toString(),
  };
}

export function hashCanonicalJson(value: JsonValue): Hex {
  return canonicalJsonHash(value);
}

export function buildQuestionMetadata(
  input: AgentQuestionSpecInput,
): JsonValue {
  const targetAudience = normalizeTargetAudience(
    input.targetAudience,
  ) as JsonValue;
  return {
    bounty: input.bounty
      ? {
          amount: input.bounty.amount.toString(),
          asset: input.bounty.asset,
          bountyEligibility: input.bounty.bountyEligibility?.toString() ?? "0",
          requiredSettledRounds:
            input.bounty.requiredSettledRounds?.toString() ?? null,
          requiredVoters: input.bounty.requiredVoters?.toString() ?? null,
        }
      : null,
    categoryId: input.categoryId.toString(),
    contextUrl: input.contextUrl,
    imageUrls: [...input.imageUrls],
    roundConfig: input.roundConfig
      ? serializeRoundConfig(input.roundConfig)
      : null,
    schemaVersion: "rateloop.question.v2",
    study: input.study ?? null,
    targetAudience,
    tags: [...input.tags],
    templateInputs: input.templateInputs ?? null,
    templateId: input.templateId ?? DEFAULT_AGENT_TEMPLATE_ID,
    templateVersion: input.templateVersion ?? DEFAULT_AGENT_TEMPLATE_VERSION,
    title: input.title,
    videoUrl: input.videoUrl,
  };
}

export function buildDefaultResultSpec(
  templateId = DEFAULT_AGENT_TEMPLATE_ID,
  templateVersion = DEFAULT_AGENT_TEMPLATE_VERSION,
  voteSemantics: AgentQuestionSpecInput["voteSemantics"] = {
    down: "lower support for the submitted question",
    up: "higher support for the submitted question",
  },
): JsonValue {
  return {
    confidenceInputs: [
      "revealedCount",
      "totalStake",
      "predictedUpDistribution",
      "upPool",
      "downPool",
      "ratingBps",
      "conservativeRatingBps",
      "confidenceMass",
      "effectiveEvidence",
    ],
    predictionScale: {
      display: "0-100% up",
      maxBps: 10000,
      minBps: 0,
      unit: "predicted share of up votes",
    },
    ratingSystem: PREDICTED_RATING_SYSTEM,
    schemaVersion: "rateloop.result_spec.v1",
    templateId,
    templateVersion,
    voteSemantics,
  };
}

export function buildQuestionSpecHashes(input: AgentQuestionSpecInput) {
  const questionMetadata = buildQuestionMetadata(input);
  const resultSpec = buildDefaultResultSpec(
    input.templateId,
    input.templateVersion,
    input.voteSemantics,
  );

  return {
    questionMetadata,
    questionMetadataHash: hashCanonicalJson(questionMetadata),
    resultSpec,
    resultSpecHash: hashCanonicalJson(resultSpec),
  };
}
