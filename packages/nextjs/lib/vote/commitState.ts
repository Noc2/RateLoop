import { zeroHash } from "viem";

export function hasNonZeroCommit(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasNonZeroCommit);
  }

  return typeof value === "string" && value !== zeroHash;
}
