import type { NextRequest } from "next/server";
import { TokenlessMcpHttpError } from "~~/lib/mcp/errors";
import {
  TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION,
  TOKENLESS_MCP_PROTOCOL_VERSIONS,
  dispatchTokenlessMcp,
} from "~~/lib/mcp/protocol";
import { consumeMcpRateLimit } from "~~/lib/mcp/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1_024;

function baseHeaders(extra: HeadersInit = {}) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Vary", "Origin, Accept, MCP-Protocol-Version");
  return headers;
}

function json(value: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  const headers = baseHeaders(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { headers, status });
}

function rpcError(status: number, message: string, code = -32000, data?: unknown) {
  return json(
    {
      error: { code, ...(data === undefined ? {} : { data }), message },
      id: null,
      jsonrpc: "2.0",
    },
    status,
  );
}

function requestOrigin(request: NextRequest) {
  return request.nextUrl.origin;
}

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return new Headers();
  let parsedOrigin: string;
  try {
    parsedOrigin = new URL(origin).origin;
  } catch {
    throw new TokenlessMcpHttpError("Origin is not allowed.", 403, "origin_forbidden");
  }
  if (parsedOrigin !== origin || parsedOrigin !== requestOrigin(request)) {
    throw new TokenlessMcpHttpError("Origin is not allowed.", 403, "origin_forbidden");
  }
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", parsedOrigin);
  return headers;
}

function requireStreamableAccept(request: NextRequest) {
  const mediaTypes = (request.headers.get("accept") ?? "")
    .toLowerCase()
    .split(",")
    .map(value => value.split(";", 1)[0].trim());
  if (!mediaTypes.includes("application/json") || !mediaTypes.includes("text/event-stream")) {
    throw new TokenlessMcpHttpError(
      "Accept must include application/json and text/event-stream.",
      406,
      "invalid_accept_header",
    );
  }
}

function requireJsonContentType(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new TokenlessMcpHttpError("Content-Type must be application/json.", 415, "invalid_content_type");
  }
}

function requireProtocolVersion(request: NextRequest) {
  const supplied = request.headers.get("mcp-protocol-version")?.trim() || TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION;
  if (!TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(supplied as never)) {
    throw new TokenlessMcpHttpError("Unsupported MCP protocol version.", 400, "unsupported_protocol_version");
  }
}

async function readBody(request: NextRequest) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new TokenlessMcpHttpError("Content-Length is invalid.", 400, "invalid_content_length");
    }
    if (parsedLength > MAX_BODY_BYTES) {
      throw new TokenlessMcpHttpError("MCP request body exceeds 64 KiB.", 413, "request_too_large");
    }
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new TokenlessMcpHttpError("MCP request body exceeds 64 KiB.", 413, "request_too_large");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new TokenlessMcpHttpError("Parse error", 400, "parse_error");
  }
}

function httpError(error: TokenlessMcpHttpError) {
  return rpcError(error.status, error.message, error.code === "parse_error" ? -32700 : -32000, {
    code: error.code,
  });
}

export async function POST(request: NextRequest) {
  let cors = new Headers();
  try {
    cors = corsHeaders(request);
    requireStreamableAccept(request);
    requireJsonContentType(request);
    requireProtocolVersion(request);
    const rateLimit = await consumeMcpRateLimit(request.headers);
    if (!rateLimit.allowed) {
      const response = rpcError(429, "MCP rate limit exceeded.", -32000, { code: "rate_limit_exceeded" });
      response.headers.set("Retry-After", String(rateLimit.retryAfterSeconds));
      for (const [key, value] of cors) response.headers.set(key, value);
      return response;
    }
    const value = await readBody(request);
    const result = await dispatchTokenlessMcp(value, requestOrigin(request));
    if (result === null) return new Response(null, { headers: baseHeaders(cors), status: 202 });
    return json(result, 200, cors);
  } catch (error) {
    if (error instanceof TokenlessMcpHttpError) {
      const response = httpError(error);
      for (const [key, value] of cors) response.headers.set(key, value);
      if (error.status === 429) response.headers.set("Retry-After", "60");
      return response;
    }
    const response = rpcError(500, "RateLoop MCP request failed.", -32603, { code: "internal_error" });
    for (const [key, value] of cors) response.headers.set(key, value);
    return response;
  }
}

export async function OPTIONS(request: NextRequest) {
  try {
    const cors = corsHeaders(request);
    cors.set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, MCP-Protocol-Version");
    cors.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    return new Response(null, { headers: baseHeaders(cors), status: 204 });
  } catch (error) {
    if (error instanceof TokenlessMcpHttpError) return httpError(error);
    return rpcError(500, "RateLoop MCP request failed.", -32603, { code: "internal_error" });
  }
}

export async function GET(request: NextRequest) {
  try {
    const cors = corsHeaders(request);
    cors.set("Allow", "POST, OPTIONS");
    return json(
      { error: { code: -32600, message: "Use POST for Streamable HTTP." }, id: null, jsonrpc: "2.0" },
      405,
      cors,
    );
  } catch (error) {
    if (error instanceof TokenlessMcpHttpError) return httpError(error);
    return rpcError(500, "RateLoop MCP request failed.", -32603, { code: "internal_error" });
  }
}
