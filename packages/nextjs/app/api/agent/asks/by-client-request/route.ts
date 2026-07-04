import { NextRequest } from "next/server";
import {
  AGENT_READ_RATE_LIMIT,
  MCP_SCOPES,
  handleAgentRoute,
  handlePublicAgentRoute,
  hasAgentBearerToken,
} from "~~/lib/agent/http";
import { parsePositiveIntegerChainId } from "~~/lib/chainId";
import { callPublicRateLoopMcpTool, callRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const chainId = parsePositiveIntegerChainId(searchParams.get("chainId"));
  const clientRequestId = searchParams.get("clientRequestId")?.trim() ?? "";
  const walletAddress = searchParams.get("walletAddress")?.trim() ?? "";

  if (!hasAgentBearerToken(request)) {
    return handlePublicAgentRoute({
      handler: () =>
        callPublicRateLoopMcpTool({
          arguments: { chainId, clientRequestId, walletAddress },
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
        arguments: { chainId, clientRequestId, walletAddress },
        name: "rateloop_get_question_status",
      }),
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
    requiredScope: MCP_SCOPES.read,
  });
}
