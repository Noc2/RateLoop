import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { leaveWorkspaceReviewer } from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId } = await context.params;
    const reviewerAccess = await leaveWorkspaceReviewer({
      accountAddress: session.principalId,
      workspaceId,
      reason: "reviewer_left_workspace",
    });
    return NextResponse.json({ reviewerAccess }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
