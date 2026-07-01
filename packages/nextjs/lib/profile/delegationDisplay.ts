import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

export function normalizeExistingDelegateAddress(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase() === ZERO_ADDRESS.toLowerCase() ? "" : trimmed;
}

export function getDelegateAddressInputValue({
  delegateTo,
  pendingDelegateTo,
}: {
  delegateTo?: string | null;
  pendingDelegateTo?: string | null;
}) {
  return normalizeExistingDelegateAddress(pendingDelegateTo) || normalizeExistingDelegateAddress(delegateTo);
}

export function isDelegateAddressInputCurrent(value: string, currentDelegateAddress: string) {
  const normalizedValue = normalizeExistingDelegateAddress(value).toLowerCase();
  const normalizedCurrent = normalizeExistingDelegateAddress(currentDelegateAddress).toLowerCase();
  return Boolean(normalizedValue && normalizedCurrent && normalizedValue === normalizedCurrent);
}
