import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  return NextResponse.json(
    session
      ? {
          authenticated: true,
          address: session.address,
          authProvider: session.authProvider,
          email: session.email,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
        }
      : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
