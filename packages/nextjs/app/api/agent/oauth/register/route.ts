import { NextRequest, NextResponse } from "next/server";
import { AgentOAuthError, registerAgentOAuthClient } from "~~/lib/tokenless/agentOAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new AgentOAuthError("invalid_request", "Content-Type must be application/json.", 415);
    }
    const body = await request.json().catch(() => {
      throw new AgentOAuthError("invalid_request", "The client metadata JSON is invalid.");
    });
    return NextResponse.json(await registerAgentOAuthClient(body), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const oauth =
      error instanceof AgentOAuthError
        ? error
        : new AgentOAuthError("server_error", "OAuth client registration failed.", 500);
    return NextResponse.json(
      { error: oauth.code, error_description: oauth.message },
      { status: oauth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
