import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { assertEnterpriseSignInAllowed } from "~~/lib/auth/enterpriseIdentityPolicy";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, AuthError, assertAuthRequestOrigin, createAuthSession } from "~~/lib/auth/session";
import { appendSecurityAuditEvent, appendSecurityAuditEventOrReportFailure } from "~~/lib/privacy/audit";

export const runtime = "nodejs";

/**
 * Refused before anything is written.
 *
 * Both of these are reachable without credentials, and every audit append takes
 * `FOR UPDATE` on the single head row for ("system", "authentication") — so an
 * anonymous caller could make each request serialise on one lock and add a row
 * to a table that has no bound. Neither carries a signal worth that: a request
 * with the wrong Origin or no Better Auth session is an unauthenticated request,
 * which nothing else in this application audits either.
 *
 * Everything after this point requires a valid Better Auth session, so the
 * denials that remain are attributable and worth recording.
 */
function unauthenticatedRefusal(request: NextRequest) {
  try {
    assertAuthRequestOrigin(request.headers.get("origin"));
  } catch (error) {
    return error instanceof AuthError ? error : new AuthError("The request origin is not allowed.", 403);
  }
  return null;
}

export async function POST(request: NextRequest) {
  const refusal = unauthenticatedRefusal(request);
  if (refusal) {
    return NextResponse.json(
      { error: refusal.message },
      { status: refusal.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const betterSession = await getBetterAuth().api.getSession({ headers: request.headers });
    if (!betterSession?.user?.id) {
      return NextResponse.json(
        { error: "Complete Better Auth sign-in before exchanging a session." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const authenticationMethod =
      typeof betterSession.session.authenticationMethod === "string"
        ? betterSession.session.authenticationMethod
        : null;
    await assertEnterpriseSignInAllowed(betterSession.user.email, authenticationMethod);
    const principalMethod = authenticationMethod?.startsWith("sso:")
      ? "sso"
      : authenticationMethod?.startsWith("social:")
        ? authenticationMethod.slice("social:".length)
        : (authenticationMethod ?? undefined);
    const identity = await resolveBetterAuthPrincipal({
      betterAuthUserId: betterSession.user.id,
      displayName: betterSession.user.name,
      method: principalMethod,
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
    await appendSecurityAuditEventOrReportFailure({
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
    });
    const status = error instanceof AuthError ? error.status : 503;
    const message =
      error instanceof AuthError ? error.message : "Unable to establish the RateLoop application session.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
