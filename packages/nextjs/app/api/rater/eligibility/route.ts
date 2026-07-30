import { type NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { readApiJsonRequestBody, rethrowApiRequestBodyBoundaryError } from "~~/lib/tokenless/apiRequestBody";
import {
  type EligibilitySubmission,
  getPaidEligibility,
  recordPaidEligibilityDecline,
  submitPaidEligibility,
} from "~~/lib/tokenless/paidEligibility";
import { localeCountryFromAcceptLanguage } from "~~/lib/tokenless/paidEligibilityRisk";
import { requireRaterSession } from "~~/lib/tokenless/raterSession";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const MAX_PAID_ELIGIBILITY_REQUEST_BODY_BYTES = 1 * 1_024 * 1_024;
export const readPaidEligibilityRequestBody = (request: Pick<Request, "body" | "headers">) =>
  readApiJsonRequestBody(request, MAX_PAID_ELIGIBILITY_REQUEST_BODY_BYTES);

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
    const browserSession = await requireBrowserSession(request, { mutation: true });
    let submission: Record<string, unknown>;
    try {
      submission = (await readPaidEligibilityRequestBody(request)) as Record<string, unknown>;
    } catch (error) {
      rethrowApiRequestBodyBoundaryError(error);
      throw new TokenlessServiceError("Eligibility request must be valid JSON.", 400, "invalid_eligibility_request");
    }
    if (submission.decision === "declined_paid_data_collection") {
      const reviewerSource = submission.reviewerSource;
      if (reviewerSource !== "customer_invited" && reviewerSource !== "rateloop_network") {
        throw new TokenlessServiceError(
          "Choose the paid-work lane to keep advisory-only.",
          400,
          "invalid_paid_eligibility_decision",
          false,
          "reviewerSource",
        );
      }
      const result = await recordPaidEligibilityDecline({
        principalId: browserSession.principalId,
        reviewerSource,
        workspaceId: typeof submission.workspaceId === "string" ? submission.workspaceId : undefined,
      });
      return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const session = await requireRaterSession(request, true);
    const result = await submitPaidEligibility({
      principalId: session.principalId,
      payoutAccount: session.payoutAddress,
      submission: submission as EligibilitySubmission,
      requestContext: {
        edgeCountry: request.headers.get("x-vercel-ip-country"),
        edgeRegion: request.headers.get("x-vercel-ip-country-region"),
        localeCountry: localeCountryFromAcceptLanguage(request.headers.get("accept-language")),
      },
    });
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
