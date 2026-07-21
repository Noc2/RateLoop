import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { acceptAudienceAssignment, getAssignmentOnlyTask } from "~~/lib/tokenless/audienceAssignments";
import { getDirectPrivateReviewTask, isDirectPrivateReviewAssignmentId } from "~~/lib/tokenless/privateReviewResponses";
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
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
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
    const directAssignment = isDirectPrivateReviewAssignmentId(assignmentId);
    const acceptance = directAssignment
      ? await acceptPrivateUnpaidReviewAssignment({
          assignmentId,
          reviewerAccountAddress: session.principalId,
          confidentialityTermsAccepted: body.confidentialityTermsAccepted === true,
          confidentialityTermsHash: body.confidentialityTermsHash ?? "",
        })
      : await acceptAudienceAssignment({
          assignmentId,
          baseAccountAddress: session.principalId,
          confidentialityTermsAccepted: body.confidentialityTermsAccepted === true,
          confidentialityTermsHash: body.confidentialityTermsHash ?? "",
        });
    if (request.nextUrl.searchParams.get("includeTask") !== "1") {
      return NextResponse.json(acceptance, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
    }
    const task = directAssignment
      ? await getDirectPrivateReviewTask({ assignmentId, accountAddress: session.principalId })
      : await getAssignmentOnlyTask({ assignmentId, baseAccountAddress: session.principalId });
    return NextResponse.json({ acceptance, task }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }
}
