import { NextRequest, NextResponse, after } from "next/server";
import {
  MCP_SCOPES,
  type McpAgentAuth,
  McpAuthError,
  type McpScope,
  authenticateMcpRequest,
  buildMcpAuthChallenge,
} from "~~/lib/mcp/auth";
import { normalizeToolError } from "~~/lib/mcp/tools";
import { checkRateLimit } from "~~/utils/rateLimit";

type AgentRouteRateLimit = {
  limit: number;
  windowMs: number;
};

type AgentRouteContext = {
  agent: McpAgentAuth;
  scheduleBackgroundTask: (task: () => Promise<void> | void) => void;
};

type AgentRouteOptions = {
  allowOnStoreUnavailable?: boolean;
  handler: (context: AgentRouteContext) => Promise<Response | unknown>;
  rateLimit: AgentRouteRateLimit;
  request: NextRequest;
  requiredScope: McpScope;
};

type PublicAgentRouteContext = {
  scheduleBackgroundTask: (task: () => Promise<void> | void) => void;
};

type PublicAgentRouteOptions = {
  allowOnStoreUnavailable?: boolean;
  handler: (context: PublicAgentRouteContext) => Promise<Response | unknown>;
  rateLimit: AgentRouteRateLimit;
  request: NextRequest;
};

export { JSON_BODY_TOO_LARGE, isJsonObjectBody, jsonBodyErrorResponse, parseJsonBody } from "~~/lib/http/jsonBody";

function metadataUrl(request: Request) {
  return new URL("/.well-known/oauth-protected-resource", request.url).toString();
}

function authErrorBody(error: McpAuthError) {
  if (error.status === 503) {
    return {
      code: "service_unavailable",
      message: error.message,
      recoverWith: "configure_agent_auth",
      retryable: true,
      status: error.status,
    };
  }

  return {
    code: "transport_auth_required",
    message: error.message,
    recoverWith: error.status === 403 ? "grant_required_scope" : "provide_bearer_token",
    retryable: false,
    status: error.status,
  };
}

export async function handleAgentRoute(params: AgentRouteOptions) {
  const limited = await checkRateLimit(params.request, params.rateLimit, {
    allowOnStoreUnavailable: params.allowOnStoreUnavailable ?? false,
  });
  if (limited) return limited;

  let agent: McpAgentAuth;
  try {
    agent = await authenticateMcpRequest(params.request, params.requiredScope);
  } catch (error) {
    if (error instanceof McpAuthError) {
      return NextResponse.json(authErrorBody(error), {
        headers: {
          "WWW-Authenticate": buildMcpAuthChallenge({
            metadataUrl: metadataUrl(params.request),
            scope: error.requiredScope,
          }),
        },
        status: error.status,
      });
    }
    throw error;
  }

  try {
    const result = await params.handler({
      agent,
      scheduleBackgroundTask: task => {
        after(task);
      },
    });
    if (result instanceof Response) {
      return result;
    }
    return NextResponse.json(result);
  } catch (error) {
    const normalized = normalizeToolError(error);
    return NextResponse.json(normalized, { status: normalized.status });
  }
}

export function hasAgentBearerToken(request: Request) {
  return Boolean(request.headers.get("authorization")?.trim());
}

export async function handlePublicAgentRoute(params: PublicAgentRouteOptions) {
  const limited = await checkRateLimit(params.request, params.rateLimit, {
    allowOnStoreUnavailable: params.allowOnStoreUnavailable ?? false,
  });
  if (limited) return limited;

  try {
    const result = await params.handler({
      scheduleBackgroundTask: task => {
        after(task);
      },
    });
    if (result instanceof Response) {
      return result;
    }
    return NextResponse.json(result);
  } catch (error) {
    const normalized = normalizeToolError(error);
    return NextResponse.json(normalized, { status: normalized.status });
  }
}

function defaultAgentRouteErrorCode(status: number) {
  if (status === 401) return "transport_auth_required";
  if (status === 409) return "conflict";
  if (status === 503) return "service_unavailable";
  if (status >= 500) return "internal_error";
  return "invalid_arguments";
}

function defaultAgentRouteRecoverWith(status: number) {
  if (status === 401) return "provide_bearer_token";
  if (status === 409) return "refresh_and_retry";
  if (status >= 500) return "retry_or_contact_operator";
  return "fix_request_and_retry";
}

export function agentRouteErrorResponse(
  message: string,
  status: number,
  options?: {
    code?: string;
    recoverWith?: string;
    retryable?: boolean;
  },
) {
  return NextResponse.json(
    {
      code: options?.code ?? defaultAgentRouteErrorCode(status),
      message,
      recoverWith: options?.recoverWith ?? defaultAgentRouteRecoverWith(status),
      retryable: options?.retryable ?? status >= 500,
      status,
    },
    { status },
  );
}

export const AGENT_READ_RATE_LIMIT = { limit: 120, windowMs: 60_000 } satisfies AgentRouteRateLimit;
export const AGENT_WRITE_RATE_LIMIT = { limit: 30, windowMs: 60_000 } satisfies AgentRouteRateLimit;
export { MCP_SCOPES };
