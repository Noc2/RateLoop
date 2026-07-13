import { NextRequest, NextResponse } from "next/server";
import type { VerifyLoginPayloadParams } from "thirdweb/auth";
import { AUTH_SESSION_COOKIE, AuthError, assertAuthRequestOrigin, createAuthSession } from "~~/lib/auth/session";
import { verifyThirdwebLogin } from "~~/lib/thirdweb/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthRequestOrigin(request.headers.get("origin"));
    const body = (await request.json()) as VerifyLoginPayloadParams;
    if (!body?.payload || typeof body.signature !== "string")
      throw new AuthError("Malformed authentication payload.", 400);
    const identity = await verifyThirdwebLogin(body);
    const session = await createAuthSession(identity);
    const response = NextResponse.json({
      authenticated: true,
      address: identity.address,
      authProvider: identity.authProvider,
      email: identity.email,
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
    const status = error instanceof AuthError ? error.status : 400;
    const message = error instanceof AuthError ? error.message : "Unable to authenticate this RateLoop account.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
