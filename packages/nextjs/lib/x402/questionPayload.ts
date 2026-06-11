import { normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import { createHash } from "crypto";
import { buildQuestionSpecHashes } from "~~/lib/agent/questionSpecs";
import {
  type AgentQuestionSpecInput,
  DEFAULT_AGENT_TEMPLATE_ID,
  DEFAULT_AGENT_TEMPLATE_VERSION,
} from "~~/lib/agent/questionSpecs";
import { findAgentResultTemplate } from "~~/lib/agent/templates";
import { normalizeUploadedImageAttachmentUrl } from "~~/lib/attachments/imageAttachmentUrls";
import { isSupportedBountyEligibility } from "~~/lib/bountyEligibility";
import { normalizeSubmissionContextUrl } from "~~/lib/contentMedia";
import { getContentTitleValidationError } from "~~/lib/moderation/submissionValidation";
import { findBlockedContentTags } from "~~/lib/moderation/submissionValidation";
import {
  DEFAULT_QUESTION_ROUND_CONFIG,
  type QuestionRoundConfig,
  requiredQuestionRewardVotersForAmount,
  serializeQuestionRoundConfig,
} from "~~/lib/questionRoundConfig";

export const X402_WORLD_CHAIN_USDC_BY_CHAIN_ID: Record<number, `0x${string}`> = {
  480: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  4801: "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
};

export const X402_SUBMISSION_REWARD_ASSET_USDC = 1;
export const X402_USDC_DECIMALS = 6;
const X402_DEFAULT_SUBMISSION_BOUNTY_USDC = 1_000_000n;
const X402_MIN_REWARD_POOL_REQUIRED_VOTERS = 3n;
const X402_MIN_REWARD_POOL_SETTLED_ROUNDS = 1n;
const X402_MAX_QUESTION_BUNDLE_COUNT = 10;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as const;

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,160}$/;

export class X402QuestionInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "X402QuestionInputError";
  }
}

export type X402QuestionPayload = {
  clientRequestId: string;
  chainId: number;
  questions: X402QuestionItemPayload[];
  roundConfig: QuestionRoundConfig;
  bounty: {
    asset: "USDC";
    amount: bigint;
    requiredVoters: bigint;
    requiredSettledRounds: bigint;
    bountyStartBy: bigint;
    bountyWindowSeconds: bigint;
    feedbackWindowSeconds: bigint;
    bountyEligibility: number;
  };
};

export type X402QuestionItemPayload = {
  contextUrl: string;
  imageUrls: string[];
  videoUrl: string;
  title: string;
  detailsHash: `0x${string}`;
  detailsUrl: string;
  tags: string;
  tagList: string[];
  categoryId: bigint;
  targetAudience: AgentQuestionSpecInput["targetAudience"];
  templateId: string;
  templateInputs: AgentQuestionSpecInput["templateInputs"];
  templateVersion: number;
  questionMetadataHash: `0x${string}`;
  resultSpecHash: `0x${string}`;
};

export type X402QuestionOperation = {
  operationKey: `0x${string}`;
  payloadHash: string;
  canonicalPayload: ReturnType<typeof toCanonicalQuestionPayload>;
};

export function assertSupportedX402BundleBounty(
  bounty: Pick<X402QuestionPayload["bounty"], "bountyStartBy" | "bountyWindowSeconds">,
) {
  if (bounty.bountyStartBy <= 0n) {
    throw new X402QuestionInputError("bounty.bountyStartBy must be greater than zero for bundle submissions.");
  }
  if (bounty.bountyWindowSeconds <= 0n) {
    throw new X402QuestionInputError("bounty.bountyWindowSeconds must be greater than zero for bundle submissions.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new X402QuestionInputError(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new X402QuestionInputError(`${fieldName} is required.`);
  }

  return trimmed;
}

function readOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalBytes32Hex(value: unknown, fieldName: string): `0x${string}` {
  if (value === undefined || value === null || value === "") {
    return EMPTY_DETAILS_HASH;
  }
  if (typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value as `0x${string}`;
  }

  throw new X402QuestionInputError(`${fieldName} must be a bytes32 hex string.`);
}

function parseNonNegativeInteger(value: unknown, fieldName: string): bigint {
  const rawValue =
    typeof value === "bigint" || typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^\d+$/.test(rawValue)) {
    throw new X402QuestionInputError(`${fieldName} must be a non-negative integer.`);
  }

  return BigInt(rawValue);
}

function parsePositiveAtomicAmount(value: unknown, fieldName: string): bigint {
  const parsed = parseNonNegativeInteger(value, fieldName);
  if (parsed <= 0n) {
    throw new X402QuestionInputError(`${fieldName} must be greater than zero.`);
  }
  return parsed;
}

function normalizeHttpsUrl(value: string, fieldName: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      throw new X402QuestionInputError(`${fieldName} must be an HTTPS URL.`);
    }
    if (parsed.username || parsed.password) {
      throw new X402QuestionInputError(`${fieldName} must not include credentials.`);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof X402QuestionInputError) throw error;
    throw new X402QuestionInputError(`${fieldName} must be a valid HTTPS URL.`);
  }
}

function normalizeQuestionContextUrl(value: string, fieldName: string): string {
  const normalized = normalizeSubmissionContextUrl(normalizeHttpsUrl(value, fieldName));
  if (!normalized) {
    throw new X402QuestionInputError(`${fieldName} must be a public HTTPS page URL. Upload images through imageUrls.`);
  }
  return normalized;
}

function normalizeQuestionDetails(value: Record<string, unknown>, fieldPrefix: string) {
  const detailsUrl = readOptionalString(value.detailsUrl);
  const detailsHash = readOptionalBytes32Hex(value.detailsHash, `${fieldPrefix}.detailsHash`);

  if (detailsUrl) {
    if (detailsHash === EMPTY_DETAILS_HASH) {
      throw new X402QuestionInputError(`${fieldPrefix}.detailsHash is required when detailsUrl is provided.`);
    }
    return {
      detailsHash,
      detailsUrl: normalizeHttpsUrl(detailsUrl, `${fieldPrefix}.detailsUrl`),
    };
  }

  if (detailsHash !== EMPTY_DETAILS_HASH) {
    throw new X402QuestionInputError(`${fieldPrefix}.detailsUrl is required when detailsHash is provided.`);
  }

  return {
    detailsHash,
    detailsUrl: "",
  };
}

function isYouTubeVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return parsed.pathname.length > 1;
    if (host === "www.youtube.com" && parsed.pathname.startsWith("/embed/")) {
      return parsed.pathname.length > "/embed/".length;
    }

    return (
      (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") &&
      parsed.pathname === "/watch" &&
      parsed.searchParams.has("v")
    );
  } catch {
    return false;
  }
}

function isUploadedImageUrl(url: string): boolean {
  return Boolean(normalizeUploadedImageAttachmentUrl(url));
}

function normalizeImageUrls(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new X402QuestionInputError(
      "imageUrls must be an array of RateLoop imageUrl values returned by rateloop_upload_image.",
    );
  }

  const imageUrls = value.map((entry, index) => {
    const normalized = normalizeHttpsUrl(readString(entry, `imageUrls[${index}]`), `imageUrls[${index}]`);
    if (!isUploadedImageUrl(normalized)) {
      throw new X402QuestionInputError(
        "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
      );
    }
    return normalized;
  });

  if (imageUrls.length > 4) {
    throw new X402QuestionInputError("imageUrls supports at most four images.");
  }

  return imageUrls;
}

function normalizeTags(value: unknown): { tags: string; tagList: string[] } {
  const rawTags = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tagList = rawTags
    .map(tag => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);

  if (tagList.length === 0) {
    throw new X402QuestionInputError("At least one tag is required.");
  }
  if (tagList.length > 3) {
    throw new X402QuestionInputError("At most three tags are supported.");
  }

  const blockedTags = findBlockedContentTags(tagList);
  if (blockedTags.length > 0) {
    throw new X402QuestionInputError("Tags contain prohibited content.");
  }

  return {
    tagList,
    tags: tagList.join(","),
  };
}

function normalizeTemplateInputs(value: unknown, fieldName: string): AgentQuestionSpecInput["templateInputs"] {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) {
    throw new X402QuestionInputError(`${fieldName} must be an object when provided.`);
  }

  try {
    return JSON.parse(JSON.stringify(value)) as AgentQuestionSpecInput["templateInputs"];
  } catch {
    throw new X402QuestionInputError(`${fieldName} must be JSON serializable.`);
  }
}

function normalizeQuestionTargetAudience(value: unknown, fieldName: string): AgentQuestionSpecInput["targetAudience"] {
  try {
    return normalizeTargetAudience(value, { fieldPrefix: fieldName }) as AgentQuestionSpecInput["targetAudience"];
  } catch (error) {
    if (error instanceof Error) {
      throw new X402QuestionInputError(error.message);
    }
    throw new X402QuestionInputError(`${fieldName} is invalid.`);
  }
}

function normalizeTemplateSelection(
  value: Record<string, unknown>,
  fieldPrefix: string,
  defaults: {
    templateId?: string;
    templateInputs?: AgentQuestionSpecInput["templateInputs"];
    templateVersion?: number;
  },
) {
  const rawTemplateId = readOptionalString(value.templateId) || defaults.templateId || DEFAULT_AGENT_TEMPLATE_ID;
  const template = findAgentResultTemplate(rawTemplateId);
  if (!template) {
    throw new X402QuestionInputError(`${fieldPrefix}.templateId is not supported.`);
  }

  const templateVersion =
    value.templateVersion === undefined || value.templateVersion === null
      ? (defaults.templateVersion ?? template.version)
      : Number.parseInt(String(value.templateVersion), 10);
  if (!Number.isSafeInteger(templateVersion) || templateVersion <= 0) {
    throw new X402QuestionInputError(`${fieldPrefix}.templateVersion must be a positive integer.`);
  }
  if (templateVersion !== template.version) {
    throw new X402QuestionInputError(
      `${fieldPrefix}.templateVersion ${templateVersion} is not supported for ${template.id}.`,
    );
  }

  const templateInputs =
    value.templateInputs === undefined
      ? (defaults.templateInputs ?? null)
      : normalizeTemplateInputs(value.templateInputs, `${fieldPrefix}.templateInputs`);

  return {
    template,
    templateId: template.id,
    templateInputs,
    templateVersion,
  };
}

function normalizeChainId(value: unknown, fallbackChainId?: number): number {
  const rawValue = value ?? fallbackChainId;
  const chainId = typeof rawValue === "number" ? rawValue : Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new X402QuestionInputError("chainId must be a positive integer.");
  }

  return chainId;
}

function normalizeBounty(value: unknown): X402QuestionPayload["bounty"] {
  if (!isObject(value)) {
    throw new X402QuestionInputError("bounty is required.");
  }

  const asset = readOptionalString(value.asset).toUpperCase() || "USDC";
  if (asset !== "USDC") {
    throw new X402QuestionInputError("Only USDC bounties are supported for agent question submissions.");
  }

  const amount = parsePositiveAtomicAmount(value.amount, "bounty.amount");
  const requiredVoters = parseNonNegativeInteger(
    value.requiredVoters ?? X402_MIN_REWARD_POOL_REQUIRED_VOTERS,
    "bounty.requiredVoters",
  );
  const requiredSettledRounds = parseNonNegativeInteger(
    value.requiredSettledRounds ?? X402_MIN_REWARD_POOL_SETTLED_ROUNDS,
    "bounty.requiredSettledRounds",
  );
  const bountyStartBy = parseNonNegativeInteger(value.bountyStartBy ?? 0n, "bounty.bountyStartBy");
  const bountyWindowSeconds = parseNonNegativeInteger(value.bountyWindowSeconds ?? 0n, "bounty.bountyWindowSeconds");
  const feedbackWindowSeconds = parseNonNegativeInteger(
    value.feedbackWindowSeconds ?? value.bountyWindowSeconds ?? 0n,
    "bounty.feedbackWindowSeconds",
  );
  const bountyEligibility = Number(parseNonNegativeInteger(value.bountyEligibility ?? 0n, "bounty.bountyEligibility"));

  if (requiredVoters < X402_MIN_REWARD_POOL_REQUIRED_VOTERS) {
    throw new X402QuestionInputError(`bounty.requiredVoters must be at least ${X402_MIN_REWARD_POOL_REQUIRED_VOTERS}.`);
  }
  const requiredVoterFloor = requiredQuestionRewardVotersForAmount(amount);
  if (requiredVoters < requiredVoterFloor) {
    throw new X402QuestionInputError(
      `bounty.requiredVoters must be at least ${requiredVoterFloor} for this bounty amount.`,
    );
  }
  if (requiredSettledRounds < X402_MIN_REWARD_POOL_SETTLED_ROUNDS) {
    throw new X402QuestionInputError(
      `bounty.requiredSettledRounds must be at least ${X402_MIN_REWARD_POOL_SETTLED_ROUNDS}.`,
    );
  }
  if (amount < X402_DEFAULT_SUBMISSION_BOUNTY_USDC) {
    throw new X402QuestionInputError("bounty.amount must be at least 1000000 atomic USDC.");
  }
  if (amount < requiredVoters * requiredSettledRounds) {
    throw new X402QuestionInputError("bounty.amount is too small for the selected voter requirements.");
  }
  if (feedbackWindowSeconds > bountyWindowSeconds) {
    throw new X402QuestionInputError("bounty.feedbackWindowSeconds cannot exceed bounty.bountyWindowSeconds.");
  }
  if (!isSupportedBountyEligibility(bountyEligibility)) {
    throw new X402QuestionInputError(
      "bounty.bountyEligibility must be 0 or a supported credential bitmask: 2 Selfie Check, 4 Passport, 8 Proof of Human, add values to allow any selected credential, and add 128 to require a recent recheck.",
    );
  }
  assertSupportedX402BundleBounty({
    bountyStartBy,
    bountyWindowSeconds,
  });

  return {
    asset: "USDC",
    amount,
    requiredVoters,
    requiredSettledRounds,
    bountyStartBy,
    bountyWindowSeconds,
    feedbackWindowSeconds,
    bountyEligibility,
  };
}

function normalizeRoundConfig(value: unknown, requiredVoters: bigint): QuestionRoundConfig {
  if (value === undefined || value === null) {
    return {
      ...DEFAULT_QUESTION_ROUND_CONFIG,
      minVoters: requiredVoters,
      maxVoters:
        DEFAULT_QUESTION_ROUND_CONFIG.maxVoters < requiredVoters
          ? requiredVoters
          : DEFAULT_QUESTION_ROUND_CONFIG.maxVoters,
    };
  }
  if (!isObject(value)) {
    throw new X402QuestionInputError("question.roundConfig must be an object.");
  }

  const epochDuration = parseNonNegativeInteger(
    value.epochDuration ?? value.blindPhaseSeconds ?? value.blindSeconds,
    "question.roundConfig.epochDuration",
  );
  const maxDuration = parseNonNegativeInteger(
    value.maxDuration ?? value.maxDurationSeconds ?? value.deadlineSeconds,
    "question.roundConfig.maxDuration",
  );
  const minVoters = parseNonNegativeInteger(value.minVoters, "question.roundConfig.minVoters");
  const maxVoters = parseNonNegativeInteger(value.maxVoters, "question.roundConfig.maxVoters");

  if (epochDuration <= 0n) {
    throw new X402QuestionInputError("question.roundConfig.epochDuration must be greater than zero.");
  }
  if (maxDuration <= 0n) {
    throw new X402QuestionInputError("question.roundConfig.maxDuration must be greater than zero.");
  }
  if (minVoters <= 0n || maxVoters <= 0n || maxVoters < minVoters) {
    throw new X402QuestionInputError("question.roundConfig voter values are invalid.");
  }
  if (minVoters !== requiredVoters) {
    throw new X402QuestionInputError("question.roundConfig.minVoters must match bounty.requiredVoters.");
  }

  return { epochDuration, maxDuration, minVoters, maxVoters };
}

type NormalizedQuestionInput = Omit<X402QuestionItemPayload, "questionMetadataHash" | "resultSpecHash"> & {
  template: NonNullable<ReturnType<typeof findAgentResultTemplate>>;
};

function normalizeQuestion(
  value: unknown,
  index: number,
  defaults: {
    templateId?: string;
    templateInputs?: AgentQuestionSpecInput["templateInputs"];
    templateVersion?: number;
  },
): NormalizedQuestionInput {
  if (!isObject(value)) {
    throw new X402QuestionInputError(`questions[${index}] must be an object.`);
  }

  const fieldPrefix = `questions[${index}]`;
  const title = readString(value.title, `${fieldPrefix}.title`);
  const titleError = getContentTitleValidationError(title);
  if (titleError) {
    throw new X402QuestionInputError(titleError);
  }

  const imageUrls = normalizeImageUrls(value.imageUrls);
  const rawContextUrl = readOptionalString(value.contextUrl);
  const contextUrl = rawContextUrl ? normalizeQuestionContextUrl(rawContextUrl, `${fieldPrefix}.contextUrl`) : "";
  const rawVideoUrl = readOptionalString(value.videoUrl);
  const videoUrl = rawVideoUrl ? normalizeHttpsUrl(rawVideoUrl, `${fieldPrefix}.videoUrl`) : "";
  if (videoUrl && !isYouTubeVideoUrl(videoUrl)) {
    throw new X402QuestionInputError(`${fieldPrefix}.videoUrl must be a supported YouTube URL.`);
  }
  if (videoUrl && imageUrls.length > 0) {
    throw new X402QuestionInputError("Use imageUrls or videoUrl, not both.");
  }
  if (!contextUrl && imageUrls.length === 0 && !videoUrl) {
    throw new X402QuestionInputError(`${fieldPrefix}.contextUrl, imageUrls, or videoUrl is required.`);
  }

  const { tags, tagList } = normalizeTags(value.tags);
  const categoryId = parseNonNegativeInteger(value.categoryId, `${fieldPrefix}.categoryId`);
  const details = normalizeQuestionDetails(value, fieldPrefix);
  const targetAudience = normalizeQuestionTargetAudience(value.targetAudience, `${fieldPrefix}.targetAudience`);
  const templateSelection = normalizeTemplateSelection(value, fieldPrefix, defaults);

  return {
    categoryId,
    contextUrl,
    detailsHash: details.detailsHash,
    detailsUrl: details.detailsUrl,
    imageUrls,
    tags,
    tagList,
    targetAudience,
    template: templateSelection.template,
    templateId: templateSelection.templateId,
    templateInputs: templateSelection.templateInputs,
    templateVersion: templateSelection.templateVersion,
    title,
    videoUrl,
  };
}

/**
 * WS-4 (2026-05-21 repo audit): every legitimate top-level field accepted by
 * `parseX402QuestionRequest` AND its known direct callers — `lib/agent/signingIntents.ts`
 * (which persists the requestBody verbatim and spreads it into the MCP tool call) and the
 * MCP tool flows in `lib/mcp/tools.ts` (`rateloop_quote_question`, `rateloop_ask_humans`, both
 * managed and public variants). Reading only known fields here while persisting / forwarding
 * unknown ones is a mass-assignment hazard for any field a downstream consumer reads.
 *
 * Adding a new top-level field requires extending this set explicitly.
 */
const X402_QUESTION_TOP_LEVEL_FIELDS = new Set<string>([
  // Used by parseX402QuestionRequest itself
  "clientRequestId",
  "questions",
  "question",
  "roundConfig",
  "bounty",
  "templateId",
  "templateInputs",
  "templateVersion",
  "chainId",
  // Used by signingIntents.ts when persisting the same requestBody
  "maxPaymentAmount",
  "paymentMode",
  "fundingMode",
  "walletAddress",
  "agentWalletAddress",
  // Used by lib/mcp/tools.ts when the same args object is also handed to
  // parseAskHumansMode / parseWebhookOptions / EIP-3009 authorization orchestration. Each of
  // these has its own dedicated validator that runs after parseX402QuestionRequest; we keep
  // them in the allowlist so the strict gate does not pre-empt those error messages.
  "mode",
  "webhookUrl",
  "webhookSecret",
  "webhookEvents",
  "webhookChallengeId",
  "webhookSignature",
  "paymentAuthorization",
  "dryRun",
  "executionMode",
  "sandbox",
  // Used by the public SDK's `AskHumansRequest` type (packages/sdk/src/agent.ts). The Next.js
  // signing-intents POST persists the request body as-is, and these fields are part of the
  // public contract — `signatureMode` selects browser-handoff vs agent_signs, `transport`
  // selects http vs mcp.
  "signatureMode",
  "transport",
]);

export function parseX402QuestionRequest(value: unknown, fallbackChainId?: number): X402QuestionPayload {
  if (!isObject(value)) {
    throw new X402QuestionInputError("Request body must be a JSON object.");
  }

  // WS-4: strict allowlist on top-level fields — reject anything we don't recognize so it
  // cannot smuggle through to the MCP tool call after intent preparation.
  for (const key of Object.keys(value)) {
    if (!X402_QUESTION_TOP_LEVEL_FIELDS.has(key)) {
      throw new X402QuestionInputError(`Unknown top-level field: ${key}`);
    }
  }

  const clientRequestId = readString(value.clientRequestId, "clientRequestId");
  if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    throw new X402QuestionInputError(
      "clientRequestId must be 4-160 characters using letters, numbers, dot, dash, colon, or underscore.",
    );
  }

  const rawQuestions = Array.isArray(value.questions)
    ? value.questions
    : [isObject(value.question) ? value.question : value];
  if (rawQuestions.length === 0) {
    throw new X402QuestionInputError("At least one question is required.");
  }
  if (rawQuestions.length > X402_MAX_QUESTION_BUNDLE_COUNT) {
    throw new X402QuestionInputError(`At most ${X402_MAX_QUESTION_BUNDLE_COUNT} questions are supported.`);
  }

  const firstQuestion = isObject(rawQuestions[0]) ? rawQuestions[0] : {};
  const bounty = normalizeBounty(value.bounty);
  const roundConfig = normalizeRoundConfig(value.roundConfig ?? firstQuestion.roundConfig, bounty.requiredVoters);
  const topLevelTemplateInputs = normalizeTemplateInputs(value.templateInputs, "templateInputs");
  const topLevelTemplateVersion =
    value.templateVersion === undefined || value.templateVersion === null
      ? DEFAULT_AGENT_TEMPLATE_VERSION
      : Number.parseInt(String(value.templateVersion), 10);
  const templateDefaults = {
    templateId: readOptionalString(value.templateId) || DEFAULT_AGENT_TEMPLATE_ID,
    templateInputs: topLevelTemplateInputs,
    templateVersion: topLevelTemplateVersion,
  };
  const questions = rawQuestions.map((question, index) => {
    const normalizedQuestion = normalizeQuestion(question, index, templateDefaults);
    const spec = buildQuestionSpecHashes({
      bounty: {
        amount: bounty.amount,
        asset: bounty.asset,
        bountyEligibility: bounty.bountyEligibility,
        requiredSettledRounds: bounty.requiredSettledRounds,
        requiredVoters: bounty.requiredVoters,
      },
      categoryId: normalizedQuestion.categoryId,
      contextUrl: normalizedQuestion.contextUrl,
      imageUrls: normalizedQuestion.imageUrls,
      roundConfig,
      study: {
        bundleIndex: index,
      },
      tags: normalizedQuestion.tagList,
      targetAudience: normalizedQuestion.targetAudience,
      templateId: normalizedQuestion.templateId,
      templateInputs: normalizedQuestion.templateInputs,
      templateVersion: normalizedQuestion.templateVersion,
      title: normalizedQuestion.title,
      videoUrl: normalizedQuestion.videoUrl,
      voteSemantics: normalizedQuestion.template.voteSemantics,
    });

    return {
      categoryId: normalizedQuestion.categoryId,
      contextUrl: normalizedQuestion.contextUrl,
      detailsHash: normalizedQuestion.detailsHash,
      detailsUrl: normalizedQuestion.detailsUrl,
      imageUrls: normalizedQuestion.imageUrls,
      questionMetadataHash: spec.questionMetadataHash,
      resultSpecHash: spec.resultSpecHash,
      tags: normalizedQuestion.tags,
      tagList: normalizedQuestion.tagList,
      targetAudience: normalizedQuestion.targetAudience,
      templateId: normalizedQuestion.templateId,
      templateInputs: normalizedQuestion.templateInputs,
      templateVersion: normalizedQuestion.templateVersion,
      title: normalizedQuestion.title,
      videoUrl: normalizedQuestion.videoUrl,
    };
  });

  return {
    clientRequestId,
    chainId: normalizeChainId(value.chainId ?? firstQuestion.chainId, fallbackChainId),
    questions,
    roundConfig,
    bounty,
  };
}

export function toCanonicalQuestionPayload(payload: X402QuestionPayload) {
  return {
    bounty: {
      amount: payload.bounty.amount.toString(),
      asset: payload.bounty.asset,
      requiredSettledRounds: payload.bounty.requiredSettledRounds.toString(),
      requiredVoters: payload.bounty.requiredVoters.toString(),
      bountyStartBy: payload.bounty.bountyStartBy.toString(),
      bountyWindowSeconds: payload.bounty.bountyWindowSeconds.toString(),
      feedbackWindowSeconds: payload.bounty.feedbackWindowSeconds.toString(),
      bountyEligibility: String(payload.bounty.bountyEligibility),
    },
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    questions: payload.questions.map(question => ({
      categoryId: question.categoryId.toString(),
      contextUrl: question.contextUrl,
      detailsHash: question.detailsHash,
      detailsUrl: question.detailsUrl,
      imageUrls: question.imageUrls,
      questionMetadataHash: question.questionMetadataHash,
      resultSpecHash: question.resultSpecHash,
      tags: question.tagList,
      targetAudience: question.targetAudience,
      templateId: question.templateId,
      templateInputs: question.templateInputs,
      templateVersion: question.templateVersion,
      title: question.title,
      videoUrl: question.videoUrl,
    })),
    roundConfig: serializeQuestionRoundConfig(payload.roundConfig),
  };
}

export function buildX402QuestionOperation(payload: X402QuestionPayload): X402QuestionOperation {
  assertSupportedX402BundleBounty(payload.bounty);
  const canonicalPayload = toCanonicalQuestionPayload(payload);
  const payloadHash = createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
  const operationKey =
    `0x${createHash("sha256").update(`rateloop:x402-question:${payloadHash}`).digest("hex")}` as const;

  return {
    canonicalPayload,
    operationKey,
    payloadHash,
  };
}
