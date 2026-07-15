import { NextRequest, NextResponse } from "next/server";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import { createAgentOAuthDeviceAuthorization } from "~~/lib/tokenless/agentOAuthDevice";
import { agentOAuthErrorResponse, enforceAgentOAuthRateLimit } from "~~/lib/tokenless/agentOAuthHttp";

export const runtime = "nodejs";

function field(form: URLSearchParams, key: string, max = 4_096) {
  const values = form.getAll(key);
  if (values.length !== 1 || !values[0] || values[0].length > max) {
    throw new AgentOAuthError("invalid_request", `${key} must appear exactly once.`);
  }
  return values[0];
}

function optionalField(form: URLSearchParams, key: string, max = 4_096) {
  const values = form.getAll(key);
  if (values.length > 1 || (values[0]?.length ?? 0) > max) {
    throw new AgentOAuthError("invalid_request", `${key} must not be repeated.`);
  }
  return values[0] || null;
}

export async function POST(request: NextRequest) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      throw new AgentOAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded.", 415);
    }
    await enforceAgentOAuthRateLimit(request.headers);
    if (request.headers.has("authorization")) {
      throw new AgentOAuthError("invalid_client", "Device authorization accepts public clients only.", 401);
    }
    const form = new URLSearchParams(await request.text());
    if (form.has("client_secret")) {
      throw new AgentOAuthError("invalid_client", "Dynamic RateLoop clients cannot use a client secret.", 401);
    }
    const response = await createAgentOAuthDeviceAuthorization({
      clientId: field(form, "client_id", 512),
      resource: field(form, "resource", 2_048),
      scope: optionalField(form, "scope"),
    });
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    const response = agentOAuthErrorResponse(error, "Device authorization could not be started.");
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
  }
}
