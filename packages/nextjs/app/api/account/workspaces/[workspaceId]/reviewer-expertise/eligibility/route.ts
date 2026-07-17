import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { countEligibleReviewerExpertisePool } from "~~/lib/tokenless/reviewerExpertise";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request);
    const { workspaceId } = await context.params;
    const audience = request.nextUrl.searchParams.get("audience");
    const expertiseKeys = request.nextUrl.searchParams.getAll("expertise");
    const privateGroupId = request.nextUrl.searchParams.get("privateGroupId");
    if (audience !== "private_invited" && audience !== "public_network" && audience !== "hybrid") {
      return NextResponse.json({ error: "Review audience is invalid." }, { status: 400 });
    }
    const eligibility = await countEligibleReviewerExpertisePool({
      accountAddress: session.principalId,
      workspaceId,
      audience,
      privateGroupId,
      expertiseKeys,
    });
    return NextResponse.json(eligibility, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
