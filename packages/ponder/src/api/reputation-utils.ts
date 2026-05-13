export const BASE_RATER_MULTIPLIER_BPS = 10_000;
const RATER_TYPES = ["Unknown", "Human", "AI", "Team", "Hybrid"] as const;

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
