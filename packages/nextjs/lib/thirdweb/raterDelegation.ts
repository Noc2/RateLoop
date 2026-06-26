import { normalizeComparableAddress, toStrictAddress } from "~~/lib/address/normalization";
import { isThirdwebInAppWalletCurrentForAddress } from "~~/services/thirdweb/client";

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
  const delegateAddress = toStrictAddress(params.connectedAddress);
  const holderAddress = toStrictAddress(params.adminAddress);

  if (!isCurrentInAppWallet || !connectedAddress || !adminAddress || connectedAddress === adminAddress) {
    return null;
  }

  if (!delegateAddress || !holderAddress) {
    return null;
  }

  return {
    delegateAddress,
    holderAddress,
  };
}
