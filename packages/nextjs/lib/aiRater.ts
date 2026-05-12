import { keccak256, parseUnits, stringToHex, zeroHash } from "viem";

export const AI_RATER_DECLARATION_DOMAIN = {
  name: "RateLoop Rater Declaration",
  version: "1",
} as const;

export const AI_RATER_DECLARATION_TYPES = {
  RaterDeclaration: [
    { name: "rater", type: "address" },
    { name: "operator", type: "address" },
    { name: "modelClass", type: "uint8" },
    { name: "modelId", type: "bytes32" },
    { name: "provider", type: "bytes32" },
    { name: "endpointHint", type: "bytes32" },
    { name: "promptTemplateHash", type: "bytes32" },
    { name: "retrievalConfigHash", type: "bytes32" },
    { name: "toolingHash", type: "bytes32" },
    { name: "version", type: "uint32" },
    { name: "effectiveEpoch", type: "uint64" },
    { name: "expiresAtEpoch", type: "uint64" },
    { name: "disclosure", type: "uint8" },
    { name: "nonce", type: "uint96" },
  ],
} as const;

export const AI_RATER_MODEL_CLASS_OPTIONS = [
  { label: "Closed API", value: 0 },
  { label: "Open weight", value: 1 },
  { label: "Fine-tuned", value: 2 },
  { label: "Ensemble", value: 3 },
  { label: "Other", value: 4 },
] as const;

export const AI_RATER_DISCLOSURE_DEFAULT = 1;
export const LREP_DECIMALS = 6;

export function hashAiRaterField(value: string) {
  const normalized = value.trim();
  return normalized ? keccak256(stringToHex(normalized)) : zeroHash;
}

export function buildAiChallengeEvidenceHash(input: { summary: string; sourceUrl?: string; details?: string }) {
  const normalized = JSON.stringify({
    summary: input.summary.trim(),
    sourceUrl: input.sourceUrl?.trim() ?? "",
    details: input.details?.trim() ?? "",
  });
  return keccak256(stringToHex(normalized));
}

export function parseLrepInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return 0n;
  return parseUnits(normalized, LREP_DECIMALS);
}

export function formatLrepAmount(value: bigint | number | string | null | undefined, maximumFractionDigits = 2) {
  if (value === null || value === undefined) return "--";

  const numeric = typeof value === "bigint" ? Number(value) / 1e6 : Number(value) / 1e6;
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

export function formatAiRaterTierName(tier: number | null | undefined) {
  if (tier === 2) return "A1 Verified";
  if (tier === 1) return "A1 Unverified";
  return "A0";
}

export function formatAiChallengeStatus(status: number | null | undefined) {
  if (status === 1) return "Open";
  if (status === 2) return "Sustained";
  if (status === 3) return "Rejected";
  if (status === 4) return "Expired";
  return "Unknown";
}

export function formatAiProbeStatus(passed: boolean) {
  return passed ? "Passed" : "Failed";
}

export function formatUnixTimestamp(timestamp: bigint | number | string | null | undefined) {
  if (timestamp === null || timestamp === undefined) return "—";
  const numeric = typeof timestamp === "bigint" ? Number(timestamp) : Number(timestamp);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";

  return new Date(numeric * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function truncateHash(value: string | null | undefined, prefix = 10, suffix = 6) {
  if (!value) return "—";
  if (value.length <= prefix + suffix) return value;
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

export function computeBondReleaseAt(input: {
  expiresAtEpoch?: bigint | number | string | null;
  inactiveReason?: string | null;
  retiredAt?: bigint | number | string | null;
  retiredBondLockSeconds?: bigint | number | string | null;
}) {
  const lockSeconds =
    input.retiredBondLockSeconds === null || input.retiredBondLockSeconds === undefined
      ? 0n
      : BigInt(input.retiredBondLockSeconds);

  if (lockSeconds === 0n) return null;

  if (input.inactiveReason === "retired" && input.retiredAt) {
    return BigInt(input.retiredAt) + lockSeconds;
  }

  if (input.inactiveReason === "expired" && input.expiresAtEpoch) {
    return BigInt(input.expiresAtEpoch) + lockSeconds;
  }

  return null;
}

export function computeChallengeExpiresAt(
  openedAt: bigint | number | string,
  resolutionWindow: bigint | number | string,
) {
  return BigInt(openedAt) + BigInt(resolutionWindow);
}
