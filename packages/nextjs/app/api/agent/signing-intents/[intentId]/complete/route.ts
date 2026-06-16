import { NextRequest } from "next/server";
import {
  AGENT_WRITE_RATE_LIMIT,
  agentRouteErrorResponse,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";
import { completeAgentSigningIntent } from "~~/lib/agent/signingIntents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request);
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const { token, transactionHashes } = body as {
        token?: unknown;
        transactionHashes?: unknown;
      };
      if (typeof token !== "string" || !token.trim()) {
        return agentRouteErrorResponse("token is required.", 400);
      }

      return completeAgentSigningIntent({
        intentId,
        token,
        transactionHashes,
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
