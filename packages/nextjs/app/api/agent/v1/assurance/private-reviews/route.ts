import { NextResponse } from "next/server";
import {
  ASSURANCE_API_RESPONSE_HEADERS,
  authenticateAssurancePrivateReviewPrincipal,
  createAssuranceApiPrivateReview,
  parseAssuranceApiPrivateReviewRequest,
} from "~~/lib/tokenless/assuranceIntegrations";
import { tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const authenticated = await authenticateAssurancePrivateReviewPrincipal(request.headers.get("authorization"));
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { code: "invalid_json", message: "Request body must be valid JSON." },
        { status: 400, headers: ASSURANCE_API_RESPONSE_HEADERS },
      );
    }
    const parsed = parseAssuranceApiPrivateReviewRequest(body);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== parsed.idempotencyKey) {
      return NextResponse.json(
        {
          code: "invalid_idempotency_key",
          message: "Idempotency-Key must exactly match the private review request.",
        },
        { status: 400, headers: ASSURANCE_API_RESPONSE_HEADERS },
      );
    }
    const result = await createAssuranceApiPrivateReview({ ...authenticated, request: parsed });
    return NextResponse.json(result, { status: 201, headers: ASSURANCE_API_RESPONSE_HEADERS });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, {
      headers: ASSURANCE_API_RESPONSE_HEADERS,
      status: response.status,
    });
  }
}
