const UNSIGNED_DECIMAL_PATTERN = /^[0-9]+$/;

export function isBlankQueryNumber(value: string | null | undefined) {
  return value == null || value.trim() === "";
}

export function parseStrictUnsignedQueryNumber(value: string | null | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (!UNSIGNED_DECIMAL_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseStrictPositiveQueryNumber(value: string | null | undefined): number | null {
  const parsed = parseStrictUnsignedQueryNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
