import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createAgentPairing, listAgentConnections } from "~~/lib/tokenless/agentIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(await listAgentConnections({ accountAddress: session.principalId, workspaceId }), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    return NextResponse.json(
      await createAgentPairing({ accountAddress: session.principalId, workspaceId, origin: request.nextUrl.origin }),
      { status: 201 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
