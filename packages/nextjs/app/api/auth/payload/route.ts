import { NextRequest, NextResponse } from "next/server";
import { AuthError, assertAuthRequestOrigin } from "~~/lib/auth/session";
import { generateThirdwebLoginPayload } from "~~/lib/thirdweb/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAuthRequestOrigin(request.headers.get("origin"));
    const body = (await request.json()) as { address?: unknown; chainId?: unknown };
    if (typeof body.address !== "string" || typeof body.chainId !== "number") {
      throw new AuthError("Malformed authentication request.", 400);
    }
    const payload = await generateThirdwebLoginPayload({ address: body.address, chainId: body.chainId });
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 400;
    const message = error instanceof AuthError ? error.message : "Unable to create a RateLoop sign-in request.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
