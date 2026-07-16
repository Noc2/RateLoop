import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { listFeedbackBonusRecipientEntitlements } from "~~/lib/tokenless/feedbackBonusRecipientClaims";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await requireBrowserSession(request);
    const roundId = request.nextUrl.searchParams.get("roundId") ?? "";
    const voteKey = request.nextUrl.searchParams.get("voteKey") ?? "";
    return NextResponse.json(
      { items: await listFeedbackBonusRecipientEntitlements({ roundId, voteKey }) },
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
