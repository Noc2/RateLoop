import {
  DEFAULT_ROUND_CONFIG,
  CONFIDENTIALITY_FLAG_PRIVATE_FOREVER,
  MIN_NONZERO_CONFIDENTIALITY_BOND,
  USDC_BY_CHAIN_ID,
  requiredQuestionRewardParticipants,
} from "@rateloop/contracts/protocol";
import { normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import {
  findBlockedContentTags,
  getContentTitleValidationError,
} from "@rateloop/node-utils/submissionValidation";
import { X402_QUESTION_TOP_LEVEL_FIELDS } from "@rateloop/node-utils/x402QuestionFields";
import {
  DEFAULT_AGENT_TEMPLATE_ID,
  DEFAULT_AGENT_TEMPLATE_VERSION,
  buildQuestionMetadataUri,
  buildQuestionSpecHashes,
  normalizeQuestionMetadataBaseUrl,
  type AgentQuestionRoundConfig,
  type AgentQuestionSpecInput,
} from "./questionSpecs";
import { findAgentResultTemplate } from "./templates";
import { getHeadToHeadAbTitleValidationError } from "./headToHeadTitle.js";
import { HEAD_TO_HEAD_AB_TEMPLATE_ID, readHeadToHeadTemplateInputs } from "./voteUi.js";
import { encodeAbiParameters, keccak256, sha256, toBytes, type Address, type Hex } from "viem";

export const X402_USDC_BY_CHAIN_ID = USDC_BY_CHAIN_ID;
/** @deprecated Use `X402_USDC_BY_CHAIN_ID`. */
export const X402_WORLD_CHAIN_USDC_BY_CHAIN_ID = X402_USDC_BY_CHAIN_ID;
export const X402_SUBMISSION_REWARD_ASSET_LREP = 0;
export const X402_SUBMISSION_REWARD_ASSET_USDC = 1;
export const X402_USDC_DECIMALS = 6;
export const X402_MIN_NONZERO_CONFIDENTIALITY_BOND = MIN_NONZERO_CONFIDENTIALITY_BOND;
export const X402_CONFIDENTIALITY_BOND_UINT64_MAX = (1n << 64n) - 1n;

const X402_DEFAULT_SUBMISSION_BOUNTY = 1_000_000n;
const X402_MIN_REWARD_POOL_REQUIRED_VOTERS = 3n;
const X402_MIN_REWARD_POOL_SETTLED_ROUNDS = 1n;
const X402_MAX_QUESTION_BUNDLE_COUNT = 10;
export const X402_ROUND_CONFIG_UINT32_MAX = 4_294_967_295n;
export const X402_ROUND_CONFIG_UINT16_MAX = 65_535n;
const EMPTY_DETAILS_HASH = `0x${"0".repeat(64)}` as const;
const AFTER_SETTLEMENT_DISCLOSURE_POLICY = "after_settlement";
const DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY = "private_forever";
const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,160}$/;
const DIRECT_IMAGE_URL_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const QUESTION_DETAILS_PATH_PATTERN = /^(?:\/.*)?\/api\/attachments\/details\/det_[A-Za-z0-9_-]{16,80}$/;
const IMAGE_ATTACHMENT_PATH_PATTERN = /^(?:\/.*)?\/api\/attachments\/images\/(att_[A-Za-z0-9_-]{16,80})\.webp$/;
const IMAGE_ATTACHMENT_SHA256_FRAGMENT_PATTERN = /^#sha256=0x([a-fA-F0-9]{64})$/;
const RATELOOP_PRODUCTION_ORIGINS = ["https://www.rateloop.ai", "https://rateloop.ai"] as const;
const X402_BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN = 8;
const X402_QUESTION_PAYMENT_DOMAIN = keccak256(toBytes("rateloop-x402-question-payment-v4"));
const X402_QUESTION_ONE_SHOT_PAYMENT_DOMAIN = keccak256(toBytes("rateloop-x402-question-one-shot-payment-v6"));
const QUESTION_CONTEXT_DOMAIN = keccak256(toBytes("rateloop-question-context-v5"));

export class X402QuestionInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "X402QuestionInputError";
  }
}

export type X402QuestionRoundConfig = {
  epochDuration: bigint;
  maxDuration: bigint;
  minVoters: bigint;
  maxVoters: bigint;
};

export const X402_PURE_AGENT_FAST_ROUND_PRESET_ID = "pure_agent_fast" as const;

export type X402QuestionRoundPresetId = typeof X402_PURE_AGENT_FAST_ROUND_PRESET_ID;

export const X402_PURE_AGENT_FAST_ROUND_CONFIG = {
  epochDuration: 60n,
  maxDuration: 60n,
  minVoters: 3n,
  maxVoters: 3n,
} satisfies X402QuestionRoundConfig;

export type SerializedX402QuestionRoundConfig = {
  questionDurationSeconds: string;
  minVoters: string;
  maxVoters: string;
};

export type X402QuestionPayload = {
  clientRequestId: string;
  chainId: number;
  questions: X402QuestionItemPayload[];
  roundConfig: X402QuestionRoundConfig;
  bounty: {
    asset: "LREP" | "USDC";
    amount: bigint;
    requiredVoters: bigint;
    requiredSettledRounds: bigint;
    bountyStartBy: bigint;
    bountyWindowSeconds: bigint;
    feedbackWindowSeconds: bigint;
    bountyEligibility: number;
  };
};

type X402QuestionMetadata = ReturnType<typeof buildQuestionSpecHashes>["questionMetadata"];
type X402QuestionConfidentiality = NonNullable<AgentQuestionSpecInput["confidentiality"]>;

export type X402QuestionItemPayload = {
  confidentiality: X402QuestionConfidentiality;
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
  questionMetadata?: X402QuestionMetadata;
  questionMetadataHash: `0x${string}`;
  questionMetadataUri?: string;
  resultSpecHash: `0x${string}`;
};

export type X402QuestionCanonicalPayload = ReturnType<typeof toCanonicalQuestionPayload>;

export type X402QuestionOperation = {
  operationKey: `0x${string}`;
  payloadHash: string;
  canonicalPayload: X402QuestionCanonicalPayload;
};

export type X402QuestionPaymentAuthorizationFields = {
  from?: Address;
  to?: Address;
  validAfter?: bigint | number | string;
  validBefore?: bigint | number | string;
  value?: bigint | number | string;
};

export type X402QuestionPaymentNonceQuestion = {
  categoryId: bigint;
  confidentiality: X402QuestionConfidentiality;
  contextUrl: string;
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

export type X402QuestionPaymentNonceRewardTerms = {
  amount: bigint;
  asset: typeof X402_SUBMISSION_REWARD_ASSET_LREP | typeof X402_SUBMISSION_REWARD_ASSET_USDC;
  bountyEligibility: number;
  requiredVoters: bigint;
};

export type X402QuestionPaymentNonceFeedbackBonus = {
  amount: bigint;
  awarder: Address;
};

export type X402QuestionParserOptions = {
  allowedRateLoopAttachmentOrigins?: readonly string[];
  allowLocalhostAttachmentOrigins?: boolean;
  questionMetadataBaseUrl?: string | null;
};

function isLocalE2EProductionBuildEnabled() {
  return (
    process.env.RATELOOP_E2E_PRODUCTION_BUILD === "true" ||
    process.env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD === "true"
  );
}

export function buildDefaultX402QuestionParserOptions(): X402QuestionParserOptions {
  return {
    allowedRateLoopAttachmentOrigins: getDefaultRateLoopAttachmentOrigins(),
    allowLocalhostAttachmentOrigins:
      process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled(),
    questionMetadataBaseUrl:
      process.env.RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL ??
      process.env.NEXT_PUBLIC_PONDER_URL ??
      process.env.NEXT_PUBLIC_APP_URL,
  };
}

export function isAllowedX402UploadedImageUrl(
  value: string,
  options: X402QuestionParserOptions = buildDefaultX402QuestionParserOptions(),
): boolean {
  return normalizeUploadedImageAttachmentUrl(value, options) !== null;
}

export function isAllowedX402HostedDetailsUrl(
  value: string,
  options: X402QuestionParserOptions = buildDefaultX402QuestionParserOptions(),
): boolean {
  return isHostedQuestionDetailsUrl(value, options);
}

export function serializeX402QuestionRoundConfig(
  config: X402QuestionRoundConfig,
): SerializedX402QuestionRoundConfig {
  return {
    questionDurationSeconds: config.maxDuration.toString(),
    minVoters: config.minVoters.toString(),
    maxVoters: config.maxVoters.toString(),
  };
}

function roundConfigToQuestionMetadataInput(config: X402QuestionRoundConfig): AgentQuestionRoundConfig {
  return {
    questionDurationSeconds: config.maxDuration,
    minVoters: config.minVoters,
    maxVoters: config.maxVoters,
  };
}

export function assertSupportedX402BundleBounty(
  bounty: Pick<X402QuestionPayload["bounty"], "bountyStartBy" | "bountyWindowSeconds">,
) {
  if (bounty.bountyStartBy !== 0n) {
    throw new X402QuestionInputError(
      "bounty.bountyStartBy must be 0 for creation-anchored bundle submissions.",
    );
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

function readIntegerString(value: unknown, fieldName: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new X402QuestionInputError(`${fieldName} must be a safe non-negative integer.`);
    }
    return String(value);
  }
  if (typeof value === "bigint" || typeof value === "string") {
    return String(value).trim();
  }
  return "";
}

function parseNonNegativeInteger(value: unknown, fieldName: string): bigint {
  const rawValue = readIntegerString(value, fieldName);
  if (!/^\d+$/.test(rawValue)) {
    throw new X402QuestionInputError(`${fieldName} must be a non-negative integer.`);
  }

  return BigInt(rawValue);
}

function assertIntegerUpperBound(value: bigint, fieldName: string, maxValue: bigint) {
  if (value <= maxValue) return;
  throw new X402QuestionInputError(`${fieldName} must be at most ${maxValue}.`);
}

function normalizeNonceBigInt(value: unknown, fieldName: string): bigint {
  const raw = readIntegerString(value, fieldName);
  if (!/^\d+$/.test(raw)) {
    throw new X402QuestionInputError(`${fieldName} must be a non-negative integer.`);
  }
  return BigInt(raw);
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

function matchesHostname(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function extractYouTubeId(url: string): string | null {
  try {
    const parsed = new URL(url);
    let id: string | null | undefined;
    if (matchesHostname(parsed.hostname, "youtube.com") && parsed.searchParams.has("v")) {
      id = parsed.searchParams.get("v");
    } else if (parsed.hostname.toLowerCase() === "youtu.be") {
      id = parsed.pathname.slice(1).split("/")[0];
    } else if (matchesHostname(parsed.hostname, "youtube.com") && parsed.pathname.startsWith("/embed/")) {
      id = parsed.pathname.split("/embed/")[1]?.split("/")[0];
    }
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function canonicalizeUrl(url: string): string {
  const youtubeId = extractYouTubeId(url);
  if (youtubeId) {
    return `https://www.youtube.com/watch?v=${youtubeId}`;
  }
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) hostname = hostname.slice(4);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `https://${hostname}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

function normalizeQuestionContextUrl(value: string, fieldName: string): string {
  const normalized = normalizeHttpsUrl(value, fieldName);
  try {
    if (DIRECT_IMAGE_URL_PATH_PATTERN.test(new URL(normalized).pathname)) {
      throw new X402QuestionInputError(
        `${fieldName} must be a public HTTPS page URL. Upload images through imageUrls.`,
      );
    }
  } catch (error) {
    if (error instanceof X402QuestionInputError) throw error;
    throw new X402QuestionInputError(`${fieldName} must be a valid HTTPS URL.`);
  }
  return canonicalizeUrl(normalized);
}

function hasAllowedAttachmentProtocol(parsed: URL, options: X402QuestionParserOptions) {
  if (parsed.protocol === "https:") return true;
  return (
    parsed.protocol === "http:" &&
    shouldAllowLocalhostAttachmentOrigins(options) &&
    isLocalhostOrigin(parsed.origin)
  );
}

function normalizeQuestionDetailsUrl(
  value: string,
  fieldName: string,
  options: X402QuestionParserOptions,
): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:") {
      if (
        !shouldAllowLocalhostAttachmentOrigins(options) ||
        !isLocalhostOrigin(parsed.origin) ||
        parsed.search ||
        parsed.hash ||
        !QUESTION_DETAILS_PATH_PATTERN.test(parsed.pathname) ||
        !isRateLoopAttachmentOrigin(parsed, options)
      ) {
        throw new X402QuestionInputError(`${fieldName} must be an HTTPS URL.`);
      }
    } else if (parsed.protocol !== "https:") {
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

function normalizeQuestionDetails(
  value: Record<string, unknown>,
  fieldPrefix: string,
  options: X402QuestionParserOptions,
) {
  const detailsUrl = readOptionalString(value.detailsUrl);
  const detailsHash = readOptionalBytes32Hex(value.detailsHash, `${fieldPrefix}.detailsHash`);

  if (detailsUrl) {
    if (detailsHash === EMPTY_DETAILS_HASH) {
      throw new X402QuestionInputError(`${fieldPrefix}.detailsHash is required when detailsUrl is provided.`);
    }
    return {
      detailsHash,
      detailsUrl: normalizeQuestionDetailsUrl(detailsUrl, `${fieldPrefix}.detailsUrl`, options),
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

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function normalizeUrlHostname(hostname: string) {
  return hostname
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1")
    .replace(/\.+$/, "");
}

function isIpLikeHostname(hostname: string) {
  const normalized = normalizeUrlHostname(hostname);
  return /^\d+$/.test(normalized) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":");
}

function isInternalHostname(hostname: string) {
  const normalized = normalizeUrlHostname(hostname);
  return (
    !normalized.includes(".") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function isTrustedRateLoopAttachmentHostname(hostname: string) {
  const normalized = normalizeUrlHostname(hostname);
  return normalized === "rateloop.ai" || normalized.endsWith(".rateloop.ai");
}

function normalizeConfiguredRateLoopAttachmentOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password) return null;

    const localAllowed = process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled();
    const localhost = isLocalhostOrigin(parsed.origin);
    if (process.env.NODE_ENV === "production") {
      if (parsed.protocol === "http:" && !(localAllowed && localhost)) return null;
      if (!localAllowed || !localhost) {
        if (localhost || isIpLikeHostname(parsed.hostname) || isInternalHostname(parsed.hostname)) return null;
        if (!isTrustedRateLoopAttachmentHostname(parsed.hostname)) return null;
      }
    }

    return parsed.origin;
  } catch {
    return null;
  }
}

function getDefaultRateLoopAttachmentOrigins() {
  return [
    ...RATELOOP_PRODUCTION_ORIGINS,
    normalizeConfiguredRateLoopAttachmentOrigin(process.env.APP_URL),
    normalizeConfiguredRateLoopAttachmentOrigin(process.env.NEXT_PUBLIC_APP_URL),
    normalizeConfiguredRateLoopAttachmentOrigin(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null),
  ].filter((origin): origin is string => Boolean(origin));
}

function getAllowedRateLoopAttachmentOrigins(options: X402QuestionParserOptions) {
  return new Set(
    (options.allowedRateLoopAttachmentOrigins ?? getDefaultRateLoopAttachmentOrigins())
      .map(normalizeOrigin)
      .filter((origin): origin is string => Boolean(origin)),
  );
}

function shouldAllowLocalhostAttachmentOrigins(options: X402QuestionParserOptions) {
  return (
    options.allowLocalhostAttachmentOrigins ??
    (process.env.NODE_ENV !== "production" || isLocalE2EProductionBuildEnabled())
  );
}

function isRateLoopAttachmentOrigin(parsed: URL, options: X402QuestionParserOptions) {
  return (
    getAllowedRateLoopAttachmentOrigins(options).has(parsed.origin) ||
    (shouldAllowLocalhostAttachmentOrigins(options) && isLocalhostOrigin(parsed.origin))
  );
}

function isHostedQuestionDetailsUrl(value: string, options: X402QuestionParserOptions): boolean {
  try {
    const parsed = new URL(value);
    if (!hasAllowedAttachmentProtocol(parsed, options) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return false;
    }
    return QUESTION_DETAILS_PATH_PATTERN.test(parsed.pathname) && isRateLoopAttachmentOrigin(parsed, options);
  } catch {
    return false;
  }
}

function normalizeUploadedImageAttachmentUrl(value: string, options: X402QuestionParserOptions): string | null {
  try {
    const parsed = new URL(value);
    if (!hasAllowedAttachmentProtocol(parsed, options) || parsed.username || parsed.password || parsed.search) {
      return null;
    }
    if (!IMAGE_ATTACHMENT_PATH_PATTERN.test(parsed.pathname)) {
      return null;
    }
    const digestMatch = parsed.hash.match(IMAGE_ATTACHMENT_SHA256_FRAGMENT_PATTERN);
    if (!digestMatch || !isRateLoopAttachmentOrigin(parsed, options)) {
      return null;
    }

    parsed.hash = `sha256=0x${digestMatch[1].toLowerCase()}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeImageUrls(value: unknown, options: X402QuestionParserOptions): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new X402QuestionInputError(
      "imageUrls must be an array of RateLoop imageUrl values returned by rateloop_upload_image.",
    );
  }

  const imageUrls = value.map((entry, index) => {
    const uploadedImageUrl = normalizeUploadedImageAttachmentUrl(readString(entry, `imageUrls[${index}]`), options);
    if (!uploadedImageUrl) {
      throw new X402QuestionInputError(
        "imageUrls must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
      );
    }
    return uploadedImageUrl;
  });

  if (imageUrls.length > 4) {
    throw new X402QuestionInputError("imageUrls supports at most four images.");
  }

  return [...new Set(imageUrls)].sort();
}

function isYouTubeVideoUrl(url: string): boolean {
  return extractYouTubeId(url) !== null;
}

function normalizeTags(value: unknown): { tags: string; tagList: string[] } {
  const rawTags = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const tagList = rawTags
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
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

function normalizeQuestionConfidentiality(value: unknown, fieldName: string): X402QuestionConfidentiality {
  if (value === undefined || value === null) {
    return {
      bond: null,
      disclosurePolicy: null,
      visibility: "public",
    };
  }
  if (!isObject(value)) {
    throw new X402QuestionInputError(`${fieldName} must be an object when provided.`);
  }

  const visibility = readOptionalString(value.visibility) || "public";
  if (visibility !== "public" && visibility !== "gated") {
    throw new X402QuestionInputError(`${fieldName}.visibility must be public or gated.`);
  }
  if (visibility === "public") {
    if (value.bond !== undefined && value.bond !== null) {
      throw new X402QuestionInputError(`${fieldName}.bond is only supported for gated questions.`);
    }
    return {
      bond: null,
      disclosurePolicy: null,
      visibility,
    };
  }

  const rawDisclosurePolicy = readOptionalString(value.disclosurePolicy) || DEFAULT_CONFIDENTIALITY_DISCLOSURE_POLICY;
  const disclosurePolicy =
    rawDisclosurePolicy === "private_until_settlement" ? AFTER_SETTLEMENT_DISCLOSURE_POLICY : rawDisclosurePolicy;
  if (disclosurePolicy !== AFTER_SETTLEMENT_DISCLOSURE_POLICY && disclosurePolicy !== "private_forever") {
    throw new X402QuestionInputError(`${fieldName}.disclosurePolicy must be after_settlement or private_forever.`);
  }

  let bond: NonNullable<X402QuestionConfidentiality["bond"]> | null = null;
  if (value.bond !== undefined && value.bond !== null) {
    if (!isObject(value.bond)) {
      throw new X402QuestionInputError(`${fieldName}.bond must be an object when provided.`);
    }
    const amount = parseNonNegativeInteger(value.bond.amount ?? 0n, `${fieldName}.bond.amount`);
    assertIntegerUpperBound(amount, `${fieldName}.bond.amount`, X402_CONFIDENTIALITY_BOND_UINT64_MAX);
    if (amount > 0n && amount < X402_MIN_NONZERO_CONFIDENTIALITY_BOND) {
      throw new X402QuestionInputError(
        `${fieldName}.bond.amount must be 0 or at least ${X402_MIN_NONZERO_CONFIDENTIALITY_BOND} atomic units.`,
      );
    }
    const asset = readOptionalString(value.bond.asset).toUpperCase() || "LREP";
    if (asset !== "LREP" && asset !== "USDC") {
      throw new X402QuestionInputError(`${fieldName}.bond.asset must be LREP or USDC.`);
    }
    bond = {
      amount: amount.toString(),
      asset,
    };
  }

  return {
    bond: bond ?? {
      amount: "0",
      asset: "LREP",
    },
    disclosurePolicy,
    visibility,
  };
}

function questionConfidentialityFlags(confidentiality: X402QuestionConfidentiality) {
  return confidentiality.visibility === "gated" && confidentiality.disclosurePolicy === "private_forever"
    ? CONFIDENTIALITY_FLAG_PRIVATE_FOREVER
    : 0;
}

function buildQuestionConfidentialityHash(confidentiality: X402QuestionConfidentiality): Hex {
  const gated = confidentiality.visibility === "gated";
  const asset = gated && confidentiality.bond?.asset === "USDC" ? 1 : 0;
  const amount = gated ? BigInt(confidentiality.bond?.amount ?? "0") : 0n;
  assertIntegerUpperBound(amount, "question.confidentiality.bond.amount", X402_CONFIDENTIALITY_BOND_UINT64_MAX);
  const flags = questionConfidentialityFlags(confidentiality);
  return keccak256(
    encodeAbiParameters(
      [{ type: "bool" }, { type: "uint8" }, { type: "uint64" }, { type: "uint8" }],
      [gated, asset, amount, flags],
    ),
  );
}

function normalizeTemplateSelection(
  value: Record<string, unknown>,
  fieldPrefix: string,
  defaults: {
    confidentiality?: X402QuestionConfidentiality;
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

function isSupportedBountyEligibility(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) return false;
  return value === 0 || value === X402_BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN;
}

function parseOptionalNonNegativeBountyInteger(value: unknown, fieldName: string, fallback: bigint): bigint {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return parseNonNegativeInteger(value, fieldName);
}

function normalizeBounty(value: unknown): X402QuestionPayload["bounty"] {
  if (!isObject(value)) {
    throw new X402QuestionInputError("bounty is required.");
  }

  const asset = readOptionalString(value.asset).toUpperCase() || "USDC";
  if (asset !== "USDC" && asset !== "LREP") {
    throw new X402QuestionInputError("bounty.asset must be USDC or LREP.");
  }

  const amount = parsePositiveAtomicAmount(value.amount, "bounty.amount");
  const requiredVoters = parseNonNegativeInteger(
    value.requiredVoters ?? X402_MIN_REWARD_POOL_REQUIRED_VOTERS,
    "bounty.requiredVoters",
  );
  if (value.requiredSettledRounds !== undefined) {
    throw new X402QuestionInputError(
      "bounty.requiredSettledRounds is no longer accepted; reward eligibility uses one creation-anchored round.",
    );
  }
  if (value.bountyStartBy !== undefined) {
    throw new X402QuestionInputError(
      "bounty.bountyStartBy is no longer accepted; bounty timing starts when the question is created.",
    );
  }
  if (value.bountyWindowSeconds !== undefined) {
    throw new X402QuestionInputError(
      "bounty.bountyWindowSeconds is no longer accepted; use question.roundConfig.questionDurationSeconds.",
    );
  }
  if (value.feedbackWindowSeconds !== undefined) {
    throw new X402QuestionInputError(
      "bounty.feedbackWindowSeconds is no longer accepted; use question.roundConfig.questionDurationSeconds.",
    );
  }
  const requiredSettledRounds = X402_MIN_REWARD_POOL_SETTLED_ROUNDS;
  const bountyStartBy = 0n;
  const bountyWindowSeconds = 0n;
  const feedbackWindowSeconds = 0n;
  const bountyEligibility = Number(parseNonNegativeInteger(value.bountyEligibility ?? 0n, "bounty.bountyEligibility"));

  if (requiredVoters < X402_MIN_REWARD_POOL_REQUIRED_VOTERS) {
    throw new X402QuestionInputError(`bounty.requiredVoters must be at least ${X402_MIN_REWARD_POOL_REQUIRED_VOTERS}.`);
  }
  assertIntegerUpperBound(requiredVoters, "bounty.requiredVoters", X402_ROUND_CONFIG_UINT16_MAX);
  const requiredVoterFloor = BigInt(requiredQuestionRewardParticipants(amount));
  if (requiredVoters < requiredVoterFloor) {
    throw new X402QuestionInputError(
      `bounty.requiredVoters must be at least ${requiredVoterFloor} for this bounty amount.`,
    );
  }
  if (amount < X402_DEFAULT_SUBMISSION_BOUNTY) {
    throw new X402QuestionInputError("bounty.amount must be at least 1000000 atomic units.");
  }
  if (amount < requiredVoters * requiredSettledRounds) {
    throw new X402QuestionInputError("bounty.amount is too small for the selected voter requirements.");
  }
  if (!isSupportedBountyEligibility(bountyEligibility)) {
    throw new X402QuestionInputError(
      "bounty.bountyEligibility must be 0 for everyone or 8 for Proof of Human.",
    );
  }
  return {
    asset,
    amount,
    requiredVoters,
    requiredSettledRounds,
    bountyStartBy,
    bountyWindowSeconds,
    feedbackWindowSeconds,
    bountyEligibility,
  };
}

function normalizeBountyForQuestionDuration(
  bounty: X402QuestionPayload["bounty"],
  questionDuration: bigint,
): X402QuestionPayload["bounty"] {
  if (bounty.requiredSettledRounds !== 1n) {
    throw new X402QuestionInputError(
      "bounty.requiredSettledRounds must be 1; reward eligibility now uses the creation-anchored question round.",
    );
  }
  if (bounty.bountyStartBy !== 0n) {
    throw new X402QuestionInputError("bounty.bountyStartBy must be 0; bounty timing now starts at question creation.");
  }
  if (bounty.bountyWindowSeconds !== 0n && bounty.bountyWindowSeconds !== questionDuration) {
    throw new X402QuestionInputError(
      "bounty.bountyWindowSeconds must match question.roundConfig.questionDurationSeconds.",
    );
  }
  if (bounty.feedbackWindowSeconds !== 0n && bounty.feedbackWindowSeconds !== questionDuration) {
    throw new X402QuestionInputError(
      "bounty.feedbackWindowSeconds must match question.roundConfig.questionDurationSeconds.",
    );
  }
  return {
    ...bounty,
    bountyStartBy: 0n,
    bountyWindowSeconds: questionDuration,
    feedbackWindowSeconds: questionDuration,
  };
}

function defaultRoundConfig(requiredVoters: bigint): X402QuestionRoundConfig {
  const defaultMaxVoters = BigInt(DEFAULT_ROUND_CONFIG.maxVoters);
  const questionDuration = BigInt(DEFAULT_ROUND_CONFIG.epochDurationSeconds);
  return {
    epochDuration: questionDuration,
    maxDuration: questionDuration,
    minVoters: requiredVoters,
    maxVoters: defaultMaxVoters < requiredVoters ? requiredVoters : defaultMaxVoters,
  };
}

function normalizeRoundPreset(value: unknown): X402QuestionRoundPresetId | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new X402QuestionInputError("question.roundPreset must be a string.");
  }

  const normalized = value.trim().replace(/[-\s]+/g, "_").toLowerCase();
  if (!normalized || normalized === "default" || normalized === "standard") return null;
  if (normalized === X402_PURE_AGENT_FAST_ROUND_PRESET_ID || normalized === "agent_fast") {
    return X402_PURE_AGENT_FAST_ROUND_PRESET_ID;
  }

  throw new X402QuestionInputError("question.roundPreset must be pure_agent_fast or default.");
}

function roundConfigFromPreset(
  preset: X402QuestionRoundPresetId,
  requiredVoters: bigint,
): X402QuestionRoundConfig {
  switch (preset) {
    case X402_PURE_AGENT_FAST_ROUND_PRESET_ID: {
      const minVoters =
        requiredVoters > X402_PURE_AGENT_FAST_ROUND_CONFIG.minVoters
          ? requiredVoters
          : X402_PURE_AGENT_FAST_ROUND_CONFIG.minVoters;
      const maxVoters =
        minVoters > X402_PURE_AGENT_FAST_ROUND_CONFIG.maxVoters
          ? minVoters
          : X402_PURE_AGENT_FAST_ROUND_CONFIG.maxVoters;
      return {
        ...X402_PURE_AGENT_FAST_ROUND_CONFIG,
        minVoters,
        maxVoters,
      };
    }
  }
}

function normalizeRoundConfig(
  value: unknown,
  requiredVoters: bigint,
  presetValue?: unknown,
): X402QuestionRoundConfig {
  const preset = normalizeRoundPreset(presetValue);
  if (value === undefined || value === null) {
    return preset ? roundConfigFromPreset(preset, requiredVoters) : defaultRoundConfig(requiredVoters);
  }
  if (preset) {
    throw new X402QuestionInputError("question.roundPreset cannot be combined with question.roundConfig.");
  }
  if (!isObject(value)) {
    throw new X402QuestionInputError("question.roundConfig must be an object.");
  }

  const explicitQuestionDuration =
    value.questionDurationSeconds ?? value.questionDuration ?? value.durationSeconds ?? value.duration;
  const legacyEpochDuration = value.epochDuration ?? value.blindPhaseSeconds ?? value.blindSeconds;
  const legacyMaxDuration = value.maxDuration ?? value.maxDurationSeconds ?? value.deadlineSeconds;
  const hasExplicitQuestionDuration = explicitQuestionDuration !== undefined && explicitQuestionDuration !== null;
  const hasLegacyEpochDuration = legacyEpochDuration !== undefined && legacyEpochDuration !== null;
  const hasLegacyMaxDuration = legacyMaxDuration !== undefined && legacyMaxDuration !== null;
  if (hasLegacyEpochDuration || hasLegacyMaxDuration) {
    throw new X402QuestionInputError(
      "question.roundConfig.epochDuration and question.roundConfig.maxDuration are no longer accepted; use questionDurationSeconds.",
    );
  }
  const questionDuration = hasExplicitQuestionDuration
    ? parseNonNegativeInteger(explicitQuestionDuration, "question.roundConfig.questionDurationSeconds")
    : BigInt(DEFAULT_ROUND_CONFIG.epochDurationSeconds);
  const minVoters = parseNonNegativeInteger(value.minVoters ?? requiredVoters, "question.roundConfig.minVoters");
  const maxVoters = parseNonNegativeInteger(
    value.maxVoters ?? BigInt(DEFAULT_ROUND_CONFIG.maxVoters),
    "question.roundConfig.maxVoters",
  );

  if (questionDuration <= 0n) {
    throw new X402QuestionInputError("question.roundConfig.questionDurationSeconds must be greater than zero.");
  }
  if (minVoters <= 0n || maxVoters <= 0n || maxVoters < minVoters) {
    throw new X402QuestionInputError("question.roundConfig voter values are invalid.");
  }
  assertIntegerUpperBound(
    questionDuration,
    "question.roundConfig.questionDurationSeconds",
    X402_ROUND_CONFIG_UINT32_MAX,
  );
  assertIntegerUpperBound(minVoters, "question.roundConfig.minVoters", X402_ROUND_CONFIG_UINT16_MAX);
  assertIntegerUpperBound(maxVoters, "question.roundConfig.maxVoters", X402_ROUND_CONFIG_UINT16_MAX);
  if (minVoters !== requiredVoters) {
    throw new X402QuestionInputError("question.roundConfig.minVoters must match bounty.requiredVoters.");
  }

  return { epochDuration: questionDuration, maxDuration: questionDuration, minVoters, maxVoters };
}

type NormalizedQuestionInput = Omit<X402QuestionItemPayload, "questionMetadataHash" | "resultSpecHash"> & {
  template: NonNullable<ReturnType<typeof findAgentResultTemplate>>;
};

function normalizeQuestion(
  value: unknown,
  index: number,
  defaults: {
    confidentiality?: X402QuestionConfidentiality;
    templateId?: string;
    templateInputs?: AgentQuestionSpecInput["templateInputs"];
    templateVersion?: number;
  },
  options: X402QuestionParserOptions,
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

  const imageUrls = normalizeImageUrls(value.imageUrls, options);
  const rawContextUrl = readOptionalString(value.contextUrl);
  const contextUrl = rawContextUrl ? normalizeQuestionContextUrl(rawContextUrl, `${fieldPrefix}.contextUrl`) : "";
  const rawVideoUrl = readOptionalString(value.videoUrl);
  const videoUrl = rawVideoUrl ? normalizeHttpsUrl(rawVideoUrl, `${fieldPrefix}.videoUrl`) : "";
  const details = normalizeQuestionDetails(value, fieldPrefix, options);
  const confidentiality = normalizeQuestionConfidentiality(
    value.confidentiality ?? defaults.confidentiality,
    `${fieldPrefix}.confidentiality`,
  );
  if (videoUrl && !isYouTubeVideoUrl(videoUrl)) {
    throw new X402QuestionInputError(`${fieldPrefix}.videoUrl must be a supported YouTube URL.`);
  }
  if (videoUrl && imageUrls.length > 0) {
    throw new X402QuestionInputError("Use imageUrls or videoUrl, not both.");
  }
  if (confidentiality.visibility === "gated") {
    if (contextUrl || videoUrl) {
      throw new X402QuestionInputError(
        `${fieldPrefix}.confidentiality.visibility gated requires a RateLoop-hosted detailsUrl; external contextUrl and videoUrl are not allowed.`,
      );
    }
    if (!details.detailsUrl) {
      throw new X402QuestionInputError(`${fieldPrefix}.detailsUrl is required for gated questions.`);
    }
    if (!isHostedQuestionDetailsUrl(details.detailsUrl, options)) {
      throw new X402QuestionInputError(
        `${fieldPrefix}.detailsUrl must be a RateLoop-hosted details attachment for gated questions.`,
      );
    }
  }
  if (
    !contextUrl &&
    imageUrls.length === 0 &&
    !videoUrl &&
    !(confidentiality.visibility === "gated" && details.detailsUrl)
  ) {
    throw new X402QuestionInputError(`${fieldPrefix}.contextUrl, imageUrls, or videoUrl is required.`);
  }

  const { tags, tagList } = normalizeTags(value.tags);
  const categoryId = parseNonNegativeInteger(value.categoryId, `${fieldPrefix}.categoryId`);
  const targetAudience = normalizeQuestionTargetAudience(value.targetAudience, `${fieldPrefix}.targetAudience`);
  const templateSelection = normalizeTemplateSelection(value, fieldPrefix, defaults);

  return {
    categoryId,
    confidentiality,
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

function validateHeadToHeadTemplateSelection(question: NormalizedQuestionInput, fieldPrefix: string) {
  if (question.templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID) return;

  const voteUi = readHeadToHeadTemplateInputs(question.templateInputs);
  if (!voteUi) {
    throw new X402QuestionInputError(
      `${fieldPrefix}.templateInputs must include valid optionAKey, optionALabel, optionBKey, and optionBLabel for head_to_head_ab.`,
    );
  }

  const titleError = getHeadToHeadAbTitleValidationError(question.title, voteUi.optionALabel, voteUi.optionBLabel);
  if (titleError) {
    throw new X402QuestionInputError(titleError);
  }
}

function resolveQuestionMetadataBaseUrl(options: X402QuestionParserOptions) {
  return normalizeQuestionMetadataBaseUrl(options.questionMetadataBaseUrl);
}

export function parseX402QuestionRequest(
  value: unknown,
  fallbackChainId?: number,
  options: X402QuestionParserOptions = {},
): X402QuestionPayload {
  if (!isObject(value)) {
    throw new X402QuestionInputError("Request body must be a JSON object.");
  }

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
  const rawBounty = normalizeBounty(value.bounty);
  const roundConfig = normalizeRoundConfig(
    value.roundConfig ?? firstQuestion.roundConfig,
    rawBounty.requiredVoters,
    value.roundPreset ?? firstQuestion.roundPreset,
  );
  const bounty = normalizeBountyForQuestionDuration(rawBounty, roundConfig.maxDuration);
  const topLevelTemplateInputs = normalizeTemplateInputs(value.templateInputs, "templateInputs");
  const topLevelTemplateVersion =
    value.templateVersion === undefined || value.templateVersion === null
      ? DEFAULT_AGENT_TEMPLATE_VERSION
      : Number.parseInt(String(value.templateVersion), 10);
  const templateDefaults = {
    confidentiality: normalizeQuestionConfidentiality(value.confidentiality, "confidentiality"),
    templateId: readOptionalString(value.templateId) || DEFAULT_AGENT_TEMPLATE_ID,
    templateInputs: topLevelTemplateInputs,
    templateVersion: topLevelTemplateVersion,
  };
  const metadataBaseUrl = resolveQuestionMetadataBaseUrl(options);
  const questions = rawQuestions.map((question, index) => {
    const normalizedQuestion = normalizeQuestion(question, index, templateDefaults, options);
    validateHeadToHeadTemplateSelection(normalizedQuestion, `questions[${index}]`);
    const spec = buildQuestionSpecHashes(
      {
        bounty: {
          amount: bounty.amount,
          asset: bounty.asset,
          bountyEligibility: bounty.bountyEligibility,
          requiredVoters: bounty.requiredVoters,
        },
        categoryId: normalizedQuestion.categoryId,
        confidentiality: normalizedQuestion.confidentiality,
        contextUrl: normalizedQuestion.contextUrl,
        imageUrls: normalizedQuestion.imageUrls,
        roundConfig: roundConfigToQuestionMetadataInput(roundConfig),
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
      },
      { questionMetadataBaseUrl: metadataBaseUrl },
    );

    return {
      categoryId: normalizedQuestion.categoryId,
      confidentiality: normalizedQuestion.confidentiality,
      contextUrl: normalizedQuestion.contextUrl,
      detailsHash: normalizedQuestion.detailsHash,
      detailsUrl: normalizedQuestion.detailsUrl,
      imageUrls: normalizedQuestion.imageUrls,
      questionMetadata: spec.questionMetadata,
      questionMetadataHash: spec.questionMetadataHash,
      questionMetadataUri: spec.questionMetadataUri,
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
  if (questions.length > 1 && questions.some((question) => question.confidentiality.visibility === "gated")) {
    throw new X402QuestionInputError(
      "Private context bundles are not supported yet. Submit gated questions one at a time.",
    );
  }
  if (questions.length > 1 && questions.some((question) => question.templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID)) {
    throw new X402QuestionInputError(
      "head_to_head_ab supports exactly one question. Use ranked_option_member bundles for 3+ options or per-option scoring.",
    );
  }

  return {
    clientRequestId,
    chainId: normalizeChainId(value.chainId ?? firstQuestion.chainId, fallbackChainId),
    questions,
    roundConfig,
    bounty,
  };
}

export function toCanonicalQuestionPayload(
  payload: X402QuestionPayload,
  options: X402QuestionParserOptions = {},
) {
  const metadataBaseUrl = resolveQuestionMetadataBaseUrl(options);
  return {
    bounty: {
      amount: payload.bounty.amount.toString(),
      asset: payload.bounty.asset,
      requiredVoters: payload.bounty.requiredVoters.toString(),
      bountyEligibility: String(payload.bounty.bountyEligibility),
    },
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    questions: payload.questions.map((question) => ({
      categoryId: question.categoryId.toString(),
      confidentiality: question.confidentiality,
      contextUrl: question.contextUrl,
      detailsHash: question.detailsHash,
      detailsUrl: question.detailsUrl,
      imageUrls: question.imageUrls,
      questionMetadataHash: question.questionMetadataHash,
      questionMetadataUri: question.questionMetadataUri ?? buildQuestionMetadataUri(question.questionMetadataHash, metadataBaseUrl),
      resultSpecHash: question.resultSpecHash,
      tags: question.tagList,
      targetAudience: question.targetAudience,
      templateId: question.templateId,
      templateInputs: question.templateInputs,
      templateVersion: question.templateVersion,
      title: question.title,
      videoUrl: question.videoUrl,
    })),
    roundConfig: serializeX402QuestionRoundConfig(payload.roundConfig),
  };
}

function buildSubmissionMediaHash(imageUrls: readonly string[], videoUrl: string): Hex {
  return keccak256(
    encodeAbiParameters([{ type: "string[]" }, { type: "string" }], [[...new Set(imageUrls)].sort(), videoUrl]),
  );
}

function buildSubmissionDetailsHash(detailsUrl: string, detailsHash: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [detailsUrl, detailsHash]));
}

export function buildX402QuestionSubmissionKey(
  question: Pick<
    X402QuestionPaymentNonceQuestion,
    "categoryId" | "contextUrl" | "detailsHash" | "detailsUrl" | "imageUrls" | "tags" | "title" | "videoUrl"
  >,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        QUESTION_CONTEXT_DOMAIN,
        question.categoryId,
        buildSubmissionMediaHash(question.imageUrls, question.videoUrl),
        buildSubmissionDetailsHash(question.detailsUrl, question.detailsHash),
        question.contextUrl,
        question.title,
        question.tags,
      ],
    ),
  );
}

export function buildDeterministicX402QuestionSalt(params: {
  index: number;
  operationKey: Hex;
  payloadHash: string;
  submissionKey: Hex;
  walletAddress: Address;
}): Hex {
  return sha256(
    toBytes(
      [
        "rateloop",
        "agent-wallet-question-salt",
        params.operationKey,
        params.payloadHash,
        params.walletAddress.toLowerCase(),
        params.submissionKey,
        params.index.toString(),
      ].join(":"),
    ),
  );
}

function buildRewardTermsHash(rewardTerms: X402QuestionPaymentNonceRewardTerms): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint8" },
      ],
      [
        rewardTerms.asset,
        rewardTerms.amount,
        rewardTerms.requiredVoters,
        rewardTerms.bountyEligibility,
      ],
    ),
  );
}

function buildRoundConfigHash(roundConfig: X402QuestionRoundConfig): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint32" }, { type: "uint32" }, { type: "uint16" }, { type: "uint16" }],
      [
        Number(roundConfig.epochDuration),
        Number(roundConfig.maxDuration),
        Number(roundConfig.minVoters),
        Number(roundConfig.maxVoters),
      ],
    ),
  );
}

function buildFeedbackBonusTermsHash(feedbackBonus: X402QuestionPaymentNonceFeedbackBonus): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "address" }],
      [feedbackBonus.amount, feedbackBonus.awarder],
    ),
  );
}

function buildX402StringArrayHash(values: readonly string[]): Hex {
  const packed = values
    .map((value) => keccak256(toBytes(value)).slice(2))
    .join("");
  return keccak256(`0x${packed}` as Hex);
}

export function buildX402QuestionSubmissionPayloadHash(question: X402QuestionPaymentNonceQuestion): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(toBytes(question.contextUrl)),
        buildX402StringArrayHash(question.imageUrls),
        keccak256(toBytes(question.videoUrl)),
        keccak256(toBytes(question.detailsUrl)),
        question.detailsHash,
        keccak256(toBytes(question.title)),
        keccak256(toBytes(question.tags)),
        question.categoryId,
        question.salt,
      ],
    ),
  );
}

export function buildX402QuestionPaymentNonce(params: {
  chainId: number;
  contentRegistryAddress: Address;
  question: X402QuestionPaymentNonceQuestion;
  questionRewardPoolEscrowAddress: Address;
  rewardTerms: X402QuestionPaymentNonceRewardTerms;
  roundConfig: X402QuestionRoundConfig;
  x402Authorization: X402QuestionPaymentAuthorizationFields;
  x402QuestionSubmitterAddress: Address;
}): Hex {
  if (!params.x402Authorization.from || !params.x402Authorization.to) {
    throw new X402QuestionInputError("x402 authorization payer and payee are required.");
  }
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        X402_QUESTION_PAYMENT_DOMAIN,
        BigInt(params.chainId),
        params.contentRegistryAddress,
        params.questionRewardPoolEscrowAddress,
        params.x402QuestionSubmitterAddress,
        params.x402Authorization.from,
        params.x402Authorization.to,
        normalizeNonceBigInt(params.x402Authorization.value, "paymentAuthorization.value"),
        normalizeNonceBigInt(params.x402Authorization.validAfter, "paymentAuthorization.validAfter"),
        normalizeNonceBigInt(params.x402Authorization.validBefore, "paymentAuthorization.validBefore"),
        buildX402QuestionSubmissionPayloadHash(params.question),
        buildRewardTermsHash(params.rewardTerms),
        buildRoundConfigHash(params.roundConfig),
        buildQuestionConfidentialityHash(params.question.confidentiality),
        params.question.spec.questionMetadataHash,
        params.question.spec.resultSpecHash,
      ],
    ),
  );
}

export function buildX402QuestionOneShotPaymentNonce(params: {
  chainId: number;
  contentRegistryAddress: Address;
  feedbackBonus: X402QuestionPaymentNonceFeedbackBonus;
  feedbackBonusEscrowAddress: Address;
  question: X402QuestionPaymentNonceQuestion;
  questionRewardPoolEscrowAddress: Address;
  rewardTerms: X402QuestionPaymentNonceRewardTerms;
  roundConfig: X402QuestionRoundConfig;
  x402Authorization: X402QuestionPaymentAuthorizationFields;
  x402QuestionSubmitterAddress: Address;
}): Hex {
  if (!params.x402Authorization.from || !params.x402Authorization.to) {
    throw new X402QuestionInputError("x402 authorization payer and payee are required.");
  }
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        X402_QUESTION_ONE_SHOT_PAYMENT_DOMAIN,
        BigInt(params.chainId),
        params.contentRegistryAddress,
        params.questionRewardPoolEscrowAddress,
        params.feedbackBonusEscrowAddress,
        params.x402QuestionSubmitterAddress,
        params.x402Authorization.from,
        params.x402Authorization.to,
        normalizeNonceBigInt(params.x402Authorization.value, "paymentAuthorization.value"),
        normalizeNonceBigInt(params.x402Authorization.validAfter, "paymentAuthorization.validAfter"),
        normalizeNonceBigInt(params.x402Authorization.validBefore, "paymentAuthorization.validBefore"),
        buildX402QuestionSubmissionPayloadHash(params.question),
        buildRewardTermsHash(params.rewardTerms),
        buildRoundConfigHash(params.roundConfig),
        buildQuestionConfidentialityHash(params.question.confidentiality),
        buildFeedbackBonusTermsHash(params.feedbackBonus),
        params.question.spec.questionMetadataHash,
        params.question.spec.resultSpecHash,
      ],
    ),
  );
}

export function buildX402QuestionOperation(
  payload: X402QuestionPayload,
  options: X402QuestionParserOptions = {},
): X402QuestionOperation {
  assertSupportedX402BundleBounty(payload.bounty);
  const canonicalPayload = toCanonicalQuestionPayload(payload, options);
  const payloadHash = sha256(toBytes(JSON.stringify(canonicalPayload))).slice(2);
  const operationKey = sha256(toBytes(`rateloop:x402-question:${payloadHash}`));

  return {
    canonicalPayload,
    operationKey,
    payloadHash,
  };
}
