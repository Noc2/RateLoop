import type { ReviewRequestProfileInput } from "./reviewCriterion";
import { reviewPolicyCopy } from "~~/components/tokenless/agents/reviewPolicyCopy";
import {
  MAXIMUM_REVIEW_PANEL_SIZE,
  MINIMUM_REVIEW_PANEL_SIZE,
  minimumReviewPanelSizeForAudience,
} from "~~/lib/tokenless/reviewPanelPolicy";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];

export const MIN_REVIEW_RESPONSE_WINDOW_SECONDS = 1_200;
export const MAX_REVIEW_RESPONSE_WINDOW_SECONDS = 86_400;
// The server rejects anything outside these bounds when the profile is saved;
// the wizard must not offer a panel the service will refuse.
export const MIN_REVIEW_PANEL_SIZE = MINIMUM_REVIEW_PANEL_SIZE;
export const MAX_REVIEW_PANEL_SIZE = MAXIMUM_REVIEW_PANEL_SIZE;

export type ReviewTimingFormValues = {
  responseWindowSeconds: string;
  panelSize: string;
};

export function reviewTimingFormValues(profile: ReviewRequestProfile | null | undefined): ReviewTimingFormValues {
  return {
    responseWindowSeconds: String(profile?.responseWindowSeconds ?? 3_600),
    panelSize: String(profile?.panelSize ?? MIN_REVIEW_PANEL_SIZE),
  };
}

function requiredInteger(value: string, field: string, minimum: number, maximum: number) {
  if (!/^\d+$/u.test(value.trim())) throw new Error(`${field} must be a whole number.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export function buildReviewTimingRequestProfile(
  profile: ReviewRequestProfileInput,
  values: ReviewTimingFormValues,
): ReviewRequestProfileInput {
  const responseWindowSeconds = requiredInteger(
    values.responseWindowSeconds,
    reviewPolicyCopy.timing.responseWindow,
    MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
    MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  const minimumPanelSize = minimumReviewPanelSizeForAudience(profile.audience);
  const panelSize = requiredInteger(
    values.panelSize,
    reviewPolicyCopy.timing.panelSize,
    minimumPanelSize,
    MAX_REVIEW_PANEL_SIZE,
  );
  return { ...profile, responseWindowSeconds, panelSize };
}
