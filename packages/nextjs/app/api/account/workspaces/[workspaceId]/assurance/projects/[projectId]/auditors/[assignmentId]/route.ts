import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeProjectAccess } from "~~/lib/tokenless/projectAccess";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
type Context = { params: Promise<{ assignmentId: string; projectId: string; workspaceId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId, projectId, workspaceId } = await context.params;
    await revokeProjectAccess({ assignmentId, projectId, revokedBy: session.principalId, workspaceId });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": NO_STORE } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": NO_STORE },
    });
  }
}
