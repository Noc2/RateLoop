const DECIMAL_UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/** Strictly parse an unsigned base-10 integer that fits safely in a JavaScript number. */
export function parseStrictUnsignedInteger(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !DECIMAL_UNSIGNED_INTEGER_PATTERN.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
