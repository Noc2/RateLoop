import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileInput = Omit<ReviewRequestProfile, "configurationStatus">;

export const MIN_REVIEW_RESPONSE_WINDOW_SECONDS = 1_200;
export const MAX_REVIEW_RESPONSE_WINDOW_SECONDS = 86_400;
export const MAX_REVIEW_PANEL_SIZE = 500;

export type ReviewTimingFormValues = {
  responseWindowSeconds: string;
  panelSize: string;
};

export function reviewTimingFormValues(profile: ReviewRequestProfile | null | undefined): ReviewTimingFormValues {
  return {
    responseWindowSeconds: String(profile?.responseWindowSeconds ?? 3_600),
    panelSize: String(profile?.panelSize ?? 1),
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
    "Response window",
    MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
    MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
  );
  const minimumPanelSize = profile.audience === "private_invited" ? 1 : 3;
  const panelSize = requiredInteger(values.panelSize, "Reviewer count", minimumPanelSize, MAX_REVIEW_PANEL_SIZE);
  return { ...profile, responseWindowSeconds, panelSize };
}
