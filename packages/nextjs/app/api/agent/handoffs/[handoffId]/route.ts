import { NextRequest, NextResponse } from "next/server";
import {
  buildAgentAskHandoffResponse,
  listAgentAskHandoffAssets,
  loadAgentAskHandoffByToken,
  readHandoffTokenFromHeaders,
} from "~~/lib/agent/handoffs";
import { AGENT_READ_RATE_LIMIT, handlePublicAgentRoute } from "~~/lib/agent/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ handoffId: string }> }) {
  const { handoffId } = await context.params;

  return handlePublicAgentRoute({
    handler: async () => {
      const token = readHandoffTokenFromHeaders(request.headers);
      if (!token) {
        return NextResponse.json({ error: "handoff token is required." }, { status: 400 });
      }

      const handoff = await loadAgentAskHandoffByToken({ handoffId, token });
      const assets = await listAgentAskHandoffAssets(handoff.id);
      return buildAgentAskHandoffResponse({ assets, handoff, includeImageData: true });
    },
    rateLimit: AGENT_READ_RATE_LIMIT,
    request,
  });
}
