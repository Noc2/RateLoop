/**
 * Panel-size bounds. The service enforces these when a review request profile is
 * saved, so every other layer — setup wizard, policy editors, readiness checks
 * and the published SDK schema — has to state the same numbers. Import them;
 * never restate the literals.
 *
 * This module stays free of server-only imports so client components can share it.
 */
export const MINIMUM_REVIEW_PANEL_SIZE = 2;
export const MAXIMUM_REVIEW_PANEL_SIZE = 100;

/** Public-network and hybrid panels need a third reviewer to break a tie. */
export const MINIMUM_PUBLIC_REVIEW_PANEL_SIZE = 3;

export function minimumReviewPanelSizeForAudience(audience: string) {
  return audience === "private_invited" ? MINIMUM_REVIEW_PANEL_SIZE : MINIMUM_PUBLIC_REVIEW_PANEL_SIZE;
}
