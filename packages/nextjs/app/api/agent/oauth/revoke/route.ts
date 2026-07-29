import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_OAUTH_CLIENT_ID_MAX_LENGTH,
  AGENT_OAUTH_CREDENTIAL_MAX_LENGTH,
  AgentOAuthError,
  revokeAgentOAuthToken,
} from "~~/lib/tokenless/agentOAuth";
import {
  agentOAuthErrorResponse,
  assertAgentOAuthFormContentType,
  enforceAgentOAuthRateLimit,
  readAgentOAuthFormBody,
  readAgentOAuthFormField,
} from "~~/lib/tokenless/agentOAuthHttp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertAgentOAuthFormContentType(request.headers);
    await enforceAgentOAuthRateLimit(request.headers);
    if (request.headers.has("authorization")) {
      throw new AgentOAuthError(
        "invalid_client",
        "This endpoint accepts public clients without client authentication.",
        401,
      );
    }
    const form = await readAgentOAuthFormBody(request);
    if (form.has("client_secret")) {
      throw new AgentOAuthError("invalid_client", "Dynamic RateLoop clients cannot use a client secret.", 401);
    }
    const clientId = readAgentOAuthFormField(form, "client_id", { max: AGENT_OAUTH_CLIENT_ID_MAX_LENGTH })!;
    const token = readAgentOAuthFormField(form, "token", { max: AGENT_OAUTH_CREDENTIAL_MAX_LENGTH })!;
    const tokenTypeHint = readAgentOAuthFormField(form, "token_type_hint", { max: 64, required: false });
    await revokeAgentOAuthToken({ clientId, token, tokenTypeHint });
    return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = agentOAuthErrorResponse(error, "OAuth token revocation failed.");
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
  }
}
