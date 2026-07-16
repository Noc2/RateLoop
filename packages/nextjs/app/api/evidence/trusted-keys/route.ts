import { NextResponse } from "next/server";
import { projectHumanReviewGateTrustedKeyHistory } from "~~/lib/tokenless/humanReviewGateEvidence";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(projectHumanReviewGateTrustedKeyHistory(), {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
