import { MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH } from "./voteUi.js";

export const HEAD_TO_HEAD_AB_TITLE_MAX_LENGTH = 120;

export const VOTE_UP_IF_TITLE_PATTERN = /\bvote\s+up\s+if\b/i;

export function buildHeadToHeadAbTitle(optionALabel: string, optionBLabel: string): string {
  return `Do you prefer A = ${optionALabel.trim()} or B = ${optionBLabel.trim()}?`;
}

export function formatHeadToHeadOptionMarker(optionKey: "A" | "B", optionLabel: string): string {
  return `${optionKey} = ${optionLabel.trim()}`;
}

export function titleIncludesHeadToHeadOptionMarkers(
  title: string,
  optionALabel: string,
  optionBLabel: string,
): boolean {
  const trimmedTitle = title.trim();
  const markerA = formatHeadToHeadOptionMarker("A", optionALabel);
  const markerB = formatHeadToHeadOptionMarker("B", optionBLabel);
  return trimmedTitle.includes(markerA) && trimmedTitle.includes(markerB);
}

export function getHeadToHeadAbTitleLengthError(optionALabel: string, optionBLabel: string): string | null {
  const expected = buildHeadToHeadAbTitle(optionALabel, optionBLabel);
  if (expected.length > HEAD_TO_HEAD_AB_TITLE_MAX_LENGTH) {
    return `Combined question exceeds ${HEAD_TO_HEAD_AB_TITLE_MAX_LENGTH} characters — shorten option names.`;
  }
  return null;
}

export function getHeadToHeadAbTitleValidationError(
  title: string,
  optionALabel: string,
  optionBLabel: string,
): string | null {
  const trimmedTitle = title.trim();
  const trimmedA = optionALabel.trim();
  const trimmedB = optionBLabel.trim();

  if (!trimmedTitle) {
    return "Question is required.";
  }

  if (VOTE_UP_IF_TITLE_PATTERN.test(trimmedTitle)) {
    return "Head-to-head titles should ask which option voters prefer. Avoid vote-up-if phrasing.";
  }

  const lengthError = getHeadToHeadAbTitleLengthError(trimmedA, trimmedB);
  if (lengthError) {
    return lengthError;
  }

  const markerA = formatHeadToHeadOptionMarker("A", trimmedA);
  const markerB = formatHeadToHeadOptionMarker("B", trimmedB);
  if (!trimmedTitle.includes(markerA) || !trimmedTitle.includes(markerB)) {
    return `Include both option names in the question, e.g. ${markerA} and ${markerB}.`;
  }

  return null;
}

export function isHeadToHeadAbAutoTitle(title: string, optionALabel: string, optionBLabel: string): boolean {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return true;

  const trimmedA = optionALabel.trim();
  const trimmedB = optionBLabel.trim();
  if (!trimmedA || !trimmedB) return false;

  return trimmedTitle === buildHeadToHeadAbTitle(trimmedA, trimmedB);
}

export function isHeadToHeadAbTitleWithinOptionLabelLimits(optionALabel: string, optionBLabel: string): boolean {
  return (
    optionALabel.trim().length > 0 &&
    optionBLabel.trim().length > 0 &&
    optionALabel.trim().length <= MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH &&
    optionBLabel.trim().length <= MAX_HEAD_TO_HEAD_OPTION_LABEL_LENGTH
  );
}
