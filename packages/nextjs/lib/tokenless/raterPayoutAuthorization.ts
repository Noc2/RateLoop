import "server-only";
import { requireActiveWalletBinding } from "~~/lib/auth/walletBindings";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function requireRaterPayoutAddress(principalId: string) {
  try {
    return await requireActiveWalletBinding(principalId, "payout");
  } catch {
    throw new TokenlessServiceError(
      "Add and verify a payout wallet before using paid rater features.",
      409,
      "payout_wallet_required",
    );
  }
}
