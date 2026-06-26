import type { Address } from "viem";
import { isAddress } from "viem";
import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

export function normalizeComparableAddress(value?: string | null): string | null {
  return value?.toLowerCase() ?? null;
}

export function addressesMatch(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = normalizeComparableAddress(left);
  const normalizedRight = normalizeComparableAddress(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function normalizeNonZeroComparableAddress(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const normalized = trimmed.toLowerCase();
  return normalized === ZERO_ADDRESS.toLowerCase() ? null : normalized;
}

export function toStrictAddress(value?: string | null): Address | null {
  return isAddress(value ?? "") ? (value as Address) : null;
}
