import { NextRequest, NextResponse } from "next/server";
import { getBetterAuth } from "~~/lib/auth/betterAuth";
import { AUTH_SESSION_COOKIE, AuthError, assertAuthRequestOrigin, revokeAuthSession } from "~~/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthRequestOrigin(request.headers.get("origin"));
    await revokeAuthSession(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    try {
      const betterAuthResponse = await getBetterAuth().api.signOut({ headers: request.headers, asResponse: true });
      for (const cookie of betterAuthResponse.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
    } catch {
      // The RateLoop session is still revoked when an optional provider cleanup is unavailable.
    }
    response.cookies.delete(AUTH_SESSION_COOKIE);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json({ error: "Unable to sign out." }, { status });
  }
}
