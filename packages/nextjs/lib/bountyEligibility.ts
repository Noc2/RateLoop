import {
  WORLD_CREDENTIAL_OPTIONS,
  WORLD_CREDENTIAL_PASSPORT,
  WORLD_CREDENTIAL_PROOF_OF_HUMAN,
  WORLD_CREDENTIAL_SELFIE,
  type WorldCredentialKind,
  getWorldCredentialOption,
  isWorldCredentialKind,
} from "~~/lib/world-id/credentials";

export const BOUNTY_ELIGIBILITY_OPEN = 0;
export const BOUNTY_ELIGIBILITY_SELFIE = WORLD_CREDENTIAL_SELFIE;
export const BOUNTY_ELIGIBILITY_PASSPORT = WORLD_CREDENTIAL_PASSPORT;
export const BOUNTY_ELIGIBILITY_VERIFIED_HUMAN = WORLD_CREDENTIAL_PROOF_OF_HUMAN;
export const BOUNTY_ELIGIBILITY_KIND_MASK = 0x7f;
export const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80;

export type BountyEligibilityBase = typeof BOUNTY_ELIGIBILITY_OPEN | WorldCredentialKind;

export const BOUNTY_ELIGIBILITY_BASE_OPTIONS: Array<{
  id: BountyEligibilityBase;
  label: string;
  mode: number;
}> = [
  { id: BOUNTY_ELIGIBILITY_OPEN, label: "Everyone", mode: BOUNTY_ELIGIBILITY_OPEN },
  ...WORLD_CREDENTIAL_OPTIONS.map(option => ({
    id: option.id,
    label: option.label,
    mode: option.id,
  })),
];

export function getBountyEligibilityBase(value: number): BountyEligibilityBase {
  const kind = value & BOUNTY_ELIGIBILITY_KIND_MASK;
  return isWorldCredentialKind(kind) ? kind : BOUNTY_ELIGIBILITY_OPEN;
}

export function bountyEligibilityRequiresRecentRecheck(value: number): boolean {
  return (value & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) !== 0 && getBountyEligibilityBase(value) !== 0;
}

export function buildBountyEligibility(base: BountyEligibilityBase, requireRecentRecheck: boolean): number {
  if (base === BOUNTY_ELIGIBILITY_OPEN) return BOUNTY_ELIGIBILITY_OPEN;
  return base | (requireRecentRecheck ? BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG : 0);
}

export function isSupportedBountyEligibility(value: number): boolean {
  const kind = value & BOUNTY_ELIGIBILITY_KIND_MASK;
  if (kind === BOUNTY_ELIGIBILITY_OPEN) {
    return (value & BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG) === 0;
  }
  return isWorldCredentialKind(kind);
}

export function getBountyEligibilityLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Mixed bounty scopes";

  const base = getBountyEligibilityBase(value);
  if (base === BOUNTY_ELIGIBILITY_OPEN) return "Everyone";

  const label = getWorldCredentialOption(base).shortLabel;
  return bountyEligibilityRequiresRecentRecheck(value) ? `${label} + recent recheck` : label;
}

export function getBountyEligibilityRequirement(value: number | null | undefined): {
  kind: WorldCredentialKind;
  requiresRecentRecheck: boolean;
} | null {
  if (value === null || value === undefined) return null;
  const base = getBountyEligibilityBase(value);
  if (base === BOUNTY_ELIGIBILITY_OPEN) return null;
  return {
    kind: base,
    requiresRecentRecheck: bountyEligibilityRequiresRecentRecheck(value),
  };
}
