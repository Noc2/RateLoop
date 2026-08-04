import { NextRequest, NextResponse } from "next/server";
import {
  AGENT_OAUTH_CLIENT_ID_MAX_LENGTH,
  AGENT_OAUTH_CREDENTIAL_MAX_LENGTH,
  AGENT_OAUTH_DEVICE_GRANT_TYPE,
  AgentOAuthError,
  exchangeAgentOAuthToken,
  getCanonicalAgentMcpResource,
} from "~~/lib/tokenless/agentOAuth";
import { exchangeAgentOAuthDeviceCode } from "~~/lib/tokenless/agentOAuthDevice";
import {
  agentOAuthErrorResponse,
  assertAgentOAuthFormContentType,
  enforceAgentOAuthRateLimit,
  readAgentOAuthFormBody,
  readAgentOAuthFormField,
  readAgentOAuthResource,
} from "~~/lib/tokenless/agentOAuthHttp";
import { reportAgentProtocolFailure } from "~~/lib/tokenless/agentProtocolObservability";

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
    const grantType = field(form, "grant_type", 64);
    const clientId = field(form, "client_id", AGENT_OAUTH_CLIENT_ID_MAX_LENGTH);
    const resource = readAgentOAuthResource(form, getCanonicalAgentMcpResource(), {
      allowOmitted: grantType === "refresh_token",
    });
    const response =
      grantType === "authorization_code"
        ? await exchangeAgentOAuthToken({
            grantType,
            clientId,
            resource,
            code: field(form, "code", AGENT_OAUTH_CREDENTIAL_MAX_LENGTH),
            redirectUri: field(form, "redirect_uri", 2_048),
            codeVerifier: field(form, "code_verifier", 128),
          })
        : grantType === "refresh_token"
          ? await exchangeAgentOAuthToken({
              grantType,
              clientId,
              resource,
              refreshToken: field(form, "refresh_token", AGENT_OAUTH_CREDENTIAL_MAX_LENGTH),
              scope: optionalField(form, "scope"),
            })
          : grantType === AGENT_OAUTH_DEVICE_GRANT_TYPE
            ? await exchangeAgentOAuthDeviceCode({
                clientId,
                resource,
                deviceCode: field(form, "device_code", AGENT_OAUTH_CREDENTIAL_MAX_LENGTH),
              })
            : (() => {
                throw new AgentOAuthError("unsupported_grant_type", "The requested grant_type is unsupported.");
              })();
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    const response = agentOAuthErrorResponse(error, "The OAuth token exchange failed.");
    reportAgentProtocolFailure({
      endpoint: "oauth_token",
      method: "POST",
      status: response.status,
      errorCode: response.body.error,
      ...(response.status >= 500 ? { error } : {}),
    });
    return NextResponse.json(response.body, { status: response.status, headers: response.headers });
  }
}
