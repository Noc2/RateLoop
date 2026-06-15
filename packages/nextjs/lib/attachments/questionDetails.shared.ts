export const MAX_QUESTION_DETAILS_TEXT_LENGTH = 4000;
export const MAX_QUESTION_DETAILS_TEXT_BYTES = 16 * 1024;

const UNSUPPORTED_TEXT_CONTROL_CHARS_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function normalizeQuestionDetailsText(value: string) {
  const normalized = value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!normalized) {
    throw new Error("Details are empty.");
  }
  if (normalized.length > MAX_QUESTION_DETAILS_TEXT_LENGTH) {
    throw new Error(`Details must be ${MAX_QUESTION_DETAILS_TEXT_LENGTH} characters or fewer.`);
  }
  if (UNSUPPORTED_TEXT_CONTROL_CHARS_PATTERN.test(normalized)) {
    throw new Error("Details contain unsupported control characters.");
  }

  return normalized;
}

export function getQuestionDetailsTextSizeBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

export function questionDetailsHashInput(params: {
  detailsId: string;
  normalizedText: string;
  requiresGatedAccess?: boolean;
}) {
  if (params.requiresGatedAccess) {
    return ["rateloop.gated-question-details.v1", params.detailsId, params.normalizedText].join("\n");
  }
  return params.normalizedText;
}
