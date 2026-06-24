import { findAgentResultTemplate, getAgentResultTemplateBySpecHash } from "./templates";

export const HEAD_TO_HEAD_AB_TEMPLATE_ID = "head_to_head_ab";
export const MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH = 32;

const SINGLE_LETTER_KEY_PATTERN = /^[A-Z]$/;

export type HeadToHeadVoteUi = {
  mode: "head_to_head";
  optionAKey: string;
  optionALabel: string;
  optionBKey: string;
  optionBLabel: string;
  comparisonCriterion?: string;
};

export type VoteUiConfig = HeadToHeadVoteUi | { mode: "thumbs" };

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
  const comparisonCriterion = readTrimmedString(templateInputs.comparisonCriterion);

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
    ...(comparisonCriterion ? { comparisonCriterion } : {}),
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
