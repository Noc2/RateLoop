import {
  HEAD_TO_HEAD_AB_TEMPLATE_ID,
  buildHeadToHeadAbTitle,
  getHeadToHeadAbTitleLengthError,
  getHeadToHeadAbTitleValidationError,
  isHeadToHeadAbAutoTitle,
  readHeadToHeadTemplateInputs,
} from "@rateloop/agents/voteUi";
import { getContentTitleValidationError } from "~~/lib/moderation/submissionValidation";

export {
  buildHeadToHeadAbTitle,
  getHeadToHeadAbTitleValidationError,
  isHeadToHeadAbAutoTitle,
} from "@rateloop/agents/voteUi";

export type HeadToHeadTitleMode = "auto" | "manual";

export const HEAD_TO_HEAD_AB_QUESTION_TOOLTIP =
  "Question fills automatically from your options. You can edit it. Include both A = Option A and B = Option B in the question. Avoid vote-up-if phrasing.";

export function resolveAutoHeadToHeadTitle(optionALabel: string, optionBLabel: string): string | null {
  const trimmedA = optionALabel.trim();
  const trimmedB = optionBLabel.trim();
  if (
    !readHeadToHeadTemplateInputs({
      optionAKey: "A",
      optionALabel: trimmedA,
      optionBKey: "B",
      optionBLabel: trimmedB,
    })
  ) {
    return null;
  }
  if (getHeadToHeadAbTitleLengthError(trimmedA, trimmedB)) {
    return null;
  }
  return buildHeadToHeadAbTitle(trimmedA, trimmedB);
}

export function getHeadToHeadOptionValidationError(optionALabel: string, optionBLabel: string): string | null {
  const trimmedA = optionALabel.trim();
  const trimmedB = optionBLabel.trim();
  if (trimmedA.length > 32 || trimmedB.length > 32) {
    return "Option names must be 32 characters or fewer.";
  }
  const inputs = readHeadToHeadTemplateInputs({
    optionAKey: "A",
    optionALabel: trimmedA,
    optionBKey: "B",
    optionBLabel: trimmedB,
  });
  if (!inputs) return "Enter both option names for the A/B comparison.";
  const lengthError = getHeadToHeadAbTitleLengthError(trimmedA, trimmedB);
  if (lengthError) return lengthError;
  return null;
}

export function getHeadToHeadQuestionTitleError(
  optionALabel: string,
  optionBLabel: string,
  title: string,
): string | null {
  if (getHeadToHeadOptionValidationError(optionALabel, optionBLabel)) return null;
  const moderationError = title.trim() ? getContentTitleValidationError(title) : null;
  if (moderationError) return moderationError;
  return getHeadToHeadAbTitleValidationError(title, optionALabel, optionBLabel);
}

export function mergeHeadToHeadDraftQuestion<
  T extends {
    templateId: string;
    title: string;
    optionALabel: string;
    optionBLabel: string;
    headToHeadTitleMode: HeadToHeadTitleMode;
  },
>(question: T, patch: Partial<T>): T {
  let next = { ...question, ...patch };

  if (patch.templateId === HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    next = { ...next, headToHeadTitleMode: "auto", title: "" };
  } else if (patch.templateId === "") {
    next = {
      ...next,
      headToHeadTitleMode: "auto",
      optionALabel: "",
      optionBLabel: "",
    };
  }

  if (next.templateId !== HEAD_TO_HEAD_AB_TEMPLATE_ID) {
    return next;
  }

  if (patch.title !== undefined) {
    next.headToHeadTitleMode = isHeadToHeadAbAutoTitle(patch.title, next.optionALabel, next.optionBLabel)
      ? "auto"
      : "manual";
  }

  if ((patch.optionALabel !== undefined || patch.optionBLabel !== undefined) && next.headToHeadTitleMode === "auto") {
    const suggestedTitle = resolveAutoHeadToHeadTitle(next.optionALabel, next.optionBLabel);
    if (suggestedTitle) {
      next.title = suggestedTitle;
    }
  }

  return next;
}
