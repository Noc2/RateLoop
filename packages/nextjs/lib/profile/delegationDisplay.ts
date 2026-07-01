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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function collectErrorText(value: unknown, seen = new Set<unknown>()): string[] {
  if (!isRecord(value) || seen.has(value)) return [];
  seen.add(value);

  const parts: string[] = [];
  for (const key of ["shortMessage", "message", "details", "name", "errorName"]) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) parts.push(item);
  }

  const metaMessages = value.metaMessages;
  if (Array.isArray(metaMessages)) {
    for (const item of metaMessages) {
      if (typeof item === "string" && item.trim()) parts.push(item);
    }
  }

  parts.push(...collectErrorText(value.data, seen));
  parts.push(...collectErrorText(value.cause, seen));
  return parts;
}

export function getSetDelegateErrorMessage({
  error,
  attemptedDelegate,
  existingDelegateAddress,
}: {
  error: unknown;
  attemptedDelegate?: string | null;
  existingDelegateAddress?: string | null;
}) {
  if (isDelegateAddressInputCurrent(attemptedDelegate ?? "", existingDelegateAddress ?? "")) {
    return "That address is already your current or pending delegate.";
  }

  const errorParts = collectErrorText(error);
  const errorText = errorParts.join("\n");
  if (errorText.includes("DelegateIsHolder")) {
    return "That address already has its own rater credential.";
  }
  if (errorText.includes("DelegateAlreadyAssigned")) {
    return "That address is already involved in a delegation. Use a different wallet or remove the existing delegation first.";
  }

  return errorParts[0] ?? "Failed to set delegate";
}
