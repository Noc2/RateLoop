import { type LegacyClaimEntry, legacyClaimManifest } from "./manifest";
import { getAddress, isAddress } from "viem";

export type LegacyClaimLookupResult =
  | {
      status: "not_published";
      merkleRoot: null;
      allocationTotal: string;
      generatedAt: null;
    }
  | {
      status: "not_eligible";
      address: `0x${string}`;
      merkleRoot: `0x${string}`;
      allocationTotal: string;
      generatedAt: string | null;
    }
  | {
      status: "eligible";
      address: `0x${string}`;
      allocation: string;
      proof: `0x${string}`[];
      merkleRoot: `0x${string}`;
      allocationTotal: string;
      generatedAt: string | null;
    };

export function normalizeLegacyClaimAddress(address: string): `0x${string}` | null {
  return isAddress(address) ? (getAddress(address) as `0x${string}`) : null;
}

export function lookupLegacyClaim(address: string): LegacyClaimLookupResult | null {
  const normalizedAddress = normalizeLegacyClaimAddress(address);
  if (!normalizedAddress) return null;

  if (!legacyClaimManifest.merkleRoot) {
    return {
      status: "not_published",
      merkleRoot: null,
      allocationTotal: legacyClaimManifest.allocationTotal,
      generatedAt: null,
    };
  }

  const entry = legacyClaimManifest.entries.find(candidate => {
    return normalizeLegacyClaimAddress(candidate.address) === normalizedAddress;
  }) as LegacyClaimEntry | undefined;

  if (!entry) {
    return {
      status: "not_eligible",
      address: normalizedAddress,
      merkleRoot: legacyClaimManifest.merkleRoot,
      allocationTotal: legacyClaimManifest.allocationTotal,
      generatedAt: legacyClaimManifest.generatedAt,
    };
  }

  return {
    status: "eligible",
    address: normalizedAddress,
    allocation: entry.allocation,
    proof: entry.proof,
    merkleRoot: legacyClaimManifest.merkleRoot,
    allocationTotal: legacyClaimManifest.allocationTotal,
    generatedAt: legacyClaimManifest.generatedAt,
  };
}
