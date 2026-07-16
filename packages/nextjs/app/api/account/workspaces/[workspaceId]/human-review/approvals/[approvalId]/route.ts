import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { decideHumanReviewApprovalForOwner } from "~~/lib/tokenless/humanReviewApprovals";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string; approvalId: string }> };

export async function PUT(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, approvalId } = await context.params;
    return NextResponse.json(
      await decideHumanReviewApprovalForOwner({
        accountAddress: session.principalId,
        workspaceId,
        approvalId,
        body: await request.json(),
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
