import { NextResponse } from "next/server";
import { getAgentOAuthAuthorizationServerMetadata } from "~~/lib/tokenless/agentOAuth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAgentOAuthAuthorizationServerMetadata(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
