import { NextRequest } from "next/server";
import { AgentAskHandoffError, buildAgentAskHandoffResponse, recoverAgentAskHandoffAsset } from "~~/lib/agent/handoffs";
import {
  AGENT_WRITE_RATE_LIMIT,
  handlePublicAgentRoute,
  isJsonObjectBody,
  jsonBodyErrorResponse,
  parseJsonBody,
} from "~~/lib/agent/http";

const MAX_BODY_BYTES = 16 * 1024;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readAction(value: unknown): "remove" | "retry" {
  if (value === "remove" || value === "retry") return value;
  throw new AgentAskHandoffError("action must be retry or remove.");
}

function readToken(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new AgentAskHandoffError("token is required.");
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ assetId: string; handoffId: string }> },
) {
  const { assetId, handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const body = await parseJsonBody(request, { maxBytes: MAX_BODY_BYTES });
      if (!isJsonObjectBody(body)) return jsonBodyErrorResponse(body);

      const recovered = await recoverAgentAskHandoffAsset({
        action: readAction(body.action),
        assetId,
        handoffId,
        token: readToken(body.token),
      });
      return buildAgentAskHandoffResponse({
        assets: recovered.assets,
        handoff: recovered.handoff,
        includeImageData: body.includeImageData === true || body.includeImageData === "true",
      });
    },
    rateLimit: AGENT_WRITE_RATE_LIMIT,
    request,
  });
}
