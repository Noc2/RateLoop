import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AuthError } from "~~/lib/auth/session";
import { revokeWalletBinding } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ bindingId: string }> }) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { bindingId } = await params;
    await revokeWalletBinding({ bindingId, principalId: session.principalId });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to revoke this wallet binding." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
