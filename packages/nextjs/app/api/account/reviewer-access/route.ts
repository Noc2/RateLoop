import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { listMyWorkspaceReviewerAccess } from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    const reviewerAccess = await listMyWorkspaceReviewerAccess({ accountAddress: session.principalId });
    return NextResponse.json({ reviewerAccess }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
