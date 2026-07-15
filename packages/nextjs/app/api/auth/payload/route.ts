import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Wallet sign-in has been retired. Wallets are optional, purpose-bound payment instruments." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
