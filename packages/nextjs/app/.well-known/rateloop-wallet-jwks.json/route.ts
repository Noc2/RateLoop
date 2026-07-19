import { NextResponse } from "next/server";
import { AuthError } from "~~/lib/auth/session";
import { thirdwebWalletJwks } from "~~/lib/auth/thirdwebWalletJwt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await thirdwebWalletJwks(), {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "The optional wallet issuer is unavailable." },
      { status: error instanceof AuthError ? error.status : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
