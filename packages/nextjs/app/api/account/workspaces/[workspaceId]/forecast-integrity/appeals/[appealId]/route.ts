import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import { apiRequestBodyFallback, readApiJsonRequestBody } from "~~/lib/tokenless/apiRequestBody";
import {
  type ForecastAppealResolutionStatus,
  resolveWorkspaceForecastAppeal,
} from "~~/lib/tokenless/crowdForecastPersistence";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;
type Context = { params: Promise<{ workspaceId: string; appealId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await readApiJsonRequestBody(request).catch(error => apiRequestBodyFallback(error, null))) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !["status", "resolutionReason"].includes(key)) ||
      !["accepted", "rejected"].includes(String(body.status)) ||
      typeof body.resolutionReason !== "string"
    ) {
      throw new TokenlessServiceError("Appeal resolution is invalid.", 400, "invalid_forecast_appeal_resolution");
    }
    const { workspaceId, appealId } = await context.params;
    return NextResponse.json(
      await resolveWorkspaceForecastAppeal({
        accountAddress: session.principalId,
        workspaceId,
        appealId,
        status: body.status as ForecastAppealResolutionStatus,
        resolutionReason: body.resolutionReason,
      }),
      { headers: NO_STORE },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
