import { NextRequest, NextResponse } from "next/server";
import { publicAuthRouteError } from "~~/lib/auth/publicRouteError";
import { requireBrowserSession } from "~~/lib/auth/request";
import { AuthError } from "~~/lib/auth/session";
import { createWalletBindingChallenge } from "~~/lib/auth/walletBindings";
import { readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await readApiJsonRequestBody(request)) as {
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
    const failure = publicAuthRouteError(error, {
      event: "wallet_challenge_failed",
      fallbackMessage: "Unable to create the wallet proof.",
      fallbackStatus: 500,
    });
    return NextResponse.json(
      { error: failure.message },
      { status: failure.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
