import { NextRequest, NextResponse } from "next/server";
import { AGENT_OAUTH_CLIENT_ID_MAX_LENGTH, AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { createAgentOAuthDeviceAuthorization } from "~~/lib/tokenless/agentOAuthDevice";
import {
  agentOAuthErrorResponse,
  assertAgentOAuthFormContentType,
  enforceAgentOAuthRateLimit,
  readAgentOAuthFormBody,
  readAgentOAuthFormField,
} from "~~/lib/tokenless/agentOAuthHttp";

export const runtime = "nodejs";

function field(form: URLSearchParams, key: string, max = 4_096) {
  return readAgentOAuthFormField(form, key, { max })!;
}

function optionalField(form: URLSearchParams, key: string, max = 4_096) {
  return readAgentOAuthFormField(form, key, { max, required: false });
}

export async function POST(request: NextRequest) {
  try {
    assertAgentOAuthFormContentType(request.headers);
    await enforceAgentOAuthRateLimit(request.headers);
    if (request.headers.has("authorization")) {
      throw new AgentOAuthError("invalid_client", "Device authorization accepts public clients only.", 401);
    }
    const form = await readAgentOAuthFormBody(request);
    if (form.has("client_secret")) {
      throw new AgentOAuthError("invalid_client", "Dynamic RateLoop clients cannot use a client secret.", 401);
    }
    const response = await createAgentOAuthDeviceAuthorization({
      clientId: field(form, "client_id", AGENT_OAUTH_CLIENT_ID_MAX_LENGTH),
      resource: field(form, "resource", 2_048),
      scope: optionalField(form, "scope"),
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    const response = agentOAuthErrorResponse(error, "Device authorization could not be started.");
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
  }
}
