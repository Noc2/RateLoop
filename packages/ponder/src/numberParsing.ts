const DECIMAL_UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/** Strictly parse an unsigned base-10 integer that fits safely in a JavaScript number. */
export function parseStrictUnsignedInteger(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !DECIMAL_UNSIGNED_INTEGER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Strictly parse an unsigned base-10 integer into a BigInt. */
export function parseStrictUnsignedBigInt(value: string | undefined): bigint | null {
  if (!value || !DECIMAL_UNSIGNED_INTEGER_PATTERN.test(value)) return null;
  return BigInt(value);
}

/** Strictly parse a positive base-10 integer into a BigInt. */
export function parseStrictPositiveBigInt(value: string | undefined): bigint | null {
  const parsed = parseStrictUnsignedBigInt(value);
  return parsed !== null && parsed > 0n ? parsed : null;
}
