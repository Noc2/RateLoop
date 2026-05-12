const VERIFIED_AGENT_MULTIPLIER_BPS = 11_500;
const UNVERIFIED_AGENT_MULTIPLIER_BPS = 10_500;

export const BASE_RATER_MULTIPLIER_BPS = 10_000;
export const MAX_COMBINED_RATER_WEIGHT_BPS = 12_500;
export const OPEN_CHALLENGE_STATUS = 1;

const AI_RATER_TIERS = ["A0", "A1Unverified", "A1Verified"] as const;
const RATER_TYPES = ["Unknown", "Human", "AI", "Team", "Hybrid"] as const;
const CLUSTER_CHALLENGE_STATUSES = [
  "none",
  "open",
  "sustained",
  "rejected",
] as const;

export function aiTierName(tier: number | null | undefined) {
  return AI_RATER_TIERS[tier ?? 0] ?? "A0";
}

export function aiTierMultiplierBps(tier: number | null | undefined) {
  if (tier === 2) return VERIFIED_AGENT_MULTIPLIER_BPS;
  if (tier === 1) return UNVERIFIED_AGENT_MULTIPLIER_BPS;
  return BASE_RATER_MULTIPLIER_BPS;
}

export function clusterChallengeStatusName(status: number | null | undefined) {
  return CLUSTER_CHALLENGE_STATUSES[status ?? 0] ?? "none";
}

export function maxBigInt(values: Array<bigint | number | null | undefined>) {
  let max: bigint | null = null;
  for (const value of values) {
    if (value == null) continue;
    const next = typeof value === "bigint" ? value : BigInt(value);
    if (max === null || next > max) max = next;
  }
  return max;
}

export function raterTypeName(raterType: number | null | undefined) {
  return RATER_TYPES[raterType ?? 0] ?? "Unknown";
}

export function credentialStatus(
  credential:
    | {
        verified: boolean;
        revoked: boolean;
        expiresAt: bigint;
      }
    | undefined,
  nowSeconds: bigint,
) {
  if (!credential?.verified) return "missing";
  if (credential.revoked) return "revoked";
  if (credential.expiresAt !== 0n && credential.expiresAt <= nowSeconds) {
    return "expired";
  }
  return "verified";
}

export function probeStatus(
  declaration: { probePending: boolean } | undefined,
  latestProbe: { passed: boolean } | undefined,
) {
  if (!declaration) return "none";
  if (declaration.probePending) return "pending";
  if (!latestProbe) return "none";
  return latestProbe.passed ? "passed" : "failed";
}

export function declarationIsActive(
  declaration:
    | {
        retiredAt: bigint | null;
        effectiveEpoch: bigint;
        expiresAtEpoch: bigint;
      }
    | undefined,
  nowSeconds: bigint,
) {
  if (!declaration || declaration.retiredAt != null) return false;
  if (declaration.effectiveEpoch > nowSeconds) return false;
  return declaration.expiresAtEpoch === 0n || nowSeconds < declaration.expiresAtEpoch;
}

export function declarationInactiveReason(
  declaration:
    | {
        retiredAt: bigint | null;
        effectiveEpoch: bigint;
        expiresAtEpoch: bigint;
      }
    | undefined,
  nowSeconds: bigint,
  openChallengeCount: number,
) {
  if (!declaration) return "missing";
  if (declaration.retiredAt != null) return "retired";
  if (declaration.effectiveEpoch > nowSeconds) return "future";
  if (declaration.expiresAtEpoch !== 0n && nowSeconds >= declaration.expiresAtEpoch) {
    return "expired";
  }
  if (openChallengeCount > 0) return "challenged";
  return "none";
}

export function independenceMultiplierBps(discountBps: number | null | undefined) {
  const boundedDiscount = Math.min(Math.max(discountBps ?? 0, 0), BASE_RATER_MULTIPLIER_BPS);
  return BASE_RATER_MULTIPLIER_BPS - boundedDiscount;
}

export function computeRewardWeightBps(params: {
  clusterDiscountBps?: number | null;
  humanCredentialMultiplierBps?: number | null;
  agentTierMultiplierBps?: number | null;
}) {
  const discountBps = Math.min(Math.max(params.clusterDiscountBps ?? 0, 0), BASE_RATER_MULTIPLIER_BPS);
  const humanMultiplierBps = params.humanCredentialMultiplierBps ?? BASE_RATER_MULTIPLIER_BPS;
  const agentMultiplierBps = params.agentTierMultiplierBps ?? BASE_RATER_MULTIPLIER_BPS;

  let weightBps = BASE_RATER_MULTIPLIER_BPS - discountBps;
  weightBps = Math.floor((weightBps * humanMultiplierBps) / BASE_RATER_MULTIPLIER_BPS);
  weightBps = Math.floor((weightBps * agentMultiplierBps) / BASE_RATER_MULTIPLIER_BPS);

  return Math.min(weightBps, MAX_COMBINED_RATER_WEIGHT_BPS);
}
