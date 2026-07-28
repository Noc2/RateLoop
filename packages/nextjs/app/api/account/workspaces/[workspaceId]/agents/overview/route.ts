import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getAgentOverview } from "~~/lib/tokenless/agentOverview";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await params;
    return NextResponse.json(await getAgentOverview({ accountAddress: session.principalId, workspaceId }), {
      headers: NO_STORE,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
