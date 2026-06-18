export function parsePositiveIntegerChainId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) {
    return null;
  }

  const chainId = Number(normalized);
  return Number.isSafeInteger(chainId) ? chainId : null;
}
