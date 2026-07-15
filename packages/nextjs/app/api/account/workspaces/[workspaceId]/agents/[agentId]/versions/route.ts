import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { type AgentVersionInput, createWorkspaceAgentVersion } from "~~/lib/tokenless/agentRegistry";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; agentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, agentId } = await context.params;
    const version = (await request.json()) as AgentVersionInput | null;
    if (!version || typeof version !== "object") {
      throw new TokenlessServiceError("Agent version body must be an object.", 400, "invalid_agent");
    }
    const agent = await createWorkspaceAgentVersion({
      accountAddress: session.principalId,
      workspaceId,
      agentId,
      version,
    });
    return NextResponse.json({ agent }, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
