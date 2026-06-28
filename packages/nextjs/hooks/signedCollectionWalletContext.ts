export type SignedCollectionWalletContextResult = { ok: true } | { ok: false; reason: "wallet_changed" };

export function assertSignedCollectionWalletContext(
  snapshottedAddress: string,
  currentAddress?: string,
): SignedCollectionWalletContextResult {
  if (!currentAddress || currentAddress.toLowerCase() !== snapshottedAddress.toLowerCase()) {
    return { ok: false, reason: "wallet_changed" };
  }

  return { ok: true };
}
