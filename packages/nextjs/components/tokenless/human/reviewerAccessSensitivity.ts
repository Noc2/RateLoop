import type { ReviewRequestPrivateSensitivity } from "~~/lib/tokenless/reviewRequestProfiles";

export const REVIEWER_ACCESS_SENSITIVITY_MESSAGE_KEYS = {
  internal: "sensitivity.internal",
  confidential: "sensitivity.confidential",
  restricted: "sensitivity.restricted",
  regulated: "sensitivity.regulated",
} as const satisfies Record<ReviewRequestPrivateSensitivity, string>;

export type ReviewerAccessPrivateSensitivity = keyof typeof REVIEWER_ACCESS_SENSITIVITY_MESSAGE_KEYS;

export function reviewerAccessSensitivityMessageKey(sensitivity: ReviewerAccessPrivateSensitivity) {
  return REVIEWER_ACCESS_SENSITIVITY_MESSAGE_KEYS[sensitivity];
}
