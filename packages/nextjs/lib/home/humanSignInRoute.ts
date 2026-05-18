import { GOVERNANCE_ROUTE, RATE_ROUTE } from "../../constants/routes";

export const HUMAN_SIGN_IN_LABEL = "Sign In";
export const LANDING_HUMAN_CTA_LABEL = "For Humans";
export const HUMAN_SIGN_IN_FAUCET_ROUTE = RATE_ROUTE;
export const HUMAN_SIGN_IN_DISCOVER_ROUTE = RATE_ROUTE;
export const HUMAN_SIGN_IN_GET_LREP_ROUTE = GOVERNANCE_ROUTE;

export function getHumanSignInRoute(params?: { lrepBalance?: bigint | null }) {
  if (params?.lrepBalance === 0n) {
    return HUMAN_SIGN_IN_GET_LREP_ROUTE;
  }

  return HUMAN_SIGN_IN_DISCOVER_ROUTE;
}
