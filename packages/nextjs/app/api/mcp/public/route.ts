import { NextRequest, NextResponse } from "next/server";
import { JSON_BODY_TOO_LARGE, parseJsonBody } from "~~/lib/http/jsonBody";
import { PUBLIC_MCP_TOOLS, callPublicRateLoopMcpTool, normalizeToolError } from "~~/lib/mcp/tools";
import { checkRateLimit, resolveRateLimitSubject } from "~~/utils/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_MCP_PROTOCOL_VERSIONS = new Set(["2025-06-18", DEFAULT_MCP_PROTOCOL_VERSION]);
const MCP_JSON_BODY_MAX_BYTES = 16 * 1024 * 1024;
const RATE_LIMIT = { limit: 120, windowMs: 60_000 };

type JsonRpcRequest = {
  id?: string | number | null;
  jsonrpc?: string;
  method?: string;
  params?: Record<string, unknown>;
};

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = (process.env.RATELOOP_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };

  if (origin && (allowedOrigins.includes("*") || allowedOrigins.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function originAllowed(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowedOrigins = (process.env.RATELOOP_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

function jsonRpcResult(id: JsonRpcRequest["id"], result: unknown, request: Request) {
  return NextResponse.json(
    {
      id,
      jsonrpc: "2.0",
      result,
    },
    { headers: corsHeaders(request) },
  );
}

function jsonRpcError(id: JsonRpcRequest["id"], code: number, message: string, request: Request, data?: unknown) {
  return NextResponse.json(
    {
      error: {
        code,
        data,
        message,
      },
      id: id ?? null,
      jsonrpc: "2.0",
    },
    { headers: corsHeaders(request), status: code === -32603 ? 500 : 200 },
  );
}

function jsonRpcHttpError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
  request: Request,
  status: number,
  data?: unknown,
) {
  return NextResponse.json(
    {
      error: {
        code,
        data,
        message,
      },
      id: id ?? null,
      jsonrpc: "2.0",
    },
    { headers: corsHeaders(request), status },
  );
}

function protocolVersionError(request: NextRequest, body: JsonRpcRequest) {
  if (body.method === "initialize") return null;
  const requested = request.headers.get("mcp-protocol-version");
  if (!requested) {
    return "Missing MCP-Protocol-Version header.";
  }
  if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requested)) {
    return `Unsupported MCP-Protocol-Version: ${requested}.`;
  }
  return null;
}

function negotiatedProtocolVersion(body: JsonRpcRequest) {
  const requested = (body.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  return typeof requested === "string" && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requested)
    ? requested
    : DEFAULT_MCP_PROTOCOL_VERSION;
}

function toolResult(result: unknown) {
  return {
    content: [
      {
        text: JSON.stringify(result),
        type: "text",
      },
    ],
    structuredContent: result,
  };
}

function toolErrorResult(error: unknown) {
  const normalized = normalizeToolError(error);
  return {
    content: [
      {
        text: normalized.message,
        type: "text",
      },
    ],
    isError: true,
    structuredContent: normalized,
  };
}

export function OPTIONS(request: NextRequest) {
  if (!originAllowed(request)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { headers: corsHeaders(request), status: 204 });
}

export function GET(request: NextRequest) {
  return NextResponse.json(
    {
      allowedMethods: ["POST", "OPTIONS"],
      error:
        "SSE streams are not enabled for this RateLoop public MCP release. Use POST JSON-RPC calls over streamable HTTP.",
      supportedTransports: ["streamable-http"],
    },
    { headers: { ...corsHeaders(request), Allow: "POST, OPTIONS" }, status: 405 },
  );
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return jsonRpcError(null, -32000, "Origin is not allowed.", request);
  }

  const limited = await checkRateLimit(request, RATE_LIMIT);
  if (limited) return limited;

  const parsedBody = await parseJsonBody(request, { maxBytes: MCP_JSON_BODY_MAX_BYTES });
  if (parsedBody === JSON_BODY_TOO_LARGE) {
    return jsonRpcHttpError(null, -32000, "Request body is too large.", request, 413);
  }
  if (parsedBody === null) {
    return jsonRpcError(null, -32700, "Parse error", request);
  }
  const body = parsedBody as JsonRpcRequest;

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError(body.id, -32600, "Invalid Request", request);
  }

  const versionError = protocolVersionError(request, body);
  if (versionError) {
    return jsonRpcError(body.id, -32000, versionError, request, {
      supportedProtocolVersions: Array.from(SUPPORTED_MCP_PROTOCOL_VERSIONS),
    });
  }

  if (body.id === undefined || body.id === null) {
    return new Response(null, { headers: corsHeaders(request), status: 202 });
  }

  if (body.method === "initialize") {
    return jsonRpcResult(
      body.id,
      {
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        protocolVersion: negotiatedProtocolVersion(body),
        serverInfo: {
          name: "rateloop-public",
          version: "0.1.0",
        },
      },
      request,
    );
  }

  if (body.method === "ping") {
    return jsonRpcResult(body.id, {}, request);
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(
      body.id,
      {
        tools: PUBLIC_MCP_TOOLS.map(tool => ({
          ...(tool.annotations ? { annotations: tool.annotations } : {}),
          description: tool.description,
          inputSchema: tool.inputSchema,
          name: tool.name,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
          rateLoopTier: tool.rateLoopTier,
          rateLoopWorkflow: tool.rateLoopWorkflow,
          ...(tool.recommendedEntryPoint ? { recommendedEntryPoint: tool.recommendedEntryPoint } : {}),
          title: tool.title,
        })),
      },
      request,
    );
  }

  if (body.method === "tools/call") {
    const name = typeof body.params?.name === "string" ? body.params.name : "";
    const result = await callPublicRateLoopMcpTool({
      arguments: body.params?.arguments,
      name,
      rateLimitSubjectId: resolveRateLimitSubject(request),
      requestUrl: request.url,
    }).then(toolResult, toolErrorResult);

    return jsonRpcResult(body.id, result, request);
  }

  return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`, request);
}
