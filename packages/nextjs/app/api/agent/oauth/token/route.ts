import { NextRequest, NextResponse } from "next/server";
import { AGENT_OAUTH_DEVICE_GRANT_TYPE, AgentOAuthError, exchangeAgentOAuthToken } from "~~/lib/tokenless/agentOAuth";
import { exchangeAgentOAuthDeviceCode } from "~~/lib/tokenless/agentOAuthDevice";
import { readAgentOAuthResource } from "~~/lib/tokenless/agentOAuthHttp";

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
    if (request.headers.has("authorization")) {
      throw new AgentOAuthError(
        "invalid_client",
        "This endpoint accepts public clients without client authentication.",
        401,
      );
    }
    const form = new URLSearchParams(await request.text());
    if (form.has("client_secret")) {
      throw new AgentOAuthError("invalid_client", "Dynamic RateLoop clients cannot use a client secret.", 401);
    }
    const grantType = field(form, "grant_type", 64);
    const clientId = field(form, "client_id", 512);
    const resource = readAgentOAuthResource(form);
    const response =
      grantType === "authorization_code"
        ? await exchangeAgentOAuthToken({
            grantType,
            clientId,
            resource,
            code: field(form, "code"),
            redirectUri: field(form, "redirect_uri", 2_048),
            codeVerifier: field(form, "code_verifier", 128),
          })
        : grantType === "refresh_token"
          ? await exchangeAgentOAuthToken({
              grantType,
              clientId,
              resource,
              refreshToken: field(form, "refresh_token"),
              scope: optionalField(form, "scope"),
            })
          : grantType === AGENT_OAUTH_DEVICE_GRANT_TYPE
            ? await exchangeAgentOAuthDeviceCode({
                clientId,
                resource,
                deviceCode: field(form, "device_code"),
              })
            : (() => {
                throw new AgentOAuthError("unsupported_grant_type", "The requested grant_type is unsupported.");
              })();
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    const oauth =
      error instanceof AgentOAuthError
        ? error
        : new AgentOAuthError("server_error", "The OAuth token exchange failed.", 500);
    return NextResponse.json(
      { error: oauth.code, error_description: oauth.message },
      { status: oauth.status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }
}
