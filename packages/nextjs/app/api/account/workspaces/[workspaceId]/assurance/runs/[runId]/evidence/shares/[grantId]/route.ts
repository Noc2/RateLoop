import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokeEvidenceShareGrant } from "~~/lib/tokenless/evidenceShareGrants";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = "private, no-store, max-age=0";
type Context = { params: Promise<{ grantId: string; runId: string; workspaceId: string }> };

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { grantId, runId, workspaceId } = await context.params;
    await revokeEvidenceShareGrant({
      accountAddress: session.principalId,
      grantId,
      runId,
      workspaceId,
    });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": NO_STORE } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return jsonResponse(response.body, response.status);
  }
}
