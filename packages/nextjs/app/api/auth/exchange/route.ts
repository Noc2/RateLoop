import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, AuthError, assertAuthRequestOrigin, createAuthSession } from "~~/lib/auth/session";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";

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
    await appendSecurityAuditEvent({
      action: "auth.login",
      actorKind: "principal",
      actorReference: identity.principalId,
      assuranceMethod: identity.authProvider,
      purpose: "account_access",
      reason: "better_auth_session_exchanged",
      requestCorrelation: request.headers.get("x-request-id"),
      result: "success",
      scopeId: identity.principalId,
      scopeKind: "identity",
      targetId: identity.principalId,
      targetKind: "principal",
    });
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
    await appendSecurityAuditEvent({
      action: "auth.session_exchange_failed",
      actorKind: "system",
      actorReference: "anonymous",
      assuranceMethod: "better_auth",
      purpose: "account_access",
      reason: error instanceof AuthError ? "session_exchange_denied" : "session_exchange_failed",
      requestCorrelation: request.headers.get("x-request-id"),
      result: error instanceof AuthError ? "denied" : "failure",
      scopeId: "authentication",
      scopeKind: "system",
      targetId: "rateloop_session",
      targetKind: "application_session",
    }).catch(() => undefined);
    const status = error instanceof AuthError ? error.status : 503;
    const message =
      error instanceof AuthError ? error.message : "Unable to establish the RateLoop application session.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
