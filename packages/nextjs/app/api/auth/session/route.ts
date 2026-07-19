import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { getWalletBindingAddresses } from "~~/lib/auth/walletBindings";
import { getAccountProfile } from "~~/lib/tokenless/accountProfile";

export const runtime = "nodejs";

export async function GET() {
  const cookieStore = await cookies();
  const session = await findAuthSession(cookieStore.get(AUTH_SESSION_COOKIE)?.value);
  const [wallets, profile] = session
    ? await Promise.all([
        getWalletBindingAddresses(session.principalId),
        getAccountProfile({ principalAddress: session.principalId, providerDisplayName: session.displayName }),
      ])
    : [null, null];
  return NextResponse.json(
    session
      ? {
          authenticated: true,
          principalId: session.principalId,
          authProvider: session.authProvider,
          displayName: profile?.displayName ?? null,
          expiresAt: session.expiresAt,
          wallets,
        }
      : { authenticated: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
