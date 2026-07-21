import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { revokeWorkspaceMemberInvite } from "~~/lib/tokenless/workspaceGovernance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; inviteId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, inviteId } = await context.params;
    return NextResponse.json(
      await revokeWorkspaceMemberInvite({ accountAddress: session.principalId, workspaceId, inviteId }),
      { headers: noStore },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
