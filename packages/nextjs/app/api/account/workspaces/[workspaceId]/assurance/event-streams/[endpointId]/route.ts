import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { deactivateAssuranceEventStream } from "~~/lib/tokenless/assuranceEventStreaming";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string; endpointId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, endpointId } = await context.params;
    await deactivateAssuranceEventStream({ accountAddress: session.principalId, workspaceId, endpointId });
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
