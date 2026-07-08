import { findAgentResultTemplate } from "../templates";
import { DEFAULT_AGENT_TEMPLATE_ID } from "../questionSpecs";
import {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  inferHeadToHeadAbQuestion,
  normalizeHeadToHeadOptionKey,
  readHeadToHeadTemplateInputs,
} from "../voteUi";
import { getHeadToHeadAbTitleValidationError } from "../headToHeadTitle.js";
import type { AgentAskExample, AgentQuestionExample, JsonObject, JsonValue, QuestionLintFinding } from "./types";

const CLIENT_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{4,160}$/;
// Contracts enforce rewardTerms.requiredVoters == roundConfig.minVoters
// ("Voters mismatch"), and the server defaults requiredVoters to 3.
const DEFAULT_REQUIRED_VOTERS = 3n;
const ROUND_CONFIG_UINT32_MAX = 4_294_967_295n;
const ROUND_CONFIG_UINT16_MAX = 65_535n;
const RANK_BY_RATING_TEMPLATE_IDS = new Set(["ranked_option_member", "pairwise_output_preference"]);
const HEAD_TO_HEAD_AB_REQUIRED_INPUTS = ["optionAKey", "optionALabel", "optionBKey", "optionBLabel"] as const;
const FEATURE_ACCEPTANCE_TEMPLATE_ID = "feature_acceptance_test";
const FEATURE_ACCEPTANCE_REQUIRED_INPUTS = ["expectedBehavior", "testSteps", "acceptanceCriteria"] as const;
const AGENT_TRACE_REVIEW_TEMPLATE_ID = "agent_trace_review";
const AGENT_TRACE_REVIEW_REQUIRED_INPUTS = ["traceId", "taskGoal", "reviewFocus"] as const;
const SUPPORTED_REWARD_ASSETS = new Set(["LREP", "USDC"]);
const MAX_PUBLIC_TAGS = 3;
const MAX_QUESTION_IMAGE_URLS = 4;
import {
  MIN_NONZERO_CONFIDENTIALITY_BOND,
  requiredQuestionRewardParticipants,
} from "@rateloop/contracts/protocol";
import { normalizeTargetAudience } from "@rateloop/node-utils/profileSelfReport";
import {
  findBlockedContentTags,
  getContentTitleValidationError,
} from "@rateloop/node-utils/submissionValidation";
import { X402_QUESTION_TOP_LEVEL_FIELDS } from "@rateloop/node-utils/x402QuestionFields";
import {
  X402_CONFIDENTIALITY_BOND_UINT64_MAX,
  X402_MAX_QUESTION_BUNDLE_COUNT,
  X402_PURE_AGENT_FAST_ROUND_PRESET_ID,
  isAllowedX402HostedDetailsUrl,
  isAllowedX402UploadedImageUrl,
} from "../x402QuestionPayload.js";
const DIRECT_IMAGE_URL_PATH_PATTERN = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const SURVEY_STYLE_PATTERN =
  /\b(multiple[-\s]?choice|answer options?|choose one|choose from|select one|select from|price range|pricing range)\b/i;
const HIDDEN_CHOICE_TITLE_PATTERN = /\bwhich\s+(option|variant|candidate|direction|price|pricing|range)\b/i;
const VS_TITLE_PATTERN = /\b(vs\.?|versus)\b/i;

export type AgentAskLintOptions = {
  requireChainId?: boolean;
  requireMaxPaymentAmount?: boolean;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asQuestionArray(request: AgentAskExample): AgentQuestionExample[] {
  if (request.question) return [request.question];
  if (Array.isArray(request.questions)) return request.questions;
  return [];
}

function looksLikeHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function looksLikeDirectImageUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return DIRECT_IMAGE_URL_PATH_PATTERN.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function looksLikeYouTubeVideoUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") return /^[\w-]+$/.test(parsed.pathname.slice(1).split("/")[0] ?? "");
    if (host === "www.youtube.com" && parsed.pathname.startsWith("/embed/")) {
      return /^[\w-]+$/.test(parsed.pathname.split("/embed/")[1]?.split("/")[0] ?? "");
    }
    return (
      (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") &&
      parsed.pathname === "/watch" &&
      /^[\w-]+$/.test(parsed.searchParams.get("v") ?? "")
    );
  } catch {
    return false;
  }
}

function tagCount(tags: unknown): number {
  if (Array.isArray(tags)) return tags.filter(tag => typeof tag === "string" && tag.trim()).length;
  if (typeof tags !== "string") return 0;
  return tags
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean).length;
}

function looksLikeUploadedImageUrl(value: unknown): boolean {
  return typeof value === "string" && isAllowedX402UploadedImageUrl(value);
}

function hasInvalidUploadedImageUrlList(value: unknown): boolean {
  return !Array.isArray(value) || value.some(url => !looksLikeUploadedImageUrl(url));
}

function looksLikeHostedDetailsUrl(value: unknown): boolean {
  return typeof value === "string" && isAllowedX402HostedDetailsUrl(value);
}

function readLintIntegerString(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string" || typeof value === "bigint") {
    return String(value).trim();
  }
  return null;
}

function readConfidentiality(value: unknown) {
  if (!isObject(value)) {
    return {
      bondAsset: null,
      bondAmount: 0n,
      disclosurePolicy: null,
      hasBond: false,
      isObject: value === undefined || value === null,
      visibility: "public",
    } as const;
  }
  const visibility = typeof value.visibility === "string" ? value.visibility.trim() : "public";
  const disclosurePolicy = typeof value.disclosurePolicy === "string" ? value.disclosurePolicy.trim() : null;
  const rawBond = isObject(value.bond) ? value.bond : null;
  const rawBondAmount = rawBond?.amount;
  const rawBondAmountString = readLintIntegerString(rawBondAmount);
  const bondAsset = typeof rawBond?.asset === "string" ? rawBond.asset.trim().toUpperCase() : null;
  const bondAmount =
    rawBondAmount !== undefined && rawBondAmount !== null
      ? rawBondAmountString !== null && /^\d+$/.test(rawBondAmountString)
        ? BigInt(rawBondAmountString)
        : -1n
      : 0n;
  return {
    bondAsset: bondAsset || null,
    bondAmount,
    disclosurePolicy,
    hasBond: value.bond !== undefined && value.bond !== null,
    isObject: true,
    visibility,
  } as const;
}

function pushFinding(
  findings: QuestionLintFinding[],
  level: QuestionLintFinding["level"],
  path: string,
  message: string,
) {
  findings.push({ level, path, message });
}

function templateInputText(templateInputs: JsonObject | null, key: string): string {
  const value = templateInputs?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function parseLintVoterCount(value: unknown): bigint | null {
  const raw = readLintIntegerString(value);
  if (raw === null) return null;
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

function parseLintPositiveInteger(value: unknown): bigint | null {
  const raw = readLintIntegerString(value);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return null;
  const parsed = BigInt(raw);
  return parsed > 0n ? parsed : null;
}

function parseLintNonNegativeInteger(value: unknown): bigint | null {
  const raw = readLintIntegerString(value);
  if (raw === null) return null;
  return /^\d+$/.test(raw) ? BigInt(raw) : null;
}

function lintRequiredSafeChainId(value: unknown, path: string, findings: QuestionLintFinding[]) {
  const parsed = parseLintPositiveInteger(value);
  if (parsed === null) {
    pushFinding(findings, "error", path, `${path} must be a positive base-10 safe integer.`);
    return;
  }
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    pushFinding(findings, "error", path, `${path} must be a positive base-10 safe integer.`);
  }
}

function lintOptionalSafeNonNegativeInteger(value: unknown, path: string, findings: QuestionLintFinding[]) {
  if (value === undefined || value === null) return;
  const parsed = parseLintNonNegativeInteger(value);
  if (parsed === null || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    pushFinding(findings, "error", path, `${path} must be a safe non-negative atomic integer.`);
  }
}

function lintRequiredSafeNonNegativeInteger(value: unknown, path: string, findings: QuestionLintFinding[]) {
  if (value === undefined || value === null || String(value).trim() === "") {
    pushFinding(findings, "error", path, `${path} is required.`);
    return;
  }
  const parsed = parseLintNonNegativeInteger(value);
  if (parsed === null || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    pushFinding(findings, "error", path, `${path} must be a safe non-negative integer.`);
  }
}

function lintOptionalRewardAsset(value: unknown, path: string, findings: QuestionLintFinding[]) {
  if (value === undefined || value === null) return;
  if (typeof value !== "string") {
    pushFinding(findings, "error", path, `${path} must be USDC or LREP.`);
    return;
  }
  const normalized = value.trim().toUpperCase();
  if (normalized && !SUPPORTED_REWARD_ASSETS.has(normalized)) {
    pushFinding(findings, "error", path, `${path} must be USDC or LREP.`);
  }
}

function lintRoundConfigVoterAlignment(request: Partial<AgentAskExample>, findings: QuestionLintFinding[]) {
  const firstQuestion = request.question ?? (Array.isArray(request.questions) ? request.questions[0] : undefined);
  const usesTopLevelRoundConfig = isObject(request.roundConfig);
  const roundConfig = usesTopLevelRoundConfig
    ? (request.roundConfig as JsonObject)
    : isObject(firstQuestion) && isObject((firstQuestion as JsonObject).roundConfig)
      ? ((firstQuestion as JsonObject).roundConfig as JsonObject)
      : null;
  if (!roundConfig || roundConfig.minVoters === undefined || roundConfig.minVoters === null) return;

  const minVoters = parseLintVoterCount(roundConfig.minVoters);
  if (minVoters === null) return;
  const requiredVoters = isObject(request.bounty)
    ? (parseLintVoterCount(request.bounty.requiredVoters) ?? DEFAULT_REQUIRED_VOTERS)
    : DEFAULT_REQUIRED_VOTERS;

  if (minVoters !== requiredVoters) {
    pushFinding(
      findings,
      "error",
      usesTopLevelRoundConfig ? "roundConfig.minVoters" : "question.roundConfig.minVoters",
      `roundConfig.minVoters (${minVoters}) must match bounty.requiredVoters (${requiredVoters}); contracts reject mismatched voter thresholds. Omit roundConfig to inherit bounty.requiredVoters.`,
    );
  }
}

function getRequestRoundConfig(request: Partial<AgentAskExample>): {
  pathPrefix: "roundConfig" | "question.roundConfig";
  roundConfig: JsonObject;
} | null {
  const firstQuestion = request.question ?? (Array.isArray(request.questions) ? request.questions[0] : undefined);
  const usesTopLevelRoundConfig = isObject(request.roundConfig);
  const roundConfig = usesTopLevelRoundConfig
    ? (request.roundConfig as JsonObject)
    : isObject(firstQuestion) && isObject((firstQuestion as JsonObject).roundConfig)
      ? ((firstQuestion as JsonObject).roundConfig as JsonObject)
      : null;
  if (!roundConfig) return null;
  return { pathPrefix: usesTopLevelRoundConfig ? "roundConfig" : "question.roundConfig", roundConfig };
}

function lintSingleDurationTiming(request: Partial<AgentAskExample>, findings: QuestionLintFinding[]) {
  if (!isObject(request.bounty)) return;
  const bounty = request.bounty as JsonObject;
  if (bounty.requiredSettledRounds !== undefined) {
    pushFinding(
      findings,
      "error",
      "bounty.requiredSettledRounds",
      "Remove bounty.requiredSettledRounds; reward eligibility uses one creation-anchored round.",
    );
  }
  if (bounty.bountyStartBy !== undefined) {
    pushFinding(
      findings,
      "error",
      "bounty.bountyStartBy",
      "Remove bounty.bountyStartBy; bounty timing starts when the question is created.",
    );
  }
  if (bounty.bountyWindowSeconds !== undefined) {
    pushFinding(
      findings,
      "error",
      "bounty.bountyWindowSeconds",
      "Remove bounty.bountyWindowSeconds; use roundConfig.questionDurationSeconds.",
    );
  }
  if (bounty.feedbackWindowSeconds !== undefined) {
    pushFinding(
      findings,
      "error",
      "bounty.feedbackWindowSeconds",
      "Remove bounty.feedbackWindowSeconds; use roundConfig.questionDurationSeconds.",
    );
  }
}

function lintBountyEligibility(request: Partial<AgentAskExample>, findings: QuestionLintFinding[]) {
  if (!isObject(request.bounty)) return;
  const raw = (request.bounty as JsonObject).bountyEligibility;
  if (raw === undefined || raw === null) return;

  const parsed = parseLintNonNegativeInteger(raw);
  if (parsed === 0n || parsed === 8n) return;
  pushFinding(
    findings,
    "error",
    "bounty.bountyEligibility",
    "bounty.bountyEligibility must be 0 for everyone or 8 for Proof of Human.",
  );
}

function lintRoundConfigSingleDuration(request: Partial<AgentAskExample>, findings: QuestionLintFinding[]) {
  const roundConfigInfo = getRequestRoundConfig(request);
  if (!roundConfigInfo) return;

  const { pathPrefix, roundConfig } = roundConfigInfo;
  for (const field of [
    "questionDuration",
    "durationSeconds",
    "duration",
    "epochDuration",
    "blindPhaseSeconds",
    "blindSeconds",
    "maxDuration",
    "maxDurationSeconds",
    "deadlineSeconds",
  ]) {
    if (roundConfig[field] === undefined) continue;
    pushFinding(
      findings,
      "error",
      `${pathPrefix}.${field}`,
      `Remove ${pathPrefix}.${field}; use ${pathPrefix}.questionDurationSeconds.`,
    );
  }
}

function lintBoundedInteger(
  value: unknown,
  path: string,
  maxValue: bigint,
  findings: QuestionLintFinding[],
) {
  if (value === undefined || value === null) return;
  const raw = readLintIntegerString(value);
  if (raw === null || !/^\d+$/.test(raw)) {
    pushFinding(findings, "error", path, `${path} must be a non-negative integer.`);
    return;
  }
  const parsed = BigInt(raw);
  if (parsed <= maxValue) return;
  pushFinding(findings, "error", path, `${path} must be at most ${maxValue}.`);
}

function lintBoundedPositiveInteger(
  value: unknown,
  path: string,
  maxValue: bigint,
  findings: QuestionLintFinding[],
): bigint | null {
  if (value === undefined || value === null) return null;
  const raw = readLintIntegerString(value);
  if (raw === null || !/^\d+$/.test(raw)) {
    pushFinding(findings, "error", path, `${path} must be a positive integer.`);
    return null;
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) {
    pushFinding(findings, "error", path, `${path} must be a positive integer.`);
    return null;
  }
  if (parsed > maxValue) {
    pushFinding(findings, "error", path, `${path} must be at most ${maxValue}.`);
    return null;
  }
  return parsed;
}

function lintRoundPreset(
  value: unknown,
  path: string,
  findings: QuestionLintFinding[],
) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string") {
    pushFinding(findings, "error", path, `${path} must be a string.`);
    return;
  }
  const normalized = value.trim().replace(/[-\s]+/g, "_").toLowerCase();
  if (
    !normalized ||
    normalized === "default" ||
    normalized === "standard" ||
    normalized === X402_PURE_AGENT_FAST_ROUND_PRESET_ID ||
    normalized === "agent_fast"
  ) {
    return;
  }
  pushFinding(findings, "error", path, `${path} must be pure_agent_fast or default.`);
}

function lintRequestRoundPreset(
  request: Partial<AgentAskExample>,
  findings: QuestionLintFinding[],
) {
  const firstQuestion = request.question ?? (Array.isArray(request.questions) ? request.questions[0] : undefined);
  const presetPath = request.roundPreset !== undefined ? "roundPreset" : "question.roundPreset";
  const presetValue = request.roundPreset ?? (isObject(firstQuestion) ? firstQuestion.roundPreset : undefined);
  lintRoundPreset(presetValue, presetPath, findings);
  if (presetValue !== undefined && presetValue !== null && presetValue !== "" && getRequestRoundConfig(request)) {
    pushFinding(
      findings,
      "error",
      presetPath,
      `${presetPath} cannot be combined with roundConfig.`,
    );
  }
}

function lintTargetAudience(
  value: unknown,
  path: string,
  findings: QuestionLintFinding[],
) {
  if (value === undefined || value === null) return;
  try {
    normalizeTargetAudience(value, { fieldPrefix: path });
  } catch (error) {
    pushFinding(
      findings,
      "error",
      path,
      error instanceof Error ? error.message : `${path} is invalid.`,
    );
  }
}

function lintRoundConfigAbiBounds(
  request: Partial<AgentAskExample>,
  findings: QuestionLintFinding[],
) {
  const roundConfigInfo = getRequestRoundConfig(request);
  if (!roundConfigInfo) return;

  const { pathPrefix, roundConfig } = roundConfigInfo;
  lintBoundedPositiveInteger(
    roundConfig.questionDurationSeconds,
    `${pathPrefix}.questionDurationSeconds`,
    ROUND_CONFIG_UINT32_MAX,
    findings,
  );
  const minVoters = lintBoundedPositiveInteger(
    roundConfig.minVoters,
    `${pathPrefix}.minVoters`,
    ROUND_CONFIG_UINT16_MAX,
    findings,
  );
  const maxVoters = lintBoundedPositiveInteger(
    roundConfig.maxVoters,
    `${pathPrefix}.maxVoters`,
    ROUND_CONFIG_UINT16_MAX,
    findings,
  );
  if (minVoters !== null && maxVoters !== null && maxVoters < minVoters) {
    pushFinding(
      findings,
      "error",
      `${pathPrefix}.maxVoters`,
      `${pathPrefix}.maxVoters must be greater than or equal to ${pathPrefix}.minVoters.`,
    );
  }
}

export function lintAgentQuestion(
  question: Partial<AgentQuestionExample>,
  path = "question",
  inheritedTemplateId?: string,
  inheritedTemplateInputs?: JsonValue,
  inheritedConfidentiality?: unknown,
  inheritedTemplateVersion?: unknown,
): QuestionLintFinding[] {
  const findings: QuestionLintFinding[] = [];
  const questionRecord = question as Partial<AgentQuestionExample> & { templateVersion?: unknown };
  const title = typeof question.title === "string" ? question.title.trim() : "";
  const description = typeof question.description === "string" ? question.description.trim() : "";
  const templateId = question.templateId ?? inheritedTemplateId;
  const templateVersionInput = questionRecord.templateVersion ?? inheritedTemplateVersion;
  if (question.templateInputs !== undefined && question.templateInputs !== null && !isObject(question.templateInputs)) {
    pushFinding(findings, "error", `${path}.templateInputs`, `${path}.templateInputs must be an object when provided.`);
  }
  const templateInputs = isObject(question.templateInputs)
    ? question.templateInputs
    : isObject(inheritedTemplateInputs)
      ? inheritedTemplateInputs
      : null;
  const confidentiality = readConfidentiality(question.confidentiality ?? inheritedConfidentiality);

  if (!title) pushFinding(findings, "error", `${path}.title`, "Question title is required.");
  if (title.length > 120) pushFinding(findings, "error", `${path}.title`, "Question title must fit the 120 character on-chain limit.");
  const titleError = getContentTitleValidationError(title);
  if (titleError) {
    pushFinding(findings, "error", `${path}.title`, titleError);
  }
  if (/[?].*[?]/.test(title)) {
    pushFinding(findings, "warning", `${path}.title`, "Ask one bounded question instead of bundling several questions into the title.");
  }
  if (/\b(and|or)\b/i.test(title) && title.length > 70) {
    pushFinding(findings, "warning", `${path}.title`, "Long titles with conjunctions often hide multiple decisions.");
  }
  if (SURVEY_STYLE_PATTERN.test(`${title}\n${description}`)) {
    pushFinding(
      findings,
      "warning",
      `${path}.description`,
      "RateLoop asks should not be multiple-choice surveys. Ask one bounded rating question, or use one ranked bundle member per option.",
    );
  }
  if (templateId && !RANK_BY_RATING_TEMPLATE_IDS.has(templateId) && HIDDEN_CHOICE_TITLE_PATTERN.test(title)) {
    pushFinding(
      findings,
      "warning",
      `${path}.title`,
      templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID
        ? "Head-to-head titles should name options A and B instead of asking which option/variant."
        : "Choice questions should use head_to_head_ab for two-way pick-one comparisons, or one ranked bundle member per option for 3+ options.",
    );
  }
  if (
    templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID &&
    !RANK_BY_RATING_TEMPLATE_IDS.has(templateId ?? "") &&
    VS_TITLE_PATTERN.test(title)
  ) {
    pushFinding(
      findings,
      "warning",
      `${path}.title`,
      "Two-way pick-one comparisons should use templateId head_to_head_ab with option A/B labels. Use ranked bundles when scoring each option separately.",
    );
  }
  if (
    templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID &&
    !RANK_BY_RATING_TEMPLATE_IDS.has(templateId ?? "") &&
    inferHeadToHeadAbQuestion(question, inheritedTemplateId)
  ) {
    pushFinding(
      findings,
      "error",
      `${path}.templateId`,
      "Explicit Option A/B pick-one questions must use templateId head_to_head_ab with optionAKey/optionALabel and optionBKey/optionBLabel.",
    );
  }

  if (description.length > 280) {
    pushFinding(findings, "warning", `${path}.description`, "Keep voter summaries concise enough to scan quickly.");
  }
  const detailsUrl = typeof question.detailsUrl === "string" ? question.detailsUrl.trim() : "";
  const detailsHash = typeof question.detailsHash === "string" ? question.detailsHash.trim() : "";
  if (detailsUrl && !detailsHash) {
    pushFinding(findings, "error", `${path}.detailsHash`, "Details hash is required when detailsUrl is provided.");
  } else if (!detailsUrl && detailsHash) {
    pushFinding(findings, "error", `${path}.detailsUrl`, "Details URL is required when detailsHash is provided.");
  }
  if (detailsUrl && !looksLikeHttpsUrl(detailsUrl) && !looksLikeHostedDetailsUrl(detailsUrl)) {
    pushFinding(findings, "error", `${path}.detailsUrl`, "Details URL must be a public HTTPS URL.");
  }
  if (detailsHash && !/^0x[a-fA-F0-9]{64}$/.test(detailsHash)) {
    pushFinding(findings, "error", `${path}.detailsHash`, "Details hash must be a 32-byte hex string.");
  }
  const hasContextUrl = typeof question.contextUrl === "string" && question.contextUrl.trim().length > 0;
  const hasImageUrls = Array.isArray(question.imageUrls) && question.imageUrls.length > 0;
  const hasVideoUrl = typeof question.videoUrl === "string" && question.videoUrl.trim().length > 0;
  const isGated = confidentiality.visibility === "gated";
  if (!confidentiality.isObject) {
    pushFinding(findings, "error", `${path}.confidentiality`, "Confidentiality must be an object when provided.");
  } else if (confidentiality.visibility !== "public" && confidentiality.visibility !== "gated") {
    pushFinding(findings, "error", `${path}.confidentiality.visibility`, "Confidentiality visibility must be public or gated.");
  } else if (isGated) {
    if (
      confidentiality.disclosurePolicy !== null &&
      confidentiality.disclosurePolicy !== "after_settlement" &&
      confidentiality.disclosurePolicy !== "private_until_settlement" &&
      confidentiality.disclosurePolicy !== "private_forever"
    ) {
      pushFinding(
        findings,
        "error",
        `${path}.confidentiality.disclosurePolicy`,
        "Gated disclosure policy must be after_settlement or private_forever.",
      );
    }
    if (confidentiality.bondAmount < 0n) {
      pushFinding(findings, "error", `${path}.confidentiality.bond.amount`, "Bond amount must be a non-negative atomic integer.");
    } else if (confidentiality.bondAsset !== null && !SUPPORTED_REWARD_ASSETS.has(confidentiality.bondAsset)) {
      pushFinding(findings, "error", `${path}.confidentiality.bond.asset`, "Bond asset must be USDC or LREP.");
    } else if (confidentiality.bondAmount > X402_CONFIDENTIALITY_BOND_UINT64_MAX) {
      pushFinding(
        findings,
        "error",
        `${path}.confidentiality.bond.amount`,
        `Bond amount must be at most ${X402_CONFIDENTIALITY_BOND_UINT64_MAX} atomic units.`,
      );
    } else if (confidentiality.bondAmount > 0n && confidentiality.bondAmount < MIN_NONZERO_CONFIDENTIALITY_BOND) {
      pushFinding(
        findings,
        "error",
        `${path}.confidentiality.bond.amount`,
        `Nonzero confidentiality bonds must be at least ${MIN_NONZERO_CONFIDENTIALITY_BOND} atomic units.`,
      );
    } else if (confidentiality.bondAmount > 0n) {
      pushFinding(
        findings,
        "warning",
        `${path}.confidentiality.bond.amount`,
        "Nonzero confidentiality bonds can recruit a thinner rater pool; use the smallest deterrent that fits the risk.",
      );
    }
    if (hasContextUrl || hasVideoUrl) {
      pushFinding(
        findings,
        "error",
        `${path}.confidentiality.visibility`,
        "Private context requires a RateLoop-hosted detailsUrl (optional hosted imageUrls); external contextUrl and videoUrl are public.",
      );
    }
    if (detailsUrl && !looksLikeHostedDetailsUrl(detailsUrl)) {
      pushFinding(findings, "error", `${path}.detailsUrl`, "Private context details must use a RateLoop-hosted details attachment URL.");
    }
    if (!detailsUrl) {
      pushFinding(findings, "error", `${path}.detailsUrl`, "Private context requires a RateLoop-hosted detailsUrl.");
    }
    pushFinding(
      findings,
      "warning",
      `${path}.title`,
      "Keep private-context titles non-sensitive and unbranded; titles remain public.",
    );
  } else if (confidentiality.hasBond) {
    pushFinding(findings, "error", `${path}.confidentiality.bond`, "Bonds are only supported for gated private context.");
  }
  if (!hasContextUrl && !hasImageUrls && !hasVideoUrl && !(isGated && detailsUrl)) {
    pushFinding(
      findings,
      "error",
      `${path}.contextUrl`,
      "Context URL, RateLoop-hosted details URL, image URL, or video URL is required.",
    );
  } else if (hasContextUrl && !looksLikeHttpsUrl(question.contextUrl)) {
    pushFinding(findings, "error", `${path}.contextUrl`, "Context URL must be a public HTTPS URL.");
  } else if (hasContextUrl && looksLikeDirectImageUrl(question.contextUrl)) {
    pushFinding(findings, "error", `${path}.contextUrl`, "Context URL must be a page URL. Upload images through imageUrls.");
  }
  if (hasImageUrls && hasVideoUrl) {
    pushFinding(findings, "error", `${path}.imageUrls`, "Use imageUrls or videoUrl, not both.");
  }
  lintRequiredSafeNonNegativeInteger(question.categoryId, `${path}.categoryId`, findings);
  if (!question.tags || tagCount(question.tags) === 0) {
    pushFinding(findings, "error", `${path}.tags`, "At least one public tag is required.");
  }
  if (question.tags && !Array.isArray(question.tags) && typeof question.tags !== "string") {
    pushFinding(findings, "error", `${path}.tags`, "Tags must be an array or comma-separated string.");
  } else if (question.tags) {
    const tagList = Array.isArray(question.tags)
      ? question.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : String(question.tags)
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
    const blockedTags = findBlockedContentTags(tagList);
    if (tagList.length > MAX_PUBLIC_TAGS) {
      pushFinding(
        findings,
        "error",
        `${path}.tags`,
        `At most ${MAX_PUBLIC_TAGS} tags are supported.`,
      );
    }
    if (blockedTags.length > 0) {
      pushFinding(
        findings,
        "error",
        `${path}.tags`,
        `Tags contain prohibited content: ${blockedTags.join(", ")}`,
      );
    }
  }
  const selectedTemplateId = typeof question.templateId === "string" && question.templateId.trim()
    ? question.templateId
    : DEFAULT_AGENT_TEMPLATE_ID;
  const selectedTemplate = findAgentResultTemplate(selectedTemplateId);
  if (question.templateId && !selectedTemplate) {
    pushFinding(findings, "error", `${path}.templateId`, `Unknown result template: ${question.templateId}.`);
  }
  if (templateVersionInput !== undefined && templateVersionInput !== null) {
    const templateVersion = parseLintPositiveInteger(templateVersionInput);
    if (templateVersion === null || templateVersion > BigInt(Number.MAX_SAFE_INTEGER)) {
      pushFinding(findings, "error", `${path}.templateVersion`, `${path}.templateVersion must be a positive safe integer.`);
    } else if (selectedTemplate && templateVersion !== BigInt(selectedTemplate.version)) {
      pushFinding(
        findings,
        "error",
        `${path}.templateVersion`,
        `${path}.templateVersion ${templateVersion.toString()} is not supported for ${selectedTemplate.id}.`,
      );
    }
  }
  if (templateId && RANK_BY_RATING_TEMPLATE_IDS.has(templateId) && /\bwhich\s+(answer|option|variant|candidate|response)\b/i.test(title)) {
    pushFinding(
      findings,
      "warning",
      `${path}.title`,
      "Rank-by-rating members should ask voters to rate one shown option, then compare ratings later.",
    );
  }
  if (templateId === FEATURE_ACCEPTANCE_TEMPLATE_ID) {
    for (const key of FEATURE_ACCEPTANCE_REQUIRED_INPUTS) {
      if (!templateInputText(templateInputs, key)) {
        pushFinding(
          findings,
          "warning",
          `${path}.templateInputs.${key}`,
          "Feature acceptance tests should include expected behavior, test steps, and acceptance criteria.",
        );
      }
    }
  }
  if (templateId === AGENT_TRACE_REVIEW_TEMPLATE_ID) {
    for (const key of AGENT_TRACE_REVIEW_REQUIRED_INPUTS) {
      if (!templateInputText(templateInputs, key)) {
        pushFinding(
          findings,
          "warning",
          `${path}.templateInputs.${key}`,
          "Agent trace reviews should include a trace id, task goal, and review focus.",
        );
      }
    }
  }
  if (templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    for (const key of HEAD_TO_HEAD_AB_REQUIRED_INPUTS) {
      if (!templateInputText(templateInputs, key)) {
        pushFinding(
          findings,
          "error",
          `${path}.templateInputs.${key}`,
          "Head-to-head A/B questions require optionAKey, optionALabel, optionBKey, and optionBLabel.",
        );
      }
    }
    const optionAKey = normalizeHeadToHeadOptionKey(templateInputs?.optionAKey);
    const optionBKey = normalizeHeadToHeadOptionKey(templateInputs?.optionBKey);
    if (templateInputs?.optionAKey !== undefined && !optionAKey) {
      pushFinding(findings, "error", `${path}.templateInputs.optionAKey`, "optionAKey must be a single uppercase letter A-Z.");
    }
    if (templateInputs?.optionBKey !== undefined && !optionBKey) {
      pushFinding(findings, "error", `${path}.templateInputs.optionBKey`, "optionBKey must be a single uppercase letter A-Z.");
    }
    if (optionAKey && optionBKey && optionAKey === optionBKey) {
      pushFinding(findings, "error", `${path}.templateInputs.optionBKey`, "optionBKey must differ from optionAKey.");
    }
    if (!readHeadToHeadTemplateInputs(templateInputs)) {
      const hasAllKeys =
        HEAD_TO_HEAD_AB_REQUIRED_INPUTS.every(key => templateInputText(templateInputs, key).length > 0);
      if (hasAllKeys) {
        pushFinding(
          findings,
          "error",
          `${path}.templateInputs`,
          "Head-to-head option labels must be 1-32 characters and keys must be distinct single letters.",
        );
      }
    } else {
      const titleError = getHeadToHeadAbTitleValidationError(
        title,
        templateInputText(templateInputs, "optionALabel"),
        templateInputText(templateInputs, "optionBLabel"),
      );
      if (titleError) {
        pushFinding(findings, "error", `${path}.title`, titleError);
      }
    }
  }
  if (question.imageUrls !== undefined && hasInvalidUploadedImageUrlList(question.imageUrls)) {
    pushFinding(
      findings,
      "error",
      `${path}.imageUrls`,
      "Image URLs must come from RateLoop uploads. Upload bytes with rateloop_upload_image first.",
    );
  } else if (Array.isArray(question.imageUrls) && question.imageUrls.length > MAX_QUESTION_IMAGE_URLS) {
    pushFinding(
      findings,
      "error",
      `${path}.imageUrls`,
      `imageUrls supports at most ${MAX_QUESTION_IMAGE_URLS} images.`,
    );
  }
  if (question.videoUrl && !looksLikeYouTubeVideoUrl(question.videoUrl)) {
    pushFinding(findings, "error", `${path}.videoUrl`, "Video URL must be a supported YouTube HTTPS URL.");
  }
  lintTargetAudience(question.targetAudience, `${path}.targetAudience`, findings);

  return findings;
}

export function lintAgentAskRequest(input: unknown, options: AgentAskLintOptions = {}): QuestionLintFinding[] {
  const findings: QuestionLintFinding[] = [];
  if (!isObject(input)) {
    return [{ level: "error", path: "$", message: "Ask payload must be a JSON object." }];
  }

  const request = input as Partial<AgentAskExample>;
  const requestRecord = input as JsonObject;
  for (const key of Object.keys(input)) {
    if (!X402_QUESTION_TOP_LEVEL_FIELDS.has(key)) {
      pushFinding(findings, "error", key, `Unknown top-level field: ${key}`);
    }
  }

  const requireChainId = options.requireChainId ?? true;
  const clientRequestId = typeof request.clientRequestId === "string" ? request.clientRequestId.trim() : "";
  if (!clientRequestId) {
    pushFinding(findings, "error", "clientRequestId", "clientRequestId is required for idempotent agent asks.");
  } else if (!CLIENT_REQUEST_ID_PATTERN.test(clientRequestId)) {
    pushFinding(findings, "error", "clientRequestId", "clientRequestId must be 4-160 URL-safe characters.");
  }

  if (requireChainId || request.chainId !== undefined) {
    lintRequiredSafeChainId(request.chainId, "chainId", findings);
  }
  if (options.requireMaxPaymentAmount && (request.maxPaymentAmount === undefined || request.maxPaymentAmount === null)) {
    pushFinding(
      findings,
      "error",
      "maxPaymentAmount",
      "maxPaymentAmount is required before an agent can spend.",
    );
  } else {
    lintOptionalSafeNonNegativeInteger(request.maxPaymentAmount, "maxPaymentAmount", findings);
  }

  if (!isObject(request.bounty)) {
    pushFinding(findings, "error", "bounty", "A bounty object is required before an agent spends.");
  } else {
    lintSingleDurationTiming(request, findings);
    lintBountyEligibility(request, findings);
    lintOptionalRewardAsset(request.bounty.asset, "bounty.asset", findings);

    const amount = parseLintPositiveInteger(request.bounty.amount);
    if (amount === null) {
      pushFinding(findings, "error", "bounty.amount", "Bounty amount must be a positive atomic integer.");
    } else {
      const requiredVoters = parseLintVoterCount(request.bounty.requiredVoters) ?? DEFAULT_REQUIRED_VOTERS;
      lintBoundedInteger(
        request.bounty.requiredVoters,
        "bounty.requiredVoters",
        ROUND_CONFIG_UINT16_MAX,
        findings,
      );
      const requiredVoterFloor = requiredQuestionRewardParticipants(amount);
      if (requiredVoters < requiredVoterFloor) {
        pushFinding(
          findings,
          "error",
          "bounty.requiredVoters",
          `bounty.requiredVoters must be at least ${requiredVoterFloor} for this bounty amount.`,
        );
      }
    }
  }

  if (isObject(request.feedbackBonus) && (request.feedbackBonus as JsonObject).feedbackClosesAt !== undefined) {
    pushFinding(
      findings,
      "error",
      "feedbackBonus.feedbackClosesAt",
      "Remove feedbackBonus.feedbackClosesAt; Feedback Bonus timing uses roundConfig.questionDurationSeconds.",
    );
  }
  if (isObject(request.feedbackBonus)) {
    const amount = parseLintPositiveInteger((request.feedbackBonus as JsonObject).amount);
    if (amount === null) {
      pushFinding(findings, "error", "feedbackBonus.amount", "Feedback Bonus amount must be a positive atomic integer.");
    }
    lintOptionalRewardAsset((request.feedbackBonus as JsonObject).asset, "feedbackBonus.asset", findings);
  }

  if (request.templateId && !findAgentResultTemplate(request.templateId)) {
    pushFinding(findings, "error", "templateId", `Unknown result template: ${request.templateId}.`);
  }
  if (request.templateInputs !== undefined && request.templateInputs !== null && !isObject(request.templateInputs)) {
    pushFinding(findings, "error", "templateInputs", "templateInputs must be an object when provided.");
  }

  lintRoundConfigAbiBounds(request, findings);
  lintRequestRoundPreset(request, findings);
  lintRoundConfigSingleDuration(request, findings);
  lintRoundConfigVoterAlignment(request, findings);

  const questions = asQuestionArray(request as AgentAskExample);
  if (questions.length === 0) {
    pushFinding(findings, "error", "question", "Provide question or questions.");
  }
  if (questions.length > X402_MAX_QUESTION_BUNDLE_COUNT) {
    pushFinding(findings, "error", "questions", `At most ${X402_MAX_QUESTION_BUNDLE_COUNT} questions are supported.`);
  }
  if (request.question && request.questions) {
    pushFinding(findings, "error", "questions", "Use either question or questions, not both.");
  }
  const usesNestedQuestions =
    (request.question !== undefined && request.question !== null) ||
    (request.questions !== undefined && request.questions !== null);
  if (usesNestedQuestions) {
    for (const field of ["detailsUrl", "detailsHash"] as const) {
      if (requestRecord[field] !== undefined && requestRecord[field] !== null) {
        pushFinding(
          findings,
          "error",
          field,
          `${field} must be placed on each question when using question or questions.`,
        );
      }
    }
  }
  questions.forEach((question, index) => {
    findings.push(
      ...lintAgentQuestion(
        question,
        request.question ? "question" : `questions.${index}`,
        request.templateId,
        request.templateInputs,
        request.confidentiality,
        request.templateVersion,
      ),
    );
  });

  if (questions.length > 1 && request.templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    pushFinding(
      findings,
      "error",
      "templateId",
      "head_to_head_ab supports exactly one question. Use ranked_option_member bundles for 3+ options or per-option scoring.",
    );
  }
  if (questions.length > 1 && request.templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    questions.forEach((question, index) => {
      const templateId = question.templateId ?? request.templateId;
      if (templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID) return;
      pushFinding(
        findings,
        "error",
        request.question ? "question.templateId" : `questions.${index}.templateId`,
        "head_to_head_ab supports exactly one question. Use ranked_option_member bundles for 3+ options or per-option scoring.",
      );
    });
  }
  if (findings.length === 0 && questions.length > 1 && (!request.templateId || !RANK_BY_RATING_TEMPLATE_IDS.has(request.templateId))) {
    pushFinding(
      findings,
      "warning",
      "templateId",
      "Multi-question asks usually need ranked_option_member or pairwise_output_preference template metadata.",
    );
  }

  return findings;
}

export function summarizeLintFindings(findings: readonly QuestionLintFinding[]): {
  errorCount: number;
  ok: boolean;
  warningCount: number;
} {
  const errorCount = findings.filter(finding => finding.level === "error").length;
  return {
    errorCount,
    ok: errorCount === 0,
    warningCount: findings.filter(finding => finding.level === "warning").length,
  };
}
