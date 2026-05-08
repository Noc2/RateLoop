import { RATE_ROUTE } from "../../constants/routes";

export const HUMAN_SIGN_IN_LABEL = "Start Rating";
export const HUMAN_SIGN_IN_FAUCET_ROUTE = RATE_ROUTE;
export const HUMAN_SIGN_IN_DISCOVER_ROUTE = RATE_ROUTE;

export function getHumanSignInRoute() {
  return HUMAN_SIGN_IN_DISCOVER_ROUTE;
}
