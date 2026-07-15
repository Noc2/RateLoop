import { NextRequest, NextResponse } from "next/server";
import { AgentOAuthError, registerAgentOAuthClient } from "~~/lib/tokenless/agentOAuth";
import { agentOAuthErrorResponse, enforceAgentOAuthRateLimit } from "~~/lib/tokenless/agentOAuthHttp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new AgentOAuthError("invalid_request", "Content-Type must be application/json.", 415);
    }
    await enforceAgentOAuthRateLimit(request.headers);
    const body = await request.json().catch(() => {
      throw new AgentOAuthError("invalid_request", "The client metadata JSON is invalid.");
    });
    return NextResponse.json(await registerAgentOAuthClient(body), {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = agentOAuthErrorResponse(error, "OAuth client registration failed.");
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
  }
}
