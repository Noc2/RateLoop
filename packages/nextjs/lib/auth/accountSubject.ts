import { getAddress } from "viem";

const PRINCIPAL_ID_PATTERN = /^rlp_[a-zA-Z0-9_-]{20,80}$/;

export function isRateLoopPrincipalId(value: string) {
  return PRINCIPAL_ID_PATTERN.test(value);
}

export function normalizeAccountSubject(value: string) {
  const candidate = value.trim();
  if (isRateLoopPrincipalId(candidate)) return candidate;
  return getAddress(candidate).toLowerCase();
}
