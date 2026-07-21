import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { acceptAudienceAssignment } from "~~/lib/tokenless/audienceAssignments";
import { isDirectPrivateReviewAssignmentId } from "~~/lib/tokenless/privateReviewResponses";
import {
  acceptPrivateUnpaidReviewAssignment,
  getPrivateUnpaidReviewAssignmentAccess,
} from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { assignmentId } = await context.params;
    if (!isDirectPrivateReviewAssignmentId(assignmentId)) {
      throw new TokenlessServiceError("Assignment access status is unavailable.", 404, "assignment_not_found");
    }
    return NextResponse.json(
      await getPrivateUnpaidReviewAssignmentAccess({
        assignmentId,
        reviewerAccountAddress: session.principalId,
        confidentialityTermsHash: request.nextUrl.searchParams.get("terms") ?? "",
      }),
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId } = await context.params;
    const body = (await request.json()) as {
      confidentialityTermsAccepted?: boolean;
      confidentialityTermsHash?: string;
    };
    return NextResponse.json(
      isDirectPrivateReviewAssignmentId(assignmentId)
        ? await acceptPrivateUnpaidReviewAssignment({
            assignmentId,
            reviewerAccountAddress: session.principalId,
            confidentialityTermsAccepted: body.confidentialityTermsAccepted === true,
            confidentialityTermsHash: body.confidentialityTermsHash ?? "",
          })
        : await acceptAudienceAssignment({
            assignmentId,
            baseAccountAddress: session.principalId,
            confidentialityTermsHash: body.confidentialityTermsHash ?? "",
          }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
