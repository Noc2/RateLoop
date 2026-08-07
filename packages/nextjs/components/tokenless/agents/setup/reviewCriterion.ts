import { type SetupLocalization, type SetupMessages, SetupValidationError, setupMessages } from "./setupMessages";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileDraft = Omit<ReviewRequestProfile, "configurationStatus">;
export type ReviewRequestProfileInput = Omit<
  ReviewRequestProfileDraft,
  "resultSemantics" | "criterion" | "positiveLabel" | "negativeLabel"
> &
  Partial<Pick<ReviewRequestProfileDraft, "criterion" | "positiveLabel" | "negativeLabel">>;

export type ReviewCriterionFormValues = {
  questionAuthority: ReviewRequestProfile["questionAuthority"];
  criterion: string;
  positiveLabel: string;
  negativeLabel: string;
  rationaleMode: ReviewRequestProfile["rationaleMode"];
};

export const REVIEW_CRITERION_MAX_LENGTH = 500;
export const REVIEW_ANSWER_LABEL_MAX_LENGTH = 40;

function requiredText(value: string, label: string, maximum: number, messages: SetupMessages) {
  const normalized = value.trim();
  if (!normalized) throw new SetupValidationError(messages.required(label));
  if (normalized.length > maximum) throw new SetupValidationError(messages.maxLength(label, maximum));
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
  localization?: SetupLocalization,
): ReviewRequestProfileInput {
  const messages = setupMessages(localization);
  if (!(values.rationaleMode === "off" || values.rationaleMode === "optional" || values.rationaleMode === "required")) {
    throw new SetupValidationError(messages.invalidRationale());
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
  if (values.questionAuthority !== "owner_fixed") throw new SetupValidationError(messages.invalidQuestionAuthority());
  const criterion = requiredText(
    values.criterion,
    messages.policy.question.criterion,
    REVIEW_CRITERION_MAX_LENGTH,
    messages,
  );
  const positiveLabel = requiredText(
    values.positiveLabel,
    messages.policy.question.positiveAnswer,
    REVIEW_ANSWER_LABEL_MAX_LENGTH,
    messages,
  );
  const negativeLabel = requiredText(
    values.negativeLabel,
    messages.policy.question.negativeAnswer,
    REVIEW_ANSWER_LABEL_MAX_LENGTH,
    messages,
  );
  if (positiveLabel.toLocaleLowerCase("en-US") === negativeLabel.toLocaleLowerCase("en-US")) {
    throw new SetupValidationError(messages.answerLabelsMustDiffer());
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
