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

/**
 * Response-window bounds, centralised for the same reason as the panel bounds:
 * the literals were restated in eleven production modules, so the wizard, the
 * policy editors, the stored-row readers, the agent API and the on-chain quote
 * path each carried their own copy of the same number.
 *
 * The ceiling is thirty days rather than the previous twenty-four hours. A named
 * internal reviewer works business hours, so a one-day maximum could not survive
 * a weekend, a public holiday or any planned absence — and a deadline that
 * elapses without full quorum is forced `inconclusive` with no substitution, so
 * the old ceiling turned an ordinary Friday afternoon into a failed review.
 *
 * Thirty days stays well inside the contract's `MAX_REVEAL_HORIZON` of 90 days,
 * so the paid on-chain path accepts the same range.
 *
 * The floor stays at twenty minutes for agent workflows that genuinely need a
 * fast answer. Nothing here makes the window business-hours or holiday aware;
 * that needs a calendar and is deliberately out of scope for a constant.
 */
export const MINIMUM_REVIEW_RESPONSE_WINDOW_SECONDS = 1_200;
export const MAXIMUM_REVIEW_RESPONSE_WINDOW_SECONDS = 2_592_000;

/**
 * Three days, so a review dispatched on Friday is still open on Monday. The
 * previous default of one hour was only reachable by a reviewer already sitting
 * in the product, and it raced the notification pipeline that delivers the work.
 */
export const DEFAULT_REVIEW_RESPONSE_WINDOW_SECONDS = 259_200;
