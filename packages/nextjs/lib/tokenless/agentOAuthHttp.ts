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
