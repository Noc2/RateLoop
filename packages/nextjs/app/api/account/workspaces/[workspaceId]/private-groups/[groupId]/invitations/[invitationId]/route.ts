import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { revokePrivateGroupInvitation } from "~~/lib/tokenless/privateGroups";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; groupId: string; invitationId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, groupId, invitationId } = await context.params;
    const invitation = await revokePrivateGroupInvitation({
      accountAddress: session.principalId,
      workspaceId,
      groupId,
      invitationId,
    });
    return NextResponse.json({ invitation });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
