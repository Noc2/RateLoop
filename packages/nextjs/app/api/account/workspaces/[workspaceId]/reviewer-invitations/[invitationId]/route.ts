import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { revokeWorkspaceReviewerInvitation } from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; invitationId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, invitationId } = await context.params;
    const result = await revokeWorkspaceReviewerInvitation({
      accountAddress: session.principalId,
      workspaceId,
      invitationId,
    });
    return NextResponse.json({ invitation: result }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
