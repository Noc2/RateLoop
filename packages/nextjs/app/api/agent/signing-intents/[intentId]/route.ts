import { NextRequest, NextResponse } from "next/server";
import { AGENT_READ_RATE_LIMIT, handlePublicAgentRoute } from "~~/lib/agent/http";
import { getAgentSigningIntent } from "~~/lib/agent/signingIntents";
import { McpToolError, normalizeToolError } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNING_INTENT_TOKEN_HEADER = "x-rateloop-signing-intent-token";

export async function GET(request: NextRequest, context: { params: Promise<{ intentId: string }> }) {
  const token =
    request.headers.get(SIGNING_INTENT_TOKEN_HEADER)?.trim() ?? request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!token) {
    const normalized = normalizeToolError(new McpToolError("token is required."));
    return NextResponse.json(normalized, { status: normalized.status });
  }

  const { intentId } = await context.params;
  return handlePublicAgentRoute({
    handler: () => getAgentSigningIntent({ intentId, token }),
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
  });
}
