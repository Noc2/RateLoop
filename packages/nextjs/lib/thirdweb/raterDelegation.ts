import type { Address } from "viem";
import { isAddress } from "viem";
import { isThirdwebInAppWalletCurrentForAddress } from "~~/services/thirdweb/client";

function normalizeComparableAddress(address: string | null | undefined) {
  return address?.toLowerCase() ?? null;
}

export function getThirdwebRaterDelegationCandidate(params: {
  activeWalletId?: string | null;
  adminAddress?: string | null;
  connectedAddress?: string | null;
  thirdwebAccountAddress?: string | null;
}) {
  const isCurrentInAppWallet = isThirdwebInAppWalletCurrentForAddress({
    activeWalletId: params.activeWalletId,
    connectedAddress: params.connectedAddress,
    thirdwebAccountAddress: params.thirdwebAccountAddress,
    thirdwebAdminAddress: params.adminAddress,
  });
  const connectedAddress = normalizeComparableAddress(params.connectedAddress);
  const adminAddress = normalizeComparableAddress(params.adminAddress);

  if (!isCurrentInAppWallet || !connectedAddress || !adminAddress || connectedAddress === adminAddress) {
    return null;
  }

  if (!isAddress(params.connectedAddress ?? "") || !isAddress(params.adminAddress ?? "")) {
    return null;
  }

  return {
    delegateAddress: params.connectedAddress as Address,
    holderAddress: params.adminAddress as Address,
  };
}
