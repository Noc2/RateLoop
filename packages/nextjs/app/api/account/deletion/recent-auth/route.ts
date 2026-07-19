import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { issueAccountDeletionProof } from "~~/lib/auth/recentAccountActionProof";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const betterSession = await getBetterAuth().api.getSession({ headers: request.headers });
    if (!betterSession?.user?.id) {
      throw new TokenlessServiceError(
        "Sign in again before deleting this account.",
        401,
        "recent_authentication_required",
      );
    }
    const authenticatedAt = new Date(betterSession.session.createdAt);
    const authenticationMethod =
      typeof betterSession.session.authenticationMethod === "string"
        ? betterSession.session.authenticationMethod
        : null;
    const proof = await issueAccountDeletionProof({
      authenticatedAt,
      authenticationMethod,
      betterAuthUserId: betterSession.user.id,
      principalId: session.principalId,
    });
    return NextResponse.json({ expiresAt: proof.expiresAt.toISOString(), proof: proof.proof }, { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
