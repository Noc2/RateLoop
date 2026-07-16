import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileInput = Omit<ReviewRequestProfile, "configurationStatus">;

export type ReviewCriterionFormValues = Pick<
  ReviewRequestProfile,
  "criterion" | "positiveLabel" | "negativeLabel" | "rationaleMode"
>;

export const REVIEW_CRITERION_MAX_LENGTH = 500;
export const REVIEW_ANSWER_LABEL_MAX_LENGTH = 40;

function requiredText(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return normalized;
}

export function reviewCriterionFormValues(profile: ReviewRequestProfile | null | undefined): ReviewCriterionFormValues {
  return {
    criterion: profile?.criterion ?? "Is this response safe and correct?",
    positiveLabel: profile?.positiveLabel ?? "Approve",
    negativeLabel: profile?.negativeLabel ?? "Reject",
    rationaleMode: profile?.rationaleMode ?? "required",
  };
}

export function buildReviewCriterionRequestProfile(
  profile: ReviewRequestProfileInput,
  values: ReviewCriterionFormValues,
): ReviewRequestProfileInput {
  const criterion = requiredText(values.criterion, "Review question", REVIEW_CRITERION_MAX_LENGTH);
  const positiveLabel = requiredText(values.positiveLabel, "Positive label", REVIEW_ANSWER_LABEL_MAX_LENGTH);
  const negativeLabel = requiredText(values.negativeLabel, "Negative label", REVIEW_ANSWER_LABEL_MAX_LENGTH);
  if (positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US")) {
    throw new Error("Positive and negative labels must differ.");
  }
  if (!(values.rationaleMode === "off" || values.rationaleMode === "optional" || values.rationaleMode === "required")) {
    throw new Error("Choose a valid rationale setting.");
  }
  return { ...profile, criterion, positiveLabel, negativeLabel, rationaleMode: values.rationaleMode };
}
