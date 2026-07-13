const SHA256_REFERENCE = /^sha256:[0-9a-f]{64}$/u;
const LEGACY_HMAC_SHA256_REFERENCE = /^hmac-sha256:[0-9a-f]{64}$/u;
const VERSIONED_HMAC_SHA256_REFERENCE = /^hmac-sha256:[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[0-9a-f]{64}$/u;

export function isOpaqueSubjectReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (SHA256_REFERENCE.test(value) ||
      LEGACY_HMAC_SHA256_REFERENCE.test(value) ||
      VERSIONED_HMAC_SHA256_REFERENCE.test(value))
  );
}
