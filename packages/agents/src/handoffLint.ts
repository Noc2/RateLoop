import type { QuestionLintFinding } from "./questions/types.js";

const MISSING_CONTEXT_MESSAGE = "Context URL, RateLoop-hosted details URL, image URL, or video URL is required.";
const GENERATED_IMAGE_SINGLE_QUESTION_MESSAGE = "generatedImages currently support single-question handoffs.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasSingleQuestionArray(payload: unknown) {
  if (!isRecord(payload) || payload.question !== undefined) return false;
  return Array.isArray(payload.questions) && payload.questions.length === 1;
}

export function shouldKeepHandoffFinding(
  finding: QuestionLintFinding,
  options: { hasGeneratedImages: boolean; payload: unknown },
) {
  if (!options.hasGeneratedImages) return true;
  if (finding.level !== "error" || finding.message !== MISSING_CONTEXT_MESSAGE) return true;
  if (finding.path === "question.contextUrl") return false;
  return !(finding.path === "questions.0.contextUrl" && hasSingleQuestionArray(options.payload));
}

export function lintGeneratedImageHandoffShape(options: {
  hasGeneratedImages: boolean;
  payload: unknown;
}): QuestionLintFinding[] {
  if (
    !options.hasGeneratedImages ||
    !isRecord(options.payload) ||
    options.payload.question !== undefined
  ) {
    return [];
  }

  const questions = options.payload.questions;
  if (!Array.isArray(questions)) return [];
  if (questions.length === 1 && isRecord(questions[0])) return [];

  return [
    {
      level: "error",
      path: "questions",
      message: GENERATED_IMAGE_SINGLE_QUESTION_MESSAGE,
    },
  ];
}
