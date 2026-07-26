import { NextRequest, NextResponse } from "next/server";
import { requireBrowserSession } from "~~/lib/auth/request";
import {
  type ForecastAppealReason,
  listPrincipalForecastIntegrity,
  openPrincipalForecastAppeal,
} from "~~/lib/tokenless/crowdForecastPersistence";
import { TokenlessServiceError, tokenlessErrorResponse } from "~~/lib/tokenless/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request);
    return NextResponse.json(await listPrincipalForecastIntegrity(session.principalId), { headers: NO_STORE });
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireBrowserSession(request, { mutation: true });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(key => !["findingId", "reasonCode"].includes(key)) ||
      typeof body.findingId !== "string" ||
      typeof body.reasonCode !== "string"
    ) {
      throw new TokenlessServiceError("Appeal request is invalid.", 400, "invalid_forecast_appeal");
    }
    return NextResponse.json(
      await openPrincipalForecastAppeal({
        principalId: session.principalId,
        findingId: body.findingId,
        reasonCode: body.reasonCode as ForecastAppealReason,
      }),
      { headers: NO_STORE, status: 201 },
    );
  } catch (error) {
    const response = tokenlessErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
  }
}
