import {
  type TokenlessEconomics,
  type TokenlessEconomicsAccountingStage,
  tokenlessEconomicsAccountingViolation,
} from "@rateloop/sdk";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

/**
 * Applies the SDK's canonical accounting invariant at the indexed-evidence
 * boundary while preserving the service's public error contract.
 */
export function assertTokenlessSettlementAccounting(
  economics: TokenlessEconomics,
  stage: TokenlessEconomicsAccountingStage,
) {
  const violation = tokenlessEconomicsAccountingViolation(economics, stage);
  if (!violation) return;
  throw new TokenlessServiceError(
    `Round evidence settlement accounting is invalid at ${violation.path}.`,
    400,
    "invalid_round_evidence",
  );
}
