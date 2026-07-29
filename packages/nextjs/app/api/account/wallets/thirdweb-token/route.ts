import { NextRequest, NextResponse } from "next/server";
import { publicAuthRouteError } from "~~/lib/auth/publicRouteError";
import { requireBrowserSession } from "~~/lib/auth/request";
import { issueThirdwebWalletJwt } from "~~/lib/auth/thirdwebWalletJwt";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const issued = await issueThirdwebWalletJwt(session.principalId);
    return NextResponse.json(
      { jwt: issued.jwt, jti: issued.jti, expiresAt: issued.expiresAt.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const failure = publicAuthRouteError(error, {
      event: "thirdweb_wallet_exchange_failed",
      fallbackMessage: "Unable to create the optional wallet exchange.",
      fallbackStatus: 503,
    });
    return NextResponse.json(
      { error: failure.message },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
