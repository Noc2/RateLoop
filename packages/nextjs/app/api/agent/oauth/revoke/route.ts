import { NextRequest, NextResponse } from "next/server";
import { AgentOAuthError, revokeAgentOAuthToken } from "~~/lib/tokenless/agentOAuth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      throw new AgentOAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded.", 415);
    }
    const form = new URLSearchParams(await request.text());
    const clientId = form.get("client_id");
    const token = form.get("token");
    if (
      !clientId ||
      !token ||
      form.getAll("client_id").length !== 1 ||
      form.getAll("token").length !== 1 ||
      form.getAll("token_type_hint").length > 1
    ) {
      throw new AgentOAuthError("invalid_request", "client_id and token must each appear exactly once.");
    }
    await revokeAgentOAuthToken({ clientId, token, tokenTypeHint: form.get("token_type_hint") });
    return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const oauth =
      error instanceof AgentOAuthError
        ? error
        : new AgentOAuthError("server_error", "OAuth token revocation failed.", 500);
    return NextResponse.json(
      { error: oauth.code, error_description: oauth.message },
      { status: oauth.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
