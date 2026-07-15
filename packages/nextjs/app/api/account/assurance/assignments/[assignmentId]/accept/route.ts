import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { acceptAudienceAssignment } from "~~/lib/tokenless/audienceAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const { assignmentId } = await context.params;
    const body = (await request.json()) as { confidentialityTermsHash?: string };
    return NextResponse.json(
      await acceptAudienceAssignment({
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
