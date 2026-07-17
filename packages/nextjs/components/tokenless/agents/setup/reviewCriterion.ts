import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileDraft = Omit<ReviewRequestProfile, "configurationStatus">;
type ReviewRequestProfileInput = Omit<ReviewRequestProfileDraft, "resultSemantics">;

export type ReviewCriterionFormValues = {
  questionAuthority: ReviewRequestProfile["questionAuthority"];
  criterion: string;
  positiveLabel: string;
  negativeLabel: string;
  rationaleMode: ReviewRequestProfile["rationaleMode"];
};

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
    questionAuthority: profile?.questionAuthority ?? "owner_fixed",
    criterion: profile ? (profile.criterion ?? "") : "Is this response safe and correct?",
    positiveLabel: profile ? (profile.positiveLabel ?? "") : "Approve",
    negativeLabel: profile ? (profile.negativeLabel ?? "") : "Reject",
    rationaleMode: profile?.rationaleMode ?? "required",
  };
}

export function buildReviewCriterionRequestProfile(
  profile: ReviewRequestProfileDraft,
  values: ReviewCriterionFormValues,
): ReviewRequestProfileInput {
  if (!(values.rationaleMode === "off" || values.rationaleMode === "optional" || values.rationaleMode === "required")) {
    throw new Error("Choose a valid rationale setting.");
  }
  const { resultSemantics: _resultSemantics, ...input } = profile;
  void _resultSemantics;
  if (values.questionAuthority === "agent_per_request") {
    const { criterion: _criterion, positiveLabel: _positiveLabel, negativeLabel: _negativeLabel, ...dynamic } = input;
    void _criterion;
    void _positiveLabel;
    void _negativeLabel;
    return { ...dynamic, questionAuthority: "agent_per_request", rationaleMode: values.rationaleMode };
  }
  if (values.questionAuthority !== "owner_fixed") throw new Error("Choose who writes each review question.");
  const criterion = requiredText(values.criterion, "Review question", REVIEW_CRITERION_MAX_LENGTH);
  const positiveLabel = requiredText(values.positiveLabel, "Positive label", REVIEW_ANSWER_LABEL_MAX_LENGTH);
  const negativeLabel = requiredText(values.negativeLabel, "Negative label", REVIEW_ANSWER_LABEL_MAX_LENGTH);
  if (positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US")) {
    throw new Error("Positive and negative labels must differ.");
  }
  return {
    ...input,
    questionAuthority: "owner_fixed",
    criterion,
    positiveLabel,
    negativeLabel,
    rationaleMode: values.rationaleMode,
  };
}
