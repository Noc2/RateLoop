import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { BASE_ACCOUNT_SESSION_COOKIE, findBaseAccountSession } from "~~/lib/base-account/auth";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const session = await findBaseAccountSession(cookieStore.get(BASE_ACCOUNT_SESSION_COOKIE)?.value);
  return NextResponse.json(
    session
      ? { authenticated: true, address: session.address, expiresAt: session.expiresAt }
      : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
