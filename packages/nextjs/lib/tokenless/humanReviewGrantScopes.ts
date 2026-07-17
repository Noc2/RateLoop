import { AGENT_OAUTH_SAFE_SCOPES } from "~~/lib/tokenless/agentOAuth";
import { TOKENLESS_AGENT_SCOPES } from "~~/lib/tokenless/productCore";

export const OWNER_APPROVED_AGENT_SCOPES = [
  ...new Set([...AGENT_OAUTH_SAFE_SCOPES, ...TOKENLESS_AGENT_SCOPES]),
] as const;

export type HumanReviewPaymentProfile = {
  compensationMode: "unpaid" | "usdc";
  feedbackBonusEnabled: boolean;
};

export function humanReviewRequiresPayment(profile: HumanReviewPaymentProfile) {
  return profile.compensationMode === "usdc" || profile.feedbackBonusEnabled;
}

export function automaticHumanReviewGrantScopes(profile: HumanReviewPaymentProfile) {
  return OWNER_APPROVED_AGENT_SCOPES.filter(scope => scope !== "payment:submit" || humanReviewRequiresPayment(profile));
}

export function sameAutomaticHumanReviewGrantScopes(scopes: readonly string[], profile: HumanReviewPaymentProfile) {
  const expected = automaticHumanReviewGrantScopes(profile);
  return (
    scopes.length === expected.length &&
    expected.every(scope => scopes.includes(scope)) &&
    scopes.every(scope => expected.includes(scope as (typeof expected)[number]))
  );
}
