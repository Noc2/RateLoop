import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AuthError } from "~~/lib/auth/session";
import { createWalletBindingChallenge } from "~~/lib/auth/walletBindings";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as {
      address?: unknown;
      purpose?: unknown;
      source?: unknown;
      thirdwebJti?: unknown;
    };
    if (typeof body.address !== "string") throw new AuthError("A wallet address is required.", 400);
    const challenge = await createWalletBindingChallenge({
      address: body.address,
      principalId: session.principalId,
      purpose: body.purpose,
      source: body.source,
      thirdwebJti: body.thirdwebJti,
    });
    return NextResponse.json(
      { ...challenge, expiresAt: challenge.expiresAt.toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create the wallet proof." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
