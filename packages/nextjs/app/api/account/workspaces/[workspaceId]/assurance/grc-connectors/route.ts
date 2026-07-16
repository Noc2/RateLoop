import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { createWorkspaceGrcConnector, listWorkspaceGrcConnectors } from "~~/lib/tokenless/assuranceGrcConnectors";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    return NextResponse.json(
      {
        schemaVersion: "rateloop.workspace-grc-connectors.v1",
        workspaceId,
        connectors: await listWorkspaceGrcConnectors({ accountAddress: session.principalId, workspaceId }),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    return NextResponse.json(
      await createWorkspaceGrcConnector({
        accountAddress: session.principalId,
        workspaceId,
        body: await request.json(),
      }),
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
