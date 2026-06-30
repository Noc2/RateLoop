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
import { readAgentTransactionHashes } from "~~/lib/agent/transactionHashes";
import { McpToolError, callPublicRateLoopMcpTool, callRateLoopMcpTool } from "~~/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ operationKey: string }> }) {
  const { operationKey } = await context.params;
  if (!hasAgentBearerToken(request)) {
    return handlePublicAgentRoute({
      handler: async () => {
        const body = await parseJsonBody(request);
        if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);
        const transactionHashes = readAgentTransactionHashes(
          (body as { transactionHashes?: unknown }).transactionHashes,
          message => new McpToolError(message),
        );
        return callPublicRateLoopMcpTool({
          arguments: {
            ...body,
            transactionHashes,
            operationKey,
          },
          name: "rateloop_confirm_feedback_bonus_transactions",
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
      const transactionHashes = readAgentTransactionHashes(
        (body as { transactionHashes?: unknown }).transactionHashes,
        message => new McpToolError(message),
      );
      return callRateLoopMcpTool({
        agent,
        arguments: {
          ...body,
          transactionHashes,
          operationKey,
        },
        name: "rateloop_confirm_feedback_bonus_transactions",
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
    requiredScope: MCP_SCOPES.ask,
  });
}
