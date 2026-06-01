import { NextRequest } from "next/server";
import {
  AGENT_WRITE_RATE_LIMIT,
  MCP_SCOPES,
  handleAgentRoute,
  handlePublicAgentRoute,
  hasAgentBearerToken,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { callPublicRateLoopMcpTool, callRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasAgentBearerToken(request)) {
    return handlePublicAgentRoute({
      handler: async () => {
        const body = await parseJsonBody(request);
        if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
        return callPublicRateLoopMcpTool({
          arguments: body,
          name: "rateloop_quote_question",
        });
      },
      rateLimit: AGENT_WRITE_RATE_LIMIT,
      request,
    });
  }

  return handleAgentRoute({
    handler: async ({ agent }) => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
      return callRateLoopMcpTool({
        agent,
        arguments: body,
        name: "rateloop_quote_question",
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
    requiredScope: MCP_SCOPES.quote,
  });
}
