export const OWN_CONTENT_FEEDBACK_DISABLED_REASON = "You cannot give feedback on your own question.";
export const EXISTING_CONTENT_FEEDBACK_DISABLED_REASON = "You already published feedback for this round.";
export const ADVISORY_ONLY_CONTENT_FEEDBACK_DISABLED_REASON =
  "On-chain feedback requires a staked vote. Your advisory vote is recorded, but it cannot publish public feedback for this round.";

export function getContentFeedbackSubmitTooltip(params: {
  advisoryOnlyFeedbackBlocker?: string | null;
  canSubmitDraft: boolean;
  hasCurrentRoundVote: boolean;
  hasCurrentRoundFeedback?: boolean;
  submitBlocker?: string | null;
  isFeedbackOpen: boolean;
  isOwnContent: boolean;
}) {
  if (params.isOwnContent) {
    return OWN_CONTENT_FEEDBACK_DISABLED_REASON;
  }

  if (params.hasCurrentRoundFeedback) {
    return EXISTING_CONTENT_FEEDBACK_DISABLED_REASON;
  }

  if (params.submitBlocker) {
    return params.submitBlocker;
  }

  if (!params.isFeedbackOpen) {
    return "Feedback is only open while voting is active.";
  }

  if (!params.hasCurrentRoundVote) {
    return "You need to vote first.";
  }

  if (params.advisoryOnlyFeedbackBlocker) {
    return params.advisoryOnlyFeedbackBlocker;
  }

  if (!params.canSubmitDraft) {
    return "Write at least 4 characters.";
  }

  return "Add feedback";
}
