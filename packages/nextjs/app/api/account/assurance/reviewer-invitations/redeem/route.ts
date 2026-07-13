import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { redeemReviewerInvitationWithBaseAccount } from "~~/lib/tokenless/audienceAssignments";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json()) as { token?: string };
    return NextResponse.json(
      await redeemReviewerInvitationWithBaseAccount({
        token: body.token ?? "",
        baseAccountAddress: session.address,
      }),
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
