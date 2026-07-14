import { NextRequest, NextResponse } from "next/server";
import {
  type AdaptiveReviewDecisionRequest,
  authenticateAdaptiveReviewPrincipal,
  evaluateAdaptiveReviewRequirement,
  getAdaptiveAssuranceState,
} from "~~/lib/tokenless/adaptiveReviewService";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    const principal = await authenticateAdaptiveReviewPrincipal(
      request.headers.get("authorization"),
      "evaluation:read",
    );
    const scopeId = request.nextUrl.searchParams.get("scopeId")?.trim();
    if (!scopeId) throw new TokenlessServiceError("scopeId is required.", 400, "invalid_assurance_state_query");
    return NextResponse.json(await getAdaptiveAssuranceState({ principal, scopeId }), { headers: HEADERS });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await authenticateAdaptiveReviewPrincipal(request.headers.get("authorization"), "review:decide");
    let body: AdaptiveReviewDecisionRequest;
    try {
      body = (await request.json()) as AdaptiveReviewDecisionRequest;
    } catch {
      throw new TokenlessServiceError("Review opportunity body must be valid JSON.", 400, "invalid_review_opportunity");
    }
    return NextResponse.json(await evaluateAdaptiveReviewRequirement({ principal, request: body }), {
      headers: HEADERS,
      status: 201,
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: HEADERS, status: response.status });
  }
}
