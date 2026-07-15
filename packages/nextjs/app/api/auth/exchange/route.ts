import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, AuthError, assertAuthRequestOrigin, createAuthSession } from "~~/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthRequestOrigin(request.headers.get("origin"));
    const betterSession = await getBetterAuth().api.getSession({ headers: request.headers });
    if (!betterSession?.user?.id) throw new AuthError("Complete Better Auth sign-in before exchanging a session.", 401);
    const identity = await resolveBetterAuthPrincipal({
      betterAuthUserId: betterSession.user.id,
      displayName: betterSession.user.name,
    });
    const session = await createAuthSession(identity);
    const response = NextResponse.json({
      authenticated: true,
      principalId: identity.principalId,
      authProvider: identity.authProvider,
      displayName: identity.displayName,
      expiresAt: session.expiresAt.toISOString(),
    });
    response.cookies.set(AUTH_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    const message =
      error instanceof AuthError ? error.message : "Unable to establish the RateLoop application session.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
