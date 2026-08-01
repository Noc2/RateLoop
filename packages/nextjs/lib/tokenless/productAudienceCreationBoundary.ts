import "server-only";

const OPPORTUNITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

const AUDIENCE_FAMILIES = {
  customer_invited: "invited",
  private_invited: "invited",
  rateloop_network: "network",
  public_network: "network",
  public_paid_network: "network",
  hybrid: "hybrid",
  hybrid_public_safe: "hybrid",
} as const;

type AudienceAlias = keyof typeof AUDIENCE_FAMILIES;
type AudienceFamily = (typeof AUDIENCE_FAMILIES)[AudienceAlias];

export type ProductAudienceCreationBoundary =
  | { kind: "generic_product" }
  | { kind: "opportunity_bound_network"; opportunityId: string };

export type ProductAudienceCreationDecision =
  | { allowed: true; family: "invited" | "network" }
  | {
      allowed: false;
      code: "network_opportunity_adapter_required" | "network_opportunity_boundary_invalid";
      message: string;
    };

function family(value: unknown): AudienceFamily | null {
  if (typeof value !== "string") return null;
  return AUDIENCE_FAMILIES[value as AudienceAlias] ?? null;
}

/**
 * One fail-closed rule shared by quote and ask creation. The two inputs intentionally accept both
 * product vocabulary (`customer_invited` / `rateloop_network`) and request-profile vocabulary
 * (`private_invited` / `public_network`) so an alias cannot make the two consumers disagree.
 */
export function evaluateProductAudienceCreation(input: {
  audienceSource: unknown;
  policyReviewerSource: unknown;
  boundary: ProductAudienceCreationBoundary;
}): ProductAudienceCreationDecision {
  const audienceFamily = family(input.audienceSource);
  const policyFamily = family(input.policyReviewerSource);
  if (!audienceFamily || !policyFamily || audienceFamily !== policyFamily) {
    return {
      allowed: false,
      code: "network_opportunity_boundary_invalid",
      message: "The quote audience and its canonical policy do not identify one exact reviewer audience.",
    };
  }
  if (input.boundary.kind === "generic_product") {
    if (audienceFamily === "invited") return { allowed: true, family: "invited" };
    return {
      allowed: false,
      code: "network_opportunity_adapter_required",
      message:
        "RateLoop-network and hybrid work can be created only from an exact opportunity-bound benchmark adapter.",
    };
  }
  if (!OPPORTUNITY_ID.test(input.boundary.opportunityId) || audienceFamily !== "network") {
    return {
      allowed: false,
      code: "network_opportunity_boundary_invalid",
      message: "The opportunity-bound network adapter requires one exact network audience and opportunity.",
    };
  }
  return { allowed: true, family: "network" };
}

export const __productAudienceCreationBoundaryTestUtils = {
  aliases: AUDIENCE_FAMILIES,
  opportunityIdPattern: OPPORTUNITY_ID,
};
