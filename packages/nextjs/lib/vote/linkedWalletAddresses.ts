import { normalizeNonZeroComparableAddress } from "~~/lib/address/normalization";

export function normalizeLinkedWalletAddress(address?: string | null): string | null {
  return normalizeNonZeroComparableAddress(address);
}

export function buildLinkedWalletAddresses(...addresses: Array<string | null | undefined>): string[] {
  const values = new Set<string>();

  for (const address of addresses) {
    const normalized = normalizeLinkedWalletAddress(address);
    if (normalized) {
      values.add(normalized);
    }
  }

  return Array.from(values);
}
