import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { API_JSON_REQUEST_BODY_MAX_BYTES, readApiRequestText } from "~~/lib/tokenless/apiRequestBody";
import { recoverExpiredAudienceAssignment } from "~~/lib/tokenless/audienceAssignments";
import { isDirectPrivateReviewAssignmentId } from "~~/lib/tokenless/privateReviewResponses";
import { recoverPrivateUnpaidReviewAssignment } from "~~/lib/tokenless/privateUnpaidReviewAdapter";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId } = await context.params;
    const rawBody = await readApiRequestText(request, API_JSON_REQUEST_BODY_MAX_BYTES);
    let body: { confidentialityTermsHash?: string } = {};
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        body = parsed as { confidentialityTermsHash?: string };
      } catch {
        throw new TokenlessServiceError("Recovery body must be valid JSON.", 400, "invalid_assignment_recovery");
      }
    }
    return NextResponse.json(
      isDirectPrivateReviewAssignmentId(assignmentId)
        ? await recoverPrivateUnpaidReviewAssignment({
            assignmentId,
            reviewerAccountAddress: session.principalId,
            confidentialityTermsHash:
              typeof body.confidentialityTermsHash === "string" ? body.confidentialityTermsHash : "",
          })
        : await recoverExpiredAudienceAssignment({
            assignmentId,
            baseAccountAddress: session.principalId,
            confidentialityTermsHash:
              typeof body.confidentialityTermsHash === "string" ? body.confidentialityTermsHash : undefined,
          }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
