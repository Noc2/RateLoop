import {
  REVIEWER_EXPERTISE,
  type ReviewerExpertiseKey,
  normalizeReviewerExpertiseSelection,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

type ReviewRequestProfile = AgentSetupReviewDraft["requestProfile"];
type ReviewRequestProfileInput = Omit<ReviewRequestProfile, "configurationStatus">;

export { REVIEWER_EXPERTISE };
export type ReviewExpertiseFormValues = { requiredExpertiseKeys: ReviewerExpertiseKey[] };
export type ReviewExpertiseEligibility = {
  eligible: number;
  invited: { eligible: number };
  network: { eligible: number; ready: boolean };
};

export function reviewExpertiseFormValues(profile: ReviewRequestProfile | null | undefined): ReviewExpertiseFormValues {
  return { requiredExpertiseKeys: normalizeReviewerExpertiseSelection(profile?.requiredExpertiseKeys ?? []) };
}

export function buildReviewExpertiseRequestProfile(
  profile: ReviewRequestProfileInput,
  values: ReviewExpertiseFormValues,
): ReviewRequestProfileInput {
  return { ...profile, requiredExpertiseKeys: normalizeReviewerExpertiseSelection(values.requiredExpertiseKeys) };
}

export function reviewExpertiseEligibilityStatus(input: {
  audience: ReviewRequestProfile["audience"];
  eligibility: ReviewExpertiseEligibility | null;
  panelSize: number | string;
  requiredExpertiseCount: number;
}) {
  if (input.requiredExpertiseCount === 0) return { feasible: true, summary: "No expertise requirement selected." };
  if (!input.eligibility) return { feasible: false, summary: "Checking the eligible reviewer pool…" };
  const parsedPanelSize = Number(input.panelSize);
  const required = Number.isSafeInteger(parsedPanelSize) && parsedPanelSize >= 1 ? parsedPanelSize : 1;
  if (input.audience === "private_invited") {
    const eligible = input.eligibility.invited.eligible;
    return {
      feasible: eligible >= required,
      summary: `${eligible} of ${required} invited reviewers needed are currently eligible.`,
    };
  }
  if (input.audience === "public_network") {
    const eligible = input.eligibility.network.ready ? input.eligibility.network.eligible : 0;
    return {
      feasible: eligible >= required,
      summary: `${eligible} of ${required} public-network reviewers needed are currently eligible.`,
    };
  }
  const invited = input.eligibility.invited.eligible;
  const network = input.eligibility.network.ready ? input.eligibility.network.eligible : 0;
  return {
    feasible: invited >= 1 && network >= 1 && invited + network >= required,
    summary: `${invited + network} of ${required} reviewers needed are eligible, including ${invited} invited and ${network} public-network.`,
  };
}
