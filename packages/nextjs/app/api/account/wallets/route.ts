import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listWalletBindings } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await requireBrowserSession(request);
  return NextResponse.json(
    { bindings: await listWalletBindings(session.principalId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
