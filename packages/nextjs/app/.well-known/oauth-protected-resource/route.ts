import { NextResponse } from "next/server";
import { getAgentOAuthProtectedResourceMetadata } from "~~/lib/tokenless/agentOAuth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAgentOAuthProtectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
