import { parseStrictPositiveQueryNumber } from "./http/queryNumbers";

export function parsePositiveIntegerChainId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  return parseStrictPositiveQueryNumber(value);
}
