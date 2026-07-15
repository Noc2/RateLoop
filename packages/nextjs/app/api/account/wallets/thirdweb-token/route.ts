import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AuthError } from "~~/lib/auth/session";
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
    const status = error instanceof AuthError ? error.status : 503;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the optional wallet exchange." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
