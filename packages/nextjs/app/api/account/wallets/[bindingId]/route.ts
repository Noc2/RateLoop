import { NextRequest, NextResponse } from "next/server";
import { publicAuthRouteError } from "~~/lib/auth/publicRouteError";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeWalletBinding } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ bindingId: string }> }) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { bindingId } = await params;
    await revokeWalletBinding({ bindingId, principalId: session.principalId });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = publicAuthRouteError(error, {
      event: "wallet_binding_revoke_failed",
      fallbackMessage: "Unable to revoke this wallet binding.",
      fallbackStatus: 500,
    });
    return NextResponse.json(
      { error: failure.message },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
