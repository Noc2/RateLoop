export type LegacyClaimEntry = {
  address: `0x${string}`;
  allocation: string;
  proof: `0x${string}`[];
};

export type LegacyClaimManifest = {
  merkleRoot: `0x${string}` | null;
  allocationTotal: string;
  generatedAt: string | null;
  entries: readonly LegacyClaimEntry[];
};

export const legacyClaimManifest: LegacyClaimManifest = {
  merkleRoot: null,
  allocationTotal: "0",
  generatedAt: null,
  entries: [],
};
