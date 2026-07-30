import "server-only";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import { AgentOAuthError } from "~~/lib/tokenless/agentOAuth";
import {
  BoundedRequestBodyError,
  readBoundedJsonRequestBody,
  readBoundedRequestText,
} from "~~/lib/tokenless/boundedRequestBody";

export const AGENT_OAUTH_FORM_BODY_MAX_BYTES = 32 * 1_024;
export const AGENT_OAUTH_REGISTRATION_BODY_MAX_BYTES = 32 * 1_024;

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
  let body: string;
  try {
    body = await readBoundedRequestText(request, maxBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      if (error.reason === "body_too_large") {
        throw new AgentOAuthError("invalid_request", "The OAuth form body is too large.", 413);
      }
      throw new AgentOAuthError("invalid_request", "The OAuth form body is invalid.");
    }
    throw error;
  }
  return new URLSearchParams(body);
}

export async function readAgentOAuthRegistrationBody(
  request: Pick<Request, "body" | "headers">,
  maxBytes = AGENT_OAUTH_REGISTRATION_BODY_MAX_BYTES,
) {
  try {
    return await readBoundedJsonRequestBody(request, maxBytes);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      if (error.reason === "body_too_large") {
        throw new AgentOAuthError("invalid_request", "The client metadata JSON is too large.", 413);
      }
      if (error.reason === "invalid_content_length") {
        throw new AgentOAuthError("invalid_request", "Content-Length is invalid.");
      }
      throw new AgentOAuthError("invalid_request", "The client metadata JSON is invalid.");
    }
    throw error;
  }
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
