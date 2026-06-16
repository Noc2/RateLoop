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

export async function GET(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  const { operationKey } = await context.params;

  if (!hasAgentBearerToken(request)) {
    return handlePublicAgentRoute({
      handler: () =>
        callPublicRateLoopMcpTool({
          arguments: { operationKey },
          name: "rateloop_get_question_status",
        }),
      rateLimit: AGENT_READ_RATE_LIMIT,
      request,
    });
  }

  return handleAgentRoute({
    handler: ({ agent }) =>
      callRateLoopMcpTool({
        agent,
        arguments: { operationKey },
        name: "rateloop_get_question_status",
      }),
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
    requiredScope: MCP_SCOPES.read,
  });
}
