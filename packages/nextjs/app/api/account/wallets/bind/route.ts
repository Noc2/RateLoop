import { NextRequest, NextResponse } from "next/server";
import { publicAuthRouteError } from "~~/lib/auth/publicRouteError";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AuthError } from "~~/lib/auth/session";
import { completeWalletBinding } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { challengeId?: unknown; message?: unknown; signature?: unknown };
    if (
      typeof body.challengeId !== "string" ||
      typeof body.message !== "string" ||
      typeof body.signature !== "string"
    ) {
      throw new AuthError("A complete wallet proof is required.", 400);
    }
    const binding = await completeWalletBinding({
      challengeId: body.challengeId,
      message: body.message,
      principalId: session.principalId,
      signature: body.signature,
    });
    return NextResponse.json(binding, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = publicAuthRouteError(error, {
      event: "wallet_binding_failed",
      fallbackMessage: "Unable to bind this wallet.",
      fallbackStatus: 500,
    });
    return NextResponse.json(
      { error: failure.message },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
