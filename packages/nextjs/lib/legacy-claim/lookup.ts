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
  // CLAIM-1 follow-up: `isAddress(value)` defaults to `strict: true`, which rejects all-uppercase
  // input (and other non-EIP-55 casings). Users pasting their address from a wallet UI that
  // emits uppercase shouldn't be rejected; `getAddress` will canonicalize. Use `strict: false`
  // so any 40-hex casing is accepted, then re-checksum to the canonical form.
  return isAddress(address, { strict: false }) ? (getAddress(address) as `0x${string}`) : null;
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
