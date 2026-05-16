import type { evaluateFreeTransactionAllowance } from "./freeTransactions";
import type { getThirdwebClientId, getThirdwebServerVerifierSecret } from "~~/lib/env/server";

export type ThirdwebVerifierRouteTestOverrides = {
  evaluateFreeTransactionAllowance?: typeof evaluateFreeTransactionAllowance;
  getThirdwebClientId?: typeof getThirdwebClientId;
  getThirdwebServerVerifierSecret?: typeof getThirdwebServerVerifierSecret;
};

let thirdwebVerifierRouteTestOverrides: ThirdwebVerifierRouteTestOverrides | null = null;

export function setThirdwebVerifierRouteTestOverrides(overrides: ThirdwebVerifierRouteTestOverrides | null) {
  thirdwebVerifierRouteTestOverrides = overrides;
}

export function getThirdwebVerifierRouteTestOverrides(): ThirdwebVerifierRouteTestOverrides | null {
  return thirdwebVerifierRouteTestOverrides;
}
