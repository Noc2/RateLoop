import "server-only";
import { type HumanReviewAudience, configuredHumanReviewMutationCapability } from "~~/lib/tokenless/reviewCapabilities";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export function assertHumanReviewMutationAvailable(input: {
  audience: HumanReviewAudience;
  feedbackBonusEnabled: boolean;
}) {
  const capability = configuredHumanReviewMutationCapability(input);
  if (!capability.available) {
    throw new TokenlessServiceError(capability.message, 409, "human_review_experiment_unavailable");
  }
  return capability;
}
