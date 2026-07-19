import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth, getBetterAuthConfiguration } from "~~/lib/auth/betterAuth";
import { removePrincipalPasskey } from "~~/lib/auth/passkeys";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function DELETE(request: NextRequest, context: { params: Promise<{ passkeyId: string }> }) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const betterSession = await getBetterAuth().api.getSession({ headers: request.headers });
    if (!betterSession?.user.id) {
      throw new TokenlessServiceError(
        "Verify your sign-in before changing passkeys.",
        401,
        "recent_authentication_required",
      );
    }
    const authenticatedAt = new Date(betterSession.session.createdAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(authenticatedAt) || authenticatedAt < now - 5 * 60_000 || authenticatedAt > now + 60_000) {
      throw new TokenlessServiceError(
        "Verify your sign-in again before changing passkeys.",
        401,
        "recent_authentication_required",
      );
    }
    const { passkeyId } = await context.params;
    const result = await removePrincipalPasskey({
      betterAuthUserId: betterSession.user.id,
      emailOtpEnabled: getBetterAuthConfiguration().emailOtpEnabled,
      passkeyId,
      principalId: session.principalId,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
