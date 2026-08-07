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

/** Matches the translator shape `useAgentTranslations` returns. */
export type ReviewTimingTranslate = (key: string, values?: Record<string, number | string>) => string;

/** The two field labels this step validates, already localised by the caller. */
export type ReviewTimingLabels = {
  panelSize: string;
  responseWindow: string;
};

// The rendered labels come from `useLocalizedReviewPolicyCopy()`, so building
// the error from the untranslated `reviewPolicyCopy` constant put a German
// label above an English sentence. `wholeNumber` and `numberRange` already
// exist in the reviewEditor namespace in both catalogues, which is what
// AgentHumanReviewEditor validates against — reuse them rather than adding a
// second pair of strings that can drift.
const ENGLISH_FALLBACK_LABELS: ReviewTimingLabels = {
  panelSize: reviewPolicyCopy.timing.panelSize,
  responseWindow: reviewPolicyCopy.timing.responseWindow,
};

function requiredInteger(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
  t: ReviewTimingTranslate | undefined,
) {
  if (!/^\d+$/u.test(value.trim())) {
    throw new Error(t ? t("wholeNumber", { label }) : `${label} must be a whole number.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      t ? t("numberRange", { label, minimum, maximum }) : `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

export function buildReviewTimingRequestProfile(
  profile: ReviewRequestProfileInput,
  values: ReviewTimingFormValues,
  localization?: { labels: ReviewTimingLabels; t: ReviewTimingTranslate },
): ReviewRequestProfileInput {
  const labels = localization?.labels ?? ENGLISH_FALLBACK_LABELS;
  const t = localization?.t;
  const responseWindowSeconds = requiredInteger(
    values.responseWindowSeconds,
    labels.responseWindow,
    MIN_REVIEW_RESPONSE_WINDOW_SECONDS,
    MAX_REVIEW_RESPONSE_WINDOW_SECONDS,
    t,
  );
  const minimumPanelSize = minimumReviewPanelSizeForAudience(profile.audience);
  const panelSize = requiredInteger(values.panelSize, labels.panelSize, minimumPanelSize, MAX_REVIEW_PANEL_SIZE, t);
  return { ...profile, responseWindowSeconds, panelSize };
}
