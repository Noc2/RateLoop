import { NextRequest, NextResponse } from "next/server";
import { MCP_AUTHENTICATION_SCHEME, MCP_SCOPES } from "~~/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MCP_RESOURCE_PATH = "/api/mcp";

function resolveResourcePath(resource: string[] | undefined): string | null {
  if (!resource || resource.length === 0) return MCP_RESOURCE_PATH;

  const path = `/${resource.join("/")}`;
  return path === MCP_RESOURCE_PATH ? path : null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ resource?: string[] | undefined }> }) {
  const params = await context.params;
  const resourcePath = resolveResourcePath(params.resource);
  if (!resourcePath) {
    return NextResponse.json({ error: "Unknown protected resource." }, { status: 404 });
  }

  const resource = new URL(resourcePath, request.url);
  resource.hash = "";
  resource.search = "";
  return NextResponse.json(
    {
      bearer_methods_supported: ["header"],
      resource: resource.toString(),
      resource_documentation: new URL("/docs/ai#mcp-adapter-shape", request.url).toString(),
      resource_name: "RateLoop MCP",
      rateloop_authentication: MCP_AUTHENTICATION_SCHEME,
      scopes_supported: [MCP_SCOPES.quote, MCP_SCOPES.ask, MCP_SCOPES.rate, MCP_SCOPES.read, MCP_SCOPES.balance],
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
