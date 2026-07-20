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

export function readAgentOAuthResource(
  form: URLSearchParams,
  expectedResource: string,
  options: { allowOmitted?: boolean } = {},
  max = 2_048,
) {
  const values = form.getAll("resource");
  if (values.length === 0 && options.allowOmitted === true) return expectedResource;
  const expected = new URL(expectedResource);
  const expectedPath = expected.pathname.replace(/\/+$/u, "") || "/";
  const parsed = values.map(value => {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  });
  const includesExpectedResource = parsed.some(
    value => value && (value.pathname.replace(/\/+$/u, "") || "/") === expectedPath,
  );
  if (
    values.length === 0 ||
    values.length > 4 ||
    values.some(value => !value || value.length > max) ||
    parsed.some(
      value =>
        !value ||
        value.origin !== expected.origin ||
        value.username !== "" ||
        value.password !== "" ||
        value.search !== "" ||
        value.hash !== "",
    ) ||
    !includesExpectedResource
  ) {
    throw new AgentOAuthError(
      "invalid_request",
      "resource must include the RateLoop MCP resource and may repeat only this server origin.",
    );
  }
  return expectedResource;
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
