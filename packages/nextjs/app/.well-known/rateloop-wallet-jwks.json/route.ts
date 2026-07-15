import { NextResponse } from "next/server";
import { AuthError } from "~~/lib/auth/session";
import { thirdwebWalletJwks } from "~~/lib/auth/thirdwebWalletJwt";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(thirdwebWalletJwks(), {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=300" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof AuthError ? error.message : "Wallet JWKS is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
