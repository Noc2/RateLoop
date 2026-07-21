import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";
import { previewWorkspaceReviewerInvitation } from "~~/lib/tokenless/workspaceReviewers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => key !== "token") ||
      typeof body.token !== "string"
    ) {
      throw new TokenlessServiceError("Reviewer invitation token is required.", 400, "invalid_workspace_reviewer");
    }
    const invitation = await previewWorkspaceReviewerInvitation({
      accountAddress: session.principalId,
      token: body.token,
    });
    return NextResponse.json({ invitation }, { headers: noStore });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: noStore });
  }
}
