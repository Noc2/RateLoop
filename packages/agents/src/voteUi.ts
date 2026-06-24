import { findAgentResultTemplate, getAgentResultTemplateBySpecHash } from "./templates";

export const HEAD_TO_HEAD_AB_TEMPLATE_ID = "head_to_head_ab";
export const MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH = 32;

const SINGLE_LETTER_KEY_PATTERN = /^[A-Z]$/;
const RANK_BY_RATING_TEMPLATE_IDS = new Set(["ranked_option_member", "pairwise_output_preference"]);
const OPTION_LABEL_BOUNDARY_PATTERN =
  /\s+(?:if|when|where|while|especially|because|for|as|to|in|on|with|including)\b.*$/i;
const OPTION_PAIR_PATTERNS = [
  /\boption\s*A\s*[:=,-]\s*(?<a>[\s\S]{1,120}?)\s+(?:over|vs\.?|versus|rather than|instead of|or)\s+option\s*B\s*[:=,-]\s*(?<b>[\s\S]{1,120})/i,
  /\boption\s*A\s*[:=,-]\s*(?<a>[\s\S]{1,120}?)\s*(?:[,;|/]|and|or)\s+option\s*B\s*[:=,-]\s*(?<b>[\s\S]{1,120})/i,
  /\bA\s*=\s*(?<a>[\s\S]{1,120}?)\s+(?:or|over|vs\.?|versus|rather than|instead of)\s+B\s*=\s*(?<b>[\s\S]{1,120})/i,
] as const;

export type HeadToHeadVoteUi = {
  mode: "head_to_head";
  optionAKey: string;
  optionALabel: string;
  optionBKey: string;
  optionBLabel: string;
};

export type VoteUiConfig = HeadToHeadVoteUi | { mode: "thumbs" };
export type InferredHeadToHeadAbQuestion = {
  optionALabel: string;
  optionBLabel: string;
  title: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeHeadToHeadOptionKey(value: unknown): string | null {
  const key = readTrimmedString(value).toUpperCase();
  return SINGLE_LETTER_KEY_PATTERN.test(key) ? key : null;
}

export function readHeadToHeadTemplateInputs(templateInputs: unknown): HeadToHeadVoteUi | null {
  if (!isRecord(templateInputs)) return null;

  const optionAKey = normalizeHeadToHeadOptionKey(templateInputs.optionAKey);
  const optionBKey = normalizeHeadToHeadOptionKey(templateInputs.optionBKey);
  const optionALabel = readTrimmedString(templateInputs.optionALabel);
  const optionBLabel = readTrimmedString(templateInputs.optionBLabel);

  if (
    !optionAKey ||
    !optionBKey ||
    optionAKey === optionBKey ||
    !optionALabel ||
    !optionBLabel ||
    optionALabel.length > MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH ||
    optionBLabel.length > MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH
  ) {
    return null;
  }

  return {
    mode: "head_to_head",
    optionAKey,
    optionALabel,
    optionBKey,
    optionBLabel,
  };
}

function cleanInferredOptionLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const label = value
    .replace(/\s+/g, " ")
    .replace(OPTION_LABEL_BOUNDARY_PATTERN, "")
    .replace(/\bvote\s+(?:up|down)\b.*$/i, "")
    .replace(/^[\s"'`“”()[\],;:=-]+|[\s"'`“”()[\],;:!?=-]+$/g, "")
    .trim();
  if (!label || label.length > MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH) return "";
  return label;
}

function buildInferredHeadToHeadAbTitle(optionALabel: string, optionBLabel: string) {
  return `Do you prefer A = ${optionALabel} or B = ${optionBLabel}?`;
}

export function inferHeadToHeadAbQuestionFromText(text: string): InferredHeadToHeadAbQuestion | null {
  const source = text.trim();
  if (!source) return null;

  for (const pattern of OPTION_PAIR_PATTERNS) {
    const match = source.match(pattern);
    const optionALabel = cleanInferredOptionLabel(match?.groups?.a);
    const optionBLabel = cleanInferredOptionLabel(match?.groups?.b);
    if (!optionALabel || !optionBLabel || optionALabel === optionBLabel) continue;
    return {
      optionALabel,
      optionBLabel,
      title: buildInferredHeadToHeadAbTitle(optionALabel, optionBLabel),
    };
  }

  return null;
}

export function inferHeadToHeadAbQuestion(question: unknown, inheritedTemplateId?: unknown): InferredHeadToHeadAbQuestion | null {
  if (!isRecord(question)) return null;
  const templateId = readTrimmedString(question.templateId) || readTrimmedString(inheritedTemplateId);
  if (templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID || RANK_BY_RATING_TEMPLATE_IDS.has(templateId)) return null;

  const title = readTrimmedString(question.title);
  const description = readTrimmedString(question.description);
  return inferHeadToHeadAbQuestionFromText(`${title}\n${description}`);
}

export function normalizeInferredHeadToHeadAbQuestion(
  question: Record<string, unknown>,
  inheritedTemplateId?: unknown,
): { inferred: InferredHeadToHeadAbQuestion | null; question: Record<string, unknown> } {
  const inferred = inferHeadToHeadAbQuestion(question, inheritedTemplateId);
  if (!inferred) return { inferred: null, question };
  const templateInputs = isRecord(question.templateInputs) ? question.templateInputs : {};
  return {
    inferred,
    question: {
      ...question,
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      templateInputs: {
        ...templateInputs,
        optionAKey: "A",
        optionALabel: inferred.optionALabel,
        optionBKey: "B",
        optionBLabel: inferred.optionBLabel,
      },
      title: inferred.title,
    },
  };
}

export function normalizeInferredHeadToHeadAbRequestBody(
  requestBody: Record<string, unknown>,
): { inferred: InferredHeadToHeadAbQuestion | null; requestBody: Record<string, unknown> } {
  const question = requestBody.question;
  if (isRecord(question)) {
    const normalized = normalizeInferredHeadToHeadAbQuestion(question, requestBody.templateId);
    if (!normalized.inferred) return { inferred: null, requestBody };
    return {
      inferred: normalized.inferred,
      requestBody: {
        ...requestBody,
        question: normalized.question,
        templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      },
    };
  }

  const questions = requestBody.questions;
  if (Array.isArray(questions) && questions.length === 1 && isRecord(questions[0])) {
    const normalized = normalizeInferredHeadToHeadAbQuestion(questions[0], requestBody.templateId);
    if (!normalized.inferred) return { inferred: null, requestBody };
    return {
      inferred: normalized.inferred,
      requestBody: {
        ...requestBody,
        questions: [normalized.question],
        templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
      },
    };
  }

  const normalized = normalizeInferredHeadToHeadAbQuestion(requestBody);
  if (!normalized.inferred) return { inferred: null, requestBody };
  return {
    inferred: normalized.inferred,
    requestBody: {
      ...normalized.question,
      templateId: HEAD_TO_HEAD_AB_TEMPLATE_ID,
    },
  };
}

export function readHeadToHeadVoteUiFromQuestionMetadata(metadata: unknown): HeadToHeadVoteUi | null {
  if (!isRecord(metadata)) return null;
  const templateId = readTrimmedString(metadata.templateId);
  if (templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID) return null;
  return readHeadToHeadTemplateInputs(metadata.templateInputs);
}

export function resolveVoteUiConfig(params: {
  resultSpecHash?: string | null;
  questionMetadata?: unknown;
  templateInputs?: unknown;
}): VoteUiConfig {
  const template = getAgentResultTemplateBySpecHash(params.resultSpecHash);
  if (template.id !== HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    return { mode: "thumbs" };
  }

  const fromMetadata = readHeadToHeadVoteUiFromQuestionMetadata(params.questionMetadata);
  if (fromMetadata) return fromMetadata;

  const fromInputs = readHeadToHeadTemplateInputs(params.templateInputs);
  if (fromInputs) return fromInputs;

  return { mode: "thumbs" };
}

export function getHeadToHeadAbResultSpecHash(): `0x${string}` {
  return findAgentResultTemplate(HEAD_TO_HEAD_AB_TEMPLATE_ID)?.resultSpecHash ?? ("0x" as `0x${string}`);
}

export {
  HEAD_TO_HEAD_AB_TITLE_MAX_LENGTH,
  VOTE_UP_IF_TITLE_PATTERN,
  buildHeadToHeadAbTitle,
  formatHeadToHeadOptionMarker,
  getHeadToHeadAbTitleLengthError,
  getHeadToHeadAbTitleValidationError,
  isHeadToHeadAbAutoTitle,
  isHeadToHeadAbTitleWithinOptionLabelLimits,
  titleIncludesHeadToHeadOptionMarkers,
} from "./headToHeadTitle.js";
