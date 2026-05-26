import { NextRequest } from "next/server";
import {
  AGENT_READ_RATE_LIMIT,
  MCP_SCOPES,
  handleAgentRoute,
  handlePublicAgentRoute,
  hasAgentBearerToken,
} from "~~/lib/agent/http";
import { callPublicRateLoopMcpTool, callRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await context.params;

  if (!hasAgentBearerToken(request)) {
    return handlePublicAgentRoute({
      allowOnStoreUnavailable: true,
      handler: () =>
        callPublicRateLoopMcpTool({
          arguments: { contentId },
          name: "rateloop_get_result",
        }),
      rateLimit: AGENT_READ_RATE_LIMIT,
      request,
    });
  }

  return handleAgentRoute({
    allowOnStoreUnavailable: true,
    handler: ({ agent }) =>
      callRateLoopMcpTool({
        agent,
        arguments: { contentId },
        name: "rateloop_get_result",
      }),
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
    requiredScope: MCP_SCOPES.read,
  });
}
