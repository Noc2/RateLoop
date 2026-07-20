import type { ReviewRoutingAuthority } from "../ReviewRoutingFields";
import type { ReviewAudienceFormValues } from "./reviewAudience";
import type { ReviewCompensationFormValues } from "./reviewCompensation";

export type SetupAutomaticSendingEligibility = {
  available: boolean;
  reason: string | null;
};

export function setupAutomaticSendingEligibility(input: {
  audience: ReviewAudienceFormValues["audience"];
  compensationMode: ReviewCompensationFormValues["compensationMode"];
  feedbackBonusEnabled: boolean;
  grantAvailable: boolean;
}): SetupAutomaticSendingEligibility {
  if (input.audience !== "private_invited") {
    return { available: false, reason: "Choose Invited reviewers to enable automatic sending during setup." };
  }
  if (input.compensationMode !== "unpaid") {
    return { available: false, reason: "Choose No bounty to enable automatic sending during setup." };
  }
  if (input.feedbackBonusEnabled) {
    return { available: false, reason: "Choose No bonus to enable automatic sending during setup." };
  }
  if (!input.grantAvailable) {
    return { available: false, reason: "Automatic sending isn’t available for this connection." };
  }
  return { available: true, reason: null };
}

export function reconcileSetupAutomaticAuthority(
  authority: ReviewRoutingAuthority,
  eligibility: SetupAutomaticSendingEligibility,
): { authority: ReviewRoutingAuthority; changed: boolean } {
  if (authority !== "ask_automatically" || eligibility.available) return { authority, changed: false };
  return { authority: "prepare_for_approval", changed: true };
}
