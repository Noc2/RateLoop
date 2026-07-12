import { NextRequest, NextResponse } from "next/server";
import { createBaseAccountNonce } from "~~/lib/base-account/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site challenge request denied." }, { status: 403 });
  }
  const nonce = await createBaseAccountNonce();
  return NextResponse.json(nonce, { headers: { "Cache-Control": "no-store" } });
}
