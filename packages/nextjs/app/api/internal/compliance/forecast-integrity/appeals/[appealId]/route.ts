import { type NextRequest, NextResponse } from "next/server";
import { apiRequestBodyFallback, readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import {
  type ForecastAppealResolutionStatus,
  resolveComplianceForecastAppeal,
} from "~~/lib/tokenless/crowdForecastPersistence";
import { authorizeComplianceOperator } from "~~/lib/tokenless/paidEligibility";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ appealId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    authorizeComplianceOperator(request.headers.get("authorization"));
    const body = (await readApiJsonRequestBody(request).catch(error => apiRequestBodyFallback(error, null))) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !["status", "resolutionReason", "resolvedBy"].includes(key)) ||
      !["accepted", "rejected"].includes(String(body.status)) ||
      typeof body.resolutionReason !== "string" ||
      typeof body.resolvedBy !== "string"
    ) {
      throw new TokenlessServiceError("Appeal resolution is invalid.", 400, "invalid_forecast_appeal_resolution");
    }
    const { appealId } = await context.params;
    return NextResponse.json(
      await resolveComplianceForecastAppeal({
        appealId,
        status: body.status as ForecastAppealResolutionStatus,
        resolutionReason: body.resolutionReason,
        resolvedBy: body.resolvedBy,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { headers: NO_STORE, status: response.status });
  }
}
