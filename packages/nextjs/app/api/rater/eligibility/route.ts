import { type NextRequest, NextResponse } from "next/server";
import {
  type EligibilitySubmission,
  getPaidEligibility,
  submitPaidEligibility,
} from "~~/lib/tokenless/paidEligibility";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, false);
    return NextResponse.json(await getPaidEligibility(session.principalId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireRaterSession(request, true);
    let submission: EligibilitySubmission;
    try {
      submission = (await request.json()) as EligibilitySubmission;
    } catch {
      throw new TokenlessServiceError("Eligibility request must be valid JSON.", 400, "invalid_eligibility_request");
    }
    const result = await submitPaidEligibility({
      principalId: session.principalId,
      payoutAccount: session.payoutAddress,
      submission,
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
