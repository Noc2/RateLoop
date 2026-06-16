import { BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG } from "@rateloop/contracts/protocol";
import {
  WORLD_CREDENTIAL_BOUNTY_OPTIONS,
  WORLD_CREDENTIAL_PROOF_OF_HUMAN,
  type WorldCredentialKind,
  getWorldCredentialOption,
  isWorldCredentialKind,
} from "~~/lib/world-id/credentials";

export { BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG };

export const BOUNTY_ELIGIBILITY_OPEN = 0;
export const BOUNTY_ELIGIBILITY_VERIFIED_HUMAN = 1 << WORLD_CREDENTIAL_PROOF_OF_HUMAN;
const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = BOUNTY_ELIGIBILITY_VERIFIED_HUMAN;
const BOUNTY_ELIGIBILITY_KINDS: WorldCredentialKind[] = [WORLD_CREDENTIAL_PROOF_OF_HUMAN];

export const BOUNTY_ELIGIBILITY_CREDENTIAL_OPTIONS: Array<{
  bit: number;
  kind: WorldCredentialKind;
  label: string;
}> = WORLD_CREDENTIAL_BOUNTY_OPTIONS.map(option => ({
  bit: getBountyEligibilityBitForKind(option.id),
  kind: option.id,
  label: option.label,
}));

export function getBountyEligibilityBitForKind(kind: WorldCredentialKind): number {
  return 1 << kind;
}

export function getBountyEligibilityCredentialMask(value: number): number {
  return value & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
}

export function getBountyEligibilityKinds(value: number): WorldCredentialKind[] {
  const credentialMask = getBountyEligibilityCredentialMask(value);
  return BOUNTY_ELIGIBILITY_KINDS.filter(kind => {
    return (credentialMask & getBountyEligibilityBitForKind(kind)) !== 0;
  });
}

function bountyEligibilityRequiresRecentRecheck(value: number): boolean {
  void value;
  return false;
}

export function buildBountyEligibility(credentialMask: number, requireRecentRecheck: boolean): number {
  void requireRecentRecheck;
  const supportedMask = credentialMask & BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
  if (supportedMask === BOUNTY_ELIGIBILITY_OPEN) return BOUNTY_ELIGIBILITY_OPEN;
  return supportedMask;
}

export function isSupportedBountyEligibility(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) return false;

  const unsupportedBits = value & ~BOUNTY_ELIGIBILITY_CREDENTIAL_MASK;
  if (unsupportedBits !== 0) return false;

  const credentialMask = getBountyEligibilityCredentialMask(value);
  if (credentialMask === BOUNTY_ELIGIBILITY_OPEN) return value === BOUNTY_ELIGIBILITY_OPEN;
  return getBountyEligibilityKinds(value).every(isWorldCredentialKind);
}

export function getBountyEligibilityLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Mixed bounty scopes";

  const kinds = getBountyEligibilityKinds(value);
  if (kinds.length === 0) return "Everyone";

  const label = kinds.map(kind => getWorldCredentialOption(kind).shortLabel).join(" or ");
  return bountyEligibilityRequiresRecentRecheck(value) ? `${label} + recent recheck` : label;
}

export function getBountyEligibilityRequirement(value: number | null | undefined): {
  credentialMask: number;
  kinds: WorldCredentialKind[];
  requiresRecentRecheck: boolean;
} | null {
  if (value === null || value === undefined) return null;
  const credentialMask = getBountyEligibilityCredentialMask(value);
  if (credentialMask === BOUNTY_ELIGIBILITY_OPEN) return null;
  return {
    credentialMask,
    kinds: getBountyEligibilityKinds(value),
    requiresRecentRecheck: bountyEligibilityRequiresRecentRecheck(value),
  };
}
