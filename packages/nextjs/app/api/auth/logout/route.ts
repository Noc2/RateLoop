import { NextRequest, NextResponse } from "next/server";
import {
  BASE_ACCOUNT_SESSION_COOKIE,
  BaseAccountAuthError,
  assertBaseAccountRequestOrigin,
  revokeBaseAccountSession,
} from "~~/lib/base-account/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertBaseAccountRequestOrigin(request.headers.get("origin"));
    await revokeBaseAccountSession(request.cookies.get(BASE_ACCOUNT_SESSION_COOKIE)?.value);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(BASE_ACCOUNT_SESSION_COOKIE);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const status = error instanceof BaseAccountAuthError ? error.status : 400;
    return NextResponse.json({ error: "Unable to sign out." }, { status });
  }
}
