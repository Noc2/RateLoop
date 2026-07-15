import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { getWalletBindingAddresses } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  const wallets = session ? await getWalletBindingAddresses(session.principalId) : null;
  return NextResponse.json(
    session
      ? {
          authenticated: true,
          principalId: session.principalId,
          authProvider: session.authProvider,
          displayName: session.displayName,
          expiresAt: session.expiresAt,
          wallets,
        }
      : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
