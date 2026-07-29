import "server-only";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";

export const AGENT_OAUTH_FORM_BODY_MAX_BYTES = 32 * 1_024;

export function assertAgentOAuthFormContentType(headers: Headers) {
  const mediaType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded") {
    throw new AgentOAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded.", 415);
  }
}

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

export async function readAgentOAuthFormBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes = AGENT_OAUTH_FORM_BODY_MAX_BYTES,
) {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const parsed = Number(declared);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      throw new AgentOAuthError("invalid_request", "The OAuth form body is too large.", 413);
    }
  }

  if (!request.body) return new URLSearchParams();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The bounded rejection remains authoritative even if cancellation fails.
        }
        throw new AgentOAuthError("invalid_request", "The OAuth form body is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new URLSearchParams(new TextDecoder().decode(body));
}

export function readAgentOAuthFormField(
  form: URLSearchParams,
  key: string,
  options: { max: number; required?: boolean },
) {
  const values = form.getAll(key);
  const required = options.required !== false;
  if (
    values.length > 1 ||
    (required && (values.length !== 1 || !values[0])) ||
    (values[0]?.length ?? 0) > options.max
  ) {
    throw new AgentOAuthError(
      "invalid_request",
      required ? `${key} must appear exactly once.` : `${key} must not be repeated.`,
    );
  }
  return values[0] || null;
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
