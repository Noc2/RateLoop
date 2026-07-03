const UNSIGNED_DECIMAL_PATTERN = /^[0-9]+$/;

export type OptionalPositiveTtlMsResult = { ok: true; ttlMs?: number } | { ok: false; message: string };

export function parseOptionalPositiveTtlMs(value: unknown, fieldName = "ttlMs"): OptionalPositiveTtlMsResult {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized === "") return { ok: true };
    if (!UNSIGNED_DECIMAL_PATTERN.test(normalized)) {
      return { ok: false, message: `${fieldName} must be a positive integer.` };
    }
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? { ok: true, ttlMs: parsed }
      : { ok: false, message: `${fieldName} must be a positive integer.` };
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return { ok: true, ttlMs: value };
  }
  return { ok: false, message: `${fieldName} must be a positive integer.` };
}
