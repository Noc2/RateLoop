import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { removeWorkspaceReviewer } from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string; principalAddress: string }> };
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, principalAddress } = await context.params;
    const result = await removeWorkspaceReviewer({
      accountAddress: session.principalId,
      workspaceId,
      principalAddress,
    });
    return NextResponse.json({ reviewer: result }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
