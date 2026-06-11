import { type Hex } from "viem";
import {
  normalizeTargetAudience,
  type TargetAudience,
} from "@rateloop/node-utils/profileSelfReport";
import { canonicalJsonHash } from "@rateloop/node-utils/json";

export const DEFAULT_AGENT_TEMPLATE_ID = "generic_rating";
export const DEFAULT_AGENT_TEMPLATE_VERSION = 1;
export const PREDICTED_RATING_SYSTEM = "rateloop.robust_bts_binary.v1";
export const DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY = "after_settlement";
export const DEFAULT_QUESTION_METADATA_BASE_URL = "https://rateloop.ai";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentQuestionConfidentialityInput = {
  visibility?: "public" | "gated";
  disclosurePolicy?: "after_settlement" | "private_until_settlement" | "private_forever" | null;
  bond?: {
    amount?: bigint | number | string | null;
    asset?: "LREP" | "USDC" | "lrep" | "usdc" | string | null;
  } | null;
} | null;

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
  confidentiality?: AgentQuestionConfidentialityInput;
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

export function normalizeQuestionConfidentiality(
  input: AgentQuestionConfidentialityInput | undefined,
): JsonValue {
  const visibility = input?.visibility === "gated" ? "gated" : "public";
  if (visibility === "public") {
    return {
      bond: null,
      disclosurePolicy: null,
      visibility,
    };
  }

  const rawPolicy = input?.disclosurePolicy ?? DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY;
  const disclosurePolicy =
    rawPolicy === "private_until_settlement" ? DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY : rawPolicy;
  const rawBond = input?.bond ?? null;
  const amount = rawBond?.amount === undefined || rawBond?.amount === null ? "0" : rawBond.amount.toString();
  const asset = (rawBond?.asset ?? "LREP").toString().toUpperCase();

  return {
    bond: {
      amount,
      asset,
    },
    disclosurePolicy,
    visibility,
  };
}

export function hashCanonicalJson(value: JsonValue): Hex {
  return canonicalJsonHash(value);
}

export function normalizeQuestionMetadataBaseUrl(baseUrl: string | null | undefined) {
  const raw = baseUrl?.trim() || DEFAULT_QUESTION_METADATA_BASE_URL;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return DEFAULT_QUESTION_METADATA_BASE_URL;
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return DEFAULT_QUESTION_METADATA_BASE_URL;
  }
}

export function buildQuestionMetadataUri(
  questionMetadataHash: Hex,
  baseUrl?: string | null,
) {
  return `${normalizeQuestionMetadataBaseUrl(baseUrl)}/question-metadata/${questionMetadataHash.toLowerCase()}`;
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
    confidentiality: normalizeQuestionConfidentiality(input.confidentiality),
    contextUrl: input.contextUrl,
    imageUrls: [...input.imageUrls],
    roundConfig: input.roundConfig
      ? serializeRoundConfig(input.roundConfig)
      : null,
    schemaVersion: "rateloop.question.v3",
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

export type BuildQuestionSpecHashOptions = {
  questionMetadataBaseUrl?: string | null;
};

export function buildQuestionSpecHashes(
  input: AgentQuestionSpecInput,
  options: BuildQuestionSpecHashOptions = {},
) {
  const questionMetadata = buildQuestionMetadata(input);
  const questionMetadataHash = hashCanonicalJson(questionMetadata);
  const resultSpec = buildDefaultResultSpec(
    input.templateId,
    input.templateVersion,
    input.voteSemantics,
  );

  return {
    questionMetadata,
    questionMetadataHash,
    questionMetadataUri: buildQuestionMetadataUri(
      questionMetadataHash,
      options.questionMetadataBaseUrl,
    ),
    resultSpec,
    resultSpecHash: hashCanonicalJson(resultSpec),
  };
}
