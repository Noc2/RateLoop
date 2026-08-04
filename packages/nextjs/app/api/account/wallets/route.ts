import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listWalletBindings } from "~~/lib/auth/walletBindings";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json({ bindings: await listWalletBindings(session.principalId) }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
