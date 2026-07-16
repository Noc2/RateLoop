import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { pauseWorkspaceGrcConnector, updateWorkspaceGrcConnector } from "~~/lib/tokenless/assuranceGrcConnectors";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string; connectorId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, connectorId } = await context.params;
    return NextResponse.json(
      await updateWorkspaceGrcConnector({
        accountAddress: session.principalId,
        workspaceId,
        connectorId,
        body: await request.json(),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, connectorId } = await context.params;
    await pauseWorkspaceGrcConnector({ accountAddress: session.principalId, workspaceId, connectorId });
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
