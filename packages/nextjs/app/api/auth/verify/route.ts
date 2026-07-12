import { NextRequest, NextResponse } from "next/server";
import {
  BASE_ACCOUNT_SESSION_COOKIE,
  BaseAccountAuthError,
  assertBaseAccountRequestOrigin,
  createBaseAccountSession,
  verifyBaseAccountSiwe,
} from "~~/lib/base-account/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertBaseAccountRequestOrigin(request.headers.get("origin"));
    const body = (await request.json()) as { address?: unknown; message?: unknown; signature?: unknown };
    if (typeof body.address !== "string" || typeof body.message !== "string" || typeof body.signature !== "string") {
      throw new BaseAccountAuthError("Malformed authentication payload.", 400);
    }
    const address = await verifyBaseAccountSiwe({
      claimedAddress: body.address,
      message: body.message,
      signature: body.signature,
    });
    const session = await createBaseAccountSession(address);
    const response = NextResponse.json({ address });
    response.cookies.set(BASE_ACCOUNT_SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const status = error instanceof BaseAccountAuthError ? error.status : 400;
    const message = error instanceof BaseAccountAuthError ? error.message : "Unable to authenticate Base Account.";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
