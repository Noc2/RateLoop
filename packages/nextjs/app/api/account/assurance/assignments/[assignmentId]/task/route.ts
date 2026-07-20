import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { getAssignmentOnlyTask } from "~~/lib/tokenless/audienceAssignments";
import { getDirectPrivateReviewTask, isDirectPrivateReviewAssignmentId } from "~~/lib/tokenless/privateReviewResponses";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { assignmentId } = await context.params;
    return NextResponse.json(
      isDirectPrivateReviewAssignmentId(assignmentId)
        ? await getDirectPrivateReviewTask({ assignmentId, accountAddress: session.principalId })
        : await getAssignmentOnlyTask({ assignmentId, baseAccountAddress: session.principalId }),
      {
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
