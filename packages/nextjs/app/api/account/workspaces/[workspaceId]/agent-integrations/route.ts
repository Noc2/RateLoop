import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listAgentConnections } from "~~/lib/tokenless/agentIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const { integrations } = await listAgentConnections({ accountAddress: session.address, workspaceId });
    return NextResponse.json({ integrations }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
