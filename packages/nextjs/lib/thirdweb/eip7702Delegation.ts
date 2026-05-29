import type { Hex } from "viem";

export function getEip7702DelegationTarget(code: Hex | undefined | null): `0x${string}` | null {
  const normalizedCode = code?.toLowerCase();
  if (!normalizedCode?.startsWith("0xef0100") || normalizedCode.length !== 48) {
    return null;
  }

  return `0x${normalizedCode.slice(8)}` as `0x${string}`;
}

export function hasMissingEip7702DelegationImplementation(params: {
  implementationCode?: Hex | null;
  walletCode?: Hex | null;
}) {
  return Boolean(
    getEip7702DelegationTarget(params.walletCode) && (!params.implementationCode || params.implementationCode === "0x"),
  );
}
