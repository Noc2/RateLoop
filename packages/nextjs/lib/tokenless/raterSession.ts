import { type NextRequest } from "next/server";
import "server-only";
import { AUTH_SESSION_COOKIE, findAuthSession, getAuthOrigin } from "~~/lib/auth/session";
import { requireActiveWalletBinding } from "~~/lib/auth/walletBindings";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export async function requireRaterSession(request: NextRequest, requireSameOrigin: boolean) {
  if (requireSameOrigin) {
    const origin = request.headers.get("origin");
    let valid = false;
    try {
      valid = Boolean(origin && new URL(origin).origin === getAuthOrigin());
    } catch {
      valid = false;
    }
    if (!valid) throw new TokenlessServiceError("Cross-origin rater request denied.", 403, "cross_origin_denied");
  }
  const session = await findAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  if (!session) throw new TokenlessServiceError("Sign in to RateLoop first.", 401, "authentication_required");
  try {
    return { ...session, payoutAddress: await requireActiveWalletBinding(session.principalId, "payout") };
  } catch {
    throw new TokenlessServiceError(
      "Add and verify a payout wallet before using paid rater features.",
      409,
      "payout_wallet_required",
    );
  }
}
