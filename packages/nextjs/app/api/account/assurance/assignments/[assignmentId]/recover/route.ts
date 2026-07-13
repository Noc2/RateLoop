import { NextRequest, NextResponse } from "next/server";
import { requireBaseAccountRequest } from "~~/lib/base-account/request";
import { recoverExpiredAudienceAssignment } from "~~/lib/tokenless/audienceAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ assignmentId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBaseAccountRequest(request, { mutation: true });
    const { assignmentId } = await context.params;
    return NextResponse.json(
      await recoverExpiredAudienceAssignment({ assignmentId, baseAccountAddress: session.address }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
