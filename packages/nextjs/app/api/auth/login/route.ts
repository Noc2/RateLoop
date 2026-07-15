import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Wallet sign-in has been retired. Sign in with Better Auth, then add a wallet only when needed." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
