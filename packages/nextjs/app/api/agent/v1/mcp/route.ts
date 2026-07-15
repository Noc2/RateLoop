import { NextRequest } from "next/server";
import { TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION, TOKENLESS_MCP_PROTOCOL_VERSIONS } from "~~/lib/mcp/protocol";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";
import { dispatchWorkspaceMcp } from "~~/lib/mcp/workspaceProtocol";
import { authenticateAgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import { AGENT_OAUTH_SAFE_SCOPES } from "~~/lib/tokenless/agentOAuth";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1_024;

function json(value: unknown, status = 200, extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Origin, Accept, Authorization, MCP-Protocol-Version");
  return new Response(JSON.stringify(value), { headers, status });
}

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return new Headers();
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new TokenlessServiceError("Origin is not allowed.", 403, "origin_forbidden");
  }
  if (parsedOrigin !== origin || parsedOrigin !== request.nextUrl.origin) {
    throw new TokenlessServiceError("Origin is not allowed.", 403, "origin_forbidden");
  }
  const headers = new Headers({ "Access-Control-Allow-Origin": parsedOrigin });
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, MCP-Session-Id");
  return headers;
}

function applyOAuthChallenge(response: Response, request: NextRequest) {
  response.headers.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${request.nextUrl.origin}/.well-known/oauth-protected-resource/api/agent/v1/mcp", scope="${AGENT_OAUTH_SAFE_SCOPES.join(" ")}"`,
  );
  return response;
}

function rpcError(status: number, message: string, code: string, rpcCode = -32000) {
  return json({ error: { code: rpcCode, data: { code }, message }, id: null, jsonrpc: "2.0" }, status);
}

function validateHeaders(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new TokenlessServiceError("Content-Type must be application/json.", 415, "invalid_content_type");
  }
  const accepts = (request.headers.get("accept") ?? "")
    .toLowerCase()
    .split(",")
    .map(value => value.split(";", 1)[0].trim());
  if (!accepts.includes("application/json") || !accepts.includes("text/event-stream")) {
    throw new TokenlessServiceError(
      "Accept must include application/json and text/event-stream.",
      406,
      "invalid_accept_header",
    );
  }
  const version = request.headers.get("mcp-protocol-version")?.trim() || TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION;
  if (!TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(version as never)) {
    throw new TokenlessServiceError("Unsupported MCP protocol version.", 400, "unsupported_protocol_version");
  }
}

async function readBody(request: NextRequest) {
  const declared = request.headers.get("content-length");
  if (
    declared &&
    (!Number.isSafeInteger(Number(declared)) || Number(declared) < 0 || Number(declared) > MAX_BODY_BYTES)
  ) {
    throw new TokenlessServiceError("MCP request body exceeds 64 KiB.", 413, "request_too_large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new TokenlessServiceError("MCP request body exceeds 64 KiB.", 413, "request_too_large");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TokenlessServiceError("Parse error", 400, "parse_error");
  }
}

export async function POST(request: NextRequest) {
  let cors = new Headers();
  try {
    cors = corsHeaders(request);
    validateHeaders(request);
    const rateLimit = await consumeMcpRateLimit(request.headers);
    if (!rateLimit.allowed) {
      const response = rpcError(429, "MCP rate limit exceeded.", "rate_limit_exceeded");
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      for (const [key, value] of cors) response.headers.set(key, value);
      return response;
    }
    const principal = await authenticateAgentMcpPrincipal(request.headers.get("authorization"));
    const result = await dispatchWorkspaceMcp(await readBody(request), principal, {
      origin: request.nextUrl.origin,
      signal: request.signal,
    });
    if (result === null) {
      const headers = new Headers(cors);
      headers.set("Cache-Control", "no-store");
      return new Response(null, { headers, status: 202 });
    }
    return json(result, 200, cors);
  } catch (error) {
    if (error instanceof TokenlessServiceError) {
      const response = rpcError(
        error.status,
        error.message,
        error.code,
        error.code === "parse_error" ? -32700 : -32000,
      );
      for (const [key, value] of cors) response.headers.set(key, value);
      return error.status === 401 ? applyOAuthChallenge(response, request) : response;
    }
    const response = rpcError(500, "RateLoop workspace MCP request failed.", "internal_error", -32603);
    for (const [key, value] of cors) response.headers.set(key, value);
    return response;
  }
}

export async function OPTIONS(request: NextRequest) {
  try {
    const headers = corsHeaders(request);
    headers.set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, MCP-Protocol-Version");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(null, { headers, status: 204 });
  } catch (error) {
    if (error instanceof TokenlessServiceError) return rpcError(error.status, error.message, error.code);
    return rpcError(500, "RateLoop workspace MCP request failed.", "internal_error", -32603);
  }
}

export async function GET() {
  const response = rpcError(405, "Use POST for Streamable HTTP.", "method_not_allowed", -32600);
  response.headers.set("Allow", "POST, OPTIONS");
  return response;
}
