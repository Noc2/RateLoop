import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { attestInvitedReviewerExpertise } from "~~/lib/tokenless/reviewerExpertise";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { workspaceId, projectId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const result = await attestInvitedReviewerExpertise({
      accountAddress: session.principalId,
      workspaceId,
      projectId,
      cohortId: String(body.cohortId ?? ""),
      reviewerAccountAddress: String(body.reviewerAccountAddress ?? ""),
      expertiseKeys: body.expertiseKeys,
      expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
