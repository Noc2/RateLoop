import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth, getBetterAuthConfiguration } from "~~/lib/auth/betterAuth";
import { issuePasskeyAddProof } from "~~/lib/auth/passkeyActionProof";
import { assertPrincipalBetterAuthUser, listPrincipalPasskeys } from "~~/lib/auth/passkeys";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const result = await listPrincipalPasskeys(session.principalId, getBetterAuthConfiguration().emailOtpEnabled);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || body.action !== "passkey_add") {
      throw new TokenlessServiceError("Passkey action is invalid.", 400, "invalid_passkey_action");
    }
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
    await assertPrincipalBetterAuthUser(session.principalId, betterSession.user.id);
    const authenticationMethod =
      typeof betterSession.session.authenticationMethod === "string"
        ? betterSession.session.authenticationMethod
        : null;
    const proof = await issuePasskeyAddProof({
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
