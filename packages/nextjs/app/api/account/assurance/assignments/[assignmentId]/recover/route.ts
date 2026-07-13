import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { recoverExpiredAudienceAssignment } from "~~/lib/tokenless/audienceAssignments";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { assignmentId } = await context.params;
    const rawBody = await request.text();
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
      await recoverExpiredAudienceAssignment({
        assignmentId,
        baseAccountAddress: session.address,
        confidentialityTermsHash:
          typeof body.confidentialityTermsHash === "string" ? body.confidentialityTermsHash : undefined,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
