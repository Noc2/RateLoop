import "server-only";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";

export async function enforceAgentOAuthRateLimit(headers: Headers, now = new Date()) {
  try {
    const result = await consumeMcpRateLimit(headers, now);
    if (!result.allowed) {
      throw new AgentOAuthError("slow_down", "OAuth request rate limit exceeded.", 429);
    }
  } catch (error) {
    if (error instanceof AgentOAuthError) throw error;
    if (error instanceof TokenlessMcpHttpError) {
      throw new AgentOAuthError("server_error", "OAuth rate limiting is unavailable.", error.status);
    }
    throw error;
  }
}

export function readAgentOAuthResource(form: URLSearchParams, max = 2_048) {
  const values = form.getAll("resource");
  const resources = new Set(values);
  if (values.length === 0 || resources.size !== 1 || !values[0] || values[0].length > max) {
    throw new AgentOAuthError("invalid_request", "resource must identify one exact server resource.");
  }
  return values[0];
}

export function agentOAuthErrorResponse(error: unknown, fallback: string) {
  const oauth = error instanceof AgentOAuthError ? error : new AgentOAuthError("server_error", fallback, 500);
  return {
    body: { error: oauth.code, error_description: oauth.message },
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...(oauth.status === 429 ? { "Retry-After": "60" } : {}),
    },
    status: oauth.status,
  };
}
